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
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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


def format_timestamp(seconds: float) -> str:
    """Convert seconds to [MM:SS] format."""
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"[{m:02d}:{s:02d}]"

def transcribe_with_whisper(
    file_path: str,
    language: str = "fr",
    context_prompt: str = "",
    time_offset: float = 0.0
) -> str:
    """
    Transcribe a single audio file using OpenAI Whisper API with timestamps.
    Returns formatted string with [MM:SS] timestamps adjusted by time_offset.
    """
    client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    with open(file_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=language,
            response_format="verbose_json",
            temperature=0.2, 
            prompt=context_prompt
        )
    
    formatted_text = ""
    last_text = ""
    
    for segment in response.segments:
        text = segment.text.strip()
        start = segment.start + time_offset # Apply global offset
        
        if text == last_text:
            continue
        last_text = text
        
        if not text or len(text) < 2:
            continue
            
        timestamp = format_timestamp(start)
        formatted_text += f"{timestamp} {text}\n"
    
    return formatted_text


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
        segment_duration_sec = SEGMENT_DURATION_MINUTES * 60
        
        for i, chunk_path in enumerate(chunk_paths):
            print(f"[Whisper] Transcribing chunk {i+1}/{len(chunk_paths)}...")
            
            # Calculate offset based on chunk index
            current_offset = i * segment_duration_sec
            
            chunk_text = transcribe_with_whisper(
                chunk_path,
                language="fr",
                context_prompt=context_prompt,
                time_offset=current_offset
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


@https_fn.on_call(
    timeout_sec=300,  # 5 minutes timeout for generation
    memory=options.MemoryOption.GB_1
)
def generate_minutes_claude(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function to generate meeting minutes draft using Claude API.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    system_prompt = data.get("systemPrompt")
    user_message = data.get("userMessage")
    meeting_id = data.get("meetingId")

    if not system_prompt or not user_message:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: systemPrompt, userMessage"
        )
    
    # Check API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
         raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="ANTHROPIC_API_KEY is not configured on server."
        )

    print(f"[Claude] Generating minutes for meeting {meeting_id}...")

    try:
        from anthropic import Anthropic
        
        client = Anthropic(api_key=api_key)
        
        message = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=8192,
            temperature=0.1,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        content = message.content[0].text
        
        # Save to Firestore directly if meetingId provided
        if meeting_id:
            try:
                db = firestore.client()
                meeting_ref = db.collection("meetings").document(meeting_id)
                
                draft_data = {
                    "content": content,
                    "generatedAt": datetime.now().isoformat(),
                    "status": "draft",
                    "version": 1,
                    "engine": "claude-3-5-sonnet"
                }
                
                meeting_ref.update({
                    "minutesDraft": draft_data, 
                    "dateUpdated": datetime.now().isoformat()
                })
                print(f"[Claude] Saved draft to Firestore for {meeting_id}")
            except Exception as e:
                print(f"[Claude] Warning: Failed to save to Firestore: {e}")
                # We still return the content
        
        return {
            "success": True,
            "content": content
        }

    except Exception as e:
        print(f"[Claude] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1
)
def finalize_draft_claude(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function to finalize draft with user feedback using Claude.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    system_prompt = data.get("systemPrompt")
    user_message = data.get("userMessage")
    meeting_id = data.get("meetingId")
    user_feedback = data.get("userFeedback")

    if not system_prompt or not user_message:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: systemPrompt, userMessage"
        )
    
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
         raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="ANTHROPIC_API_KEY is not configured on server."
        )

    print(f"[Claude] Finalizing draft for meeting {meeting_id}...")

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        
        message = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=8192,
            temperature=0.1,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        final_content = message.content[0].text
        
        # Update meeting
        if meeting_id:
            try:
                db = firestore.client()
                meeting_ref = db.collection("meetings").document(meeting_id)
                meeting_doc = meeting_ref.get()
                current_version = 0
                if meeting_doc.exists:
                    meeting_data_dict = meeting_doc.to_dict()
                    draft = meeting_data_dict.get("minutesDraft", {})
                    current_version = draft.get("version", 0)

                meeting_ref.update({
                    "minutesDraft.content": final_content,
                    "minutesDraft.status": "final",
                    "minutesDraft.finalizedAt": datetime.now().isoformat(),
                    "minutesDraft.userFeedback": user_feedback,
                    "minutesDraft.version": current_version + 1,
                    "dateUpdated": datetime.now().isoformat()
                })
                print(f"[Claude] Saved final draft to Firestore for {meeting_id}")
            except Exception as e:
                print(f"[Claude] Warning: Failed to save final draft: {e}")

        return {
            "success": True,
            "content": final_content
        }

    except Exception as e:
        print(f"[Claude] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )
