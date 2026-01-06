"""
Cloud Functions Python pour CCE Val-d'Or
Transcription audio avec OpenAI Whisper + Génération PV avec Claude
"""

import os
import io
import tempfile
from datetime import datetime

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, firestore, storage
import openai
from pydub import AudioSegment

# Initialize Firebase
initialize_app()

# Constants
MAX_WHISPER_SIZE_MB = 25
SEGMENT_DURATION_MINUTES = 10
SUPPORTED_FORMATS = ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga', 'oga', 'ogg']


def get_audio_format(mime_type: str) -> str:
    """Extract audio format from MIME type."""
    format_map = {
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/mp4': 'mp4',
        'audio/m4a': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
    }
    return format_map.get(mime_type, 'mp3')


def split_audio_if_needed(file_path: str, max_size_mb: int = MAX_WHISPER_SIZE_MB) -> list[str]:
    """
    Split audio file into chunks if it exceeds the max size.
    Returns list of file paths (original or chunks).
    """
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    
    if file_size_mb <= max_size_mb:
        print(f"[Whisper] File size {file_size_mb:.1f}MB <= {max_size_mb}MB, no splitting needed")
        return [file_path]
    
    print(f"[Whisper] File size {file_size_mb:.1f}MB > {max_size_mb}MB, splitting...")
    
    # Load audio
    audio = AudioSegment.from_file(file_path)
    
    # Calculate segment duration based on file size ratio
    segment_duration_ms = SEGMENT_DURATION_MINUTES * 60 * 1000
    
    chunks = []
    temp_dir = tempfile.gettempdir()
    
    for i, start_ms in enumerate(range(0, len(audio), segment_duration_ms)):
        end_ms = min(start_ms + segment_duration_ms, len(audio))
        segment = audio[start_ms:end_ms]
        
        chunk_path = os.path.join(temp_dir, f"chunk_{i}.mp3")
        segment.export(chunk_path, format="mp3", bitrate="64k")
        chunks.append(chunk_path)
        
        print(f"[Whisper] Created chunk {i+1}: {start_ms//1000}s - {end_ms//1000}s")
    
    print(f"[Whisper] Split into {len(chunks)} chunks")
    return chunks


def transcribe_with_whisper(
    file_path: str,
    language: str = "fr",
    context_prompt: str = ""
) -> str:
    """
    Transcribe a single audio file using OpenAI Whisper API.
    """
    client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    with open(file_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=language,
            response_format="text",
            temperature=0,
            prompt=context_prompt
        )
    
    return response


def build_context_prompt(attendee_names: list[str], agenda_items: list[str]) -> str:
    """
    Build a context prompt to help Whisper with proper nouns and terminology.
    """
    context_parts = [
        "Comité Consultatif en Environnement (CCE)",
        "Ville de Val-d'Or",
        "Procès-verbal",
        "Ordre du jour",
        "Résolution",
        "CONSIDÉRANT",
        "IL EST RÉSOLU",
    ]
    
    # Add attendee names
    if attendee_names:
        context_parts.extend(attendee_names)
    
    # Add agenda item titles
    if agenda_items:
        context_parts.extend(agenda_items)
    
    return ", ".join(context_parts)


@https_fn.on_call(
    timeout_sec=3600,  # 1 hour timeout
    memory=options.MemoryOption.GB_4
)
def transcribe_whisper(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function to transcribe audio using Whisper API.
    
    Expected request data:
    - meetingId: string
    - storagePath: string
    - mimeType: string
    """
    
    # Validate authentication
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    storage_path = data.get("storagePath")
    mime_type = data.get("mimeType", "audio/mpeg")
    
    if not meeting_id or not storage_path:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId or storagePath."
        )
    
    print(f"[Whisper] Starting transcription for meeting {meeting_id}")
    
    try:
        db = firestore.client()
        bucket = storage.bucket()
        
        # Update status to processing
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_ref.update({
            "audioRecording.transcriptionStatus": "processing",
            "dateUpdated": datetime.now().isoformat()
        })
        
        # Get meeting context for Whisper prompt
        meeting_doc = meeting_ref.get()
        meeting_data = meeting_doc.to_dict() if meeting_doc.exists else {}
        
        attendee_names = [a.get("name", "") for a in meeting_data.get("attendees", [])]
        agenda_items = [item.get("title", "") for item in meeting_data.get("agendaItems", [])]
        
        context_prompt = build_context_prompt(attendee_names, agenda_items)
        print(f"[Whisper] Context prompt: {context_prompt[:200]}...")
        
        # Download audio file
        audio_format = get_audio_format(mime_type)
        temp_file = tempfile.NamedTemporaryFile(
            suffix=f".{audio_format}",
            delete=False
        )
        
        blob = bucket.blob(storage_path)
        blob.download_to_filename(temp_file.name)
        print(f"[Whisper] Downloaded audio to {temp_file.name}")
        
        # Split if needed
        chunk_paths = split_audio_if_needed(temp_file.name)
        
        # Transcribe each chunk
        full_transcription = ""
        for i, chunk_path in enumerate(chunk_paths):
            print(f"[Whisper] Transcribing chunk {i+1}/{len(chunk_paths)}...")
            
            chunk_text = transcribe_with_whisper(
                chunk_path,
                language="fr",
                context_prompt=context_prompt
            )
            
            if i > 0:
                full_transcription += "\n\n"
            full_transcription += chunk_text
            
            # Clean up chunk if it's not the original
            if chunk_path != temp_file.name:
                os.unlink(chunk_path)
        
        # Clean up original temp file
        os.unlink(temp_file.name)
        
        print(f"[Whisper] Transcription complete: {len(full_transcription)} chars")
        
        # Save transcription to Firestore
        meeting_ref.update({
            "audioRecording.transcription": full_transcription,
            "audioRecording.transcriptionStatus": "completed",
            "audioRecording.transcribedAt": datetime.now().isoformat(),
            "audioRecording.transcriptionEngine": "whisper-1",
            "dateUpdated": datetime.now().isoformat()
        })
        
        return {
            "success": True,
            "transcription": full_transcription,
            "chunks": len(chunk_paths)
        }
        
    except Exception as e:
        print(f"[Whisper] Error: {str(e)}")
        
        # Update error status
        try:
            meeting_ref.update({
                "audioRecording.transcriptionStatus": "error",
                "audioRecording.transcriptionError": str(e),
                "dateUpdated": datetime.now().isoformat()
            })
        except:
            pass
        
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )
