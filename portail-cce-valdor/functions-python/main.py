"""
Cloud Functions Python pour CCE Val-d'Or
Transcription audio avec OpenAI Whisper + Génération PV avec Claude
"""

import os
import io
import tempfile
import subprocess
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
    Split audio file into chunks using FFmpeg segment muxer.
    This is more memory efficient than pydub and prevents Whisper looping by keeping segments short.
    """
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    
    # Even if small, we might want to enforce segmentation for "anti-looping" if it's close to the limit
    # But for now, let's respect the size limit. 
    # Actually, the user suggests segmentation is KEY for anti-looping.
    # Let's enforce splitting if it's longer than SEGMENT_DURATION_MINUTES regardless of size,
    # or just rely on the size check. 
    # Given the user's emphasis on "Operational Guardrails", reliable segmentation is preferred.
    
    if file_size_mb <= max_size_mb:
        print(f"[Whisper] File size {file_size_mb:.1f}MB <= {max_size_mb}MB, no splitting needed")
        return [file_path]
    
    print(f"[Whisper] File size {file_size_mb:.1f}MB > {max_size_mb}MB, splitting with FFmpeg...")
    
    temp_dir = tempfile.gettempdir()
    base_name = os.path.splitext(os.path.basename(file_path))[0]
    output_pattern = os.path.join(temp_dir, f"{base_name}_part%03d.wav")
    
    # Segment time in seconds (10 minutes = 600s to stay safely under 25MB for 16kHz WAV)
    # User suggested 900s (15m) but that risks exceeding 25MB for WAV (approx 27MB).
    segment_time = SEGMENT_DURATION_MINUTES * 60 
    
    command = [
        "ffmpeg", "-y",
        "-i", file_path,
        "-f", "segment",
        "-segment_time", str(segment_time),
        "-c", "copy",  # Copy codec (assumes input is already clean WAV from previous step)
        output_pattern
    ]
    
    try:
        subprocess.run(
            command, 
            check=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE
        )
        
        # Collect generated files
        chunks = []
        # List files in temp dir matching the pattern
        # Since we know the pattern, we can just look for them
        for filename in sorted(os.listdir(temp_dir)):
            if filename.startswith(f"{base_name}_part") and filename.endswith(".wav"):
                chunks.append(os.path.join(temp_dir, filename))
        
        print(f"[Whisper] Split into {len(chunks)} chunks using FFmpeg")
        return chunks
        
    except subprocess.CalledProcessError as e:
        print(f"[Whisper] Error splitting audio: {e.stderr.decode() if e.stderr else str(e)}")
        raise e


def format_timestamp(seconds: float) -> str:
    """Convert seconds to [MM:SS] format."""
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"[{m:02d}:{s:02d}]"


def clean_hallucinations(text: str) -> str:
    """
    Remove lines where the same phrase is repeated 3+ times (Whisper hallucination loops).
    Preserves [inaudible] and does not correct text.
    """
    lines = text.split('\n')
    cleaned_lines = []
    
    if not lines:
        return ""
        
    last_line = None
    repetition_count = 0
    
    for line in lines:
        line_stripped = line.strip()
        
        # Format is "[MM:SS] Text content"
        parts = line_stripped.split('] ', 1)
        content = parts[1] if len(parts) > 1 else line_stripped
        
        if content == last_line:
            repetition_count += 1
        else:
            repetition_count = 1
            last_line = content
            
        if repetition_count < 3:
            cleaned_lines.append(line)
            
    return "\n".join(cleaned_lines)


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
            # Temperature 0 reduces hallucinations (most deterministic)
            # Note: Other parameters like beam_size, condition_on_previous_text, etc.
            # are not available in the OpenAI API (only in local Whisper),
            # but our chunking strategy effectively implements condition_on_previous_text=False.
            temperature=0, 
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


    """
    Build a context prompt to help Whisper with proper nouns and terminology.
    Using a narrative style to set the context and disable auto-completion behavior.
    """
    # Base narrative prompt (Zero-shot styling)
    base_prompt = (
        "Enregistrement audio en français québécois. "
        "Il s’agit d’une réunion officielle d’un comité consultatif en environnement. "
        "La rencontre se déroule dans une salle de conférence avec un micro central. "
        "Les intervenants parlent à tour de rôle, parfois à voix basse ou à distance du micro. "
        "Le langage est professionnel, technique et institutionnel. "
        "Le vocabulaire peut inclure : environnement, développement durable, politique environnementale, "
        "plan d’action, adaptation aux changements climatiques, gestion des eaux pluviales, "
        "îlots de chaleur, biodiversité, consultation, règlement municipal. "
        "Les échanges sont naturels et peuvent contenir des hésitations, des silences et des phrases incomplètes. "
        "Lorsque le propos est inaudible ou incertain, il doit être laissé tel quel sans tentative de complétion."
    )

    # Specific vocabulary integration
    extras = []
    
    # Add attendee names
    if attendee_names:
        extras.extend(attendee_names)
    
    # Add agenda item titles
    if agenda_items:
        extras.extend(agenda_items)
    
    # Combine narrative + specific vocabulary
    if extras:
        return f"{base_prompt} Mots clés spécifiques pour cette réunion : {', '.join(extras)}."
    
    return base_prompt


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
        
        # Pre-process audio with FFmpeg (Normalize & Clean)
        processed_file_path = process_audio_with_ffmpeg(temp_file.name)
        
        # Split if needed (use processed file)
        chunk_paths = split_audio_if_needed(processed_file_path)
        
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
            
        # Clean up chunk if it's not the original (processed) file
            if chunk_path != processed_file_path:
                os.unlink(chunk_path)
        
        # Clean up processed file if it was created and different from temp
        if processed_file_path != temp_file.name and os.path.exists(processed_file_path):
             os.unlink(processed_file_path)

        # Clean up original temp file
        os.unlink(temp_file.name)
        
        print(f"[Whisper] Transcription complete: {len(full_transcription)} chars")
        
        # Post-processing: Light filter to remove loops / hallucinations (3+ repeats)
        full_transcription = clean_hallucinations(full_transcription)
        print(f"[Whisper] After hallucination cleaning: {len(full_transcription)} chars")
        
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
    timeout_sec=540,  # 9 minutes timeout for generation
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
            model="claude-haiku-4-5-20251001",
            max_tokens=20000,
            thinking={
                "type": "enabled",
                "budget_tokens": 12000
            },
            temperature=1,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Handle extended thinking (multiple blocks)
        content_blocks = [block.text for block in message.content if block.type == "text"]
        content = "".join(content_blocks)
        
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
    timeout_sec=540,
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
            model="claude-haiku-4-5-20251001",
            max_tokens=20000,
            thinking={
                "type": "enabled",
                "budget_tokens": 12000
            },
            temperature=1,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Handle extended thinking (multiple blocks)
        final_content_blocks = [block.text for block in message.content if block.type == "text"]
        final_content = "".join(final_content_blocks)
        
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

@https_fn.on_call(
    timeout_sec=540,  # 9 minutes timeout to match client
    memory=options.MemoryOption.GB_1
)
def chat_claude(req: https_fn.CallableRequest) -> dict:
    """
    Generic Cloud Function to chat with Claude API (no side effects).
    Useful for sanitization, summarization, etc.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    system_prompt = data.get("systemPrompt")
    user_message = data.get("userMessage")
    temperature = data.get("temperature", 0.5)

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

    print(f"[Claude] Generic chat request received...")

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        
        # Use Claude 4.5 Haiku as explicitly requested by user (same as generate_minutes)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20000,
            thinking={
                "type": "enabled",
                "budget_tokens": 12000
            },
            temperature=1, # Start at 1 for thinking models
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Handle multiple content blocks (ignore 'thinking', keep 'text')
        content_parts = []
        for block in message.content:
            if block.type == "text":
                content_parts.append(block.text)
        
        content = "\n".join(content_parts)
        
        return {
            "success": True,
            "content": content
        }

    except Exception as e:
        print(f"[Claude] Chat Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# CONVOCATION EMAIL SERVICE
# =============================================================================

@https_fn.on_call(
    memory=options.MemoryOption.MB_256,
    timeout_sec=120,
    region="us-central1"
)
def send_convocation(req: https_fn.CallableRequest):
    """
    Cloud Function to send convocation emails to CCE members.
    Uses Resend API for email delivery.
    
    Expected request data:
    - meetingId: string
    - convocationId: string
    - meeting: { title, date, location, agendaItems }
    - recipients: [{ email, name, token, memberId }]
    - sender: { name, email }
    """
    # Verify authentication
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentification requise"
        )

    try:
        import resend
        
        # Get Resend API key
        resend_api_key = os.environ.get("RESEND_API_KEY")
        if not resend_api_key:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                message="RESEND_API_KEY non configurée"
            )
        
        resend.api_key = resend_api_key
        
        # Extract data
        data = req.data
        meeting_id = data.get("meetingId")
        convocation_id = data.get("convocationId")
        meeting = data.get("meeting", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        
        if not meeting_id or not recipients:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message="meetingId et recipients requis"
            )
        
        # Format meeting date
        # Format meeting date (Manual translation to ensure French regardless of server locale)
        meeting_date = datetime.fromisoformat(meeting.get("date", "").replace("Z", "+00:00"))
        
        days = {
            0: "lundi", 1: "mardi", 2: "mercredi", 3: "jeudi", 
            4: "vendredi", 5: "samedi", 6: "dimanche"
        }
        months = {
            1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
            7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre"
        }
        
        day_str = days[meeting_date.weekday()]
        month_str = months[meeting_date.month]
        
        formatted_date = f"{day_str} {meeting_date.day} {month_str} {meeting_date.year}"
        formatted_time = meeting_date.strftime("%H h %M")
        
        # App URL for RSVP links
        app_url = os.environ.get("APP_URL", "https://comite-cce.web.app")
        
        # Generate email HTML with logos
        def generate_email_html(recipient_name: str, token: str) -> str:
            rsvp_url = f"{app_url}/rsvp/{meeting_id}/{token}"
            
            return f"""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Georgia, 'Times New Roman', serif; background-color: #f9fbfa; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header with logos -->
        <div style="background-color: #1e4e3d; padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-family: Arial, sans-serif;">
                COMITÉ CONSULTATIF EN ENVIRONNEMENT
            </h1>
            <p style="color: #c5a065; margin: 10px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">
                Ville de Val-d'Or
            </p>
        </div>
        
        <!-- Content -->
        <div style="padding: 30px;">
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Bonjour <strong>{recipient_name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Vous êtes convoqué(e) à la prochaine assemblée du Comité consultatif en environnement de la Ville de Val-d'Or.
            </p>
            
            <!-- Meeting details box -->
            <div style="background-color: #f9fbfa; border-left: 4px solid #c5a065; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 10px 0; font-size: 16px;">
                    <strong style="color: #1e4e3d;">📅 Date :</strong> {formatted_date}
                </p>
                <p style="margin: 0 0 10px 0; font-size: 16px;">
                    <strong style="color: #1e4e3d;">🕐 Heure :</strong> {formatted_time}
                </p>
                <p style="margin: 0; font-size: 16px;">
                    <strong style="color: #1e4e3d;">📍 Lieu :</strong> {meeting.get("location", "Ville de Val-d'Or")}
                </p>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                📎 L'ordre du jour est joint à ce courriel.
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6; margin-top: 25px;">
                <strong>Veuillez confirmer votre présence :</strong>
            </p>
            
            <!-- RSVP buttons -->
            <div style="text-align: center; margin: 30px 0;">
                <a href="{rsvp_url}?response=confirmed" 
                   style="display: inline-block; background-color: #4caf50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 5px; font-size: 16px;">
                    ✓ Je serai présent(e)
                </a>
                <a href="{rsvp_url}?response=declined" 
                   style="display: inline-block; background-color: #f44336; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 5px; font-size: 16px;">
                    ✗ Je serai absent(e)
                </a>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f9fbfa; padding: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0; font-size: 14px; color: #666; text-align: center;">
                Cordialement,<br>
                <strong style="color: #1e4e3d;">{sender.get("name", "Coordonnateur en environnement")}</strong><br>
                Ville de Val-d'Or
            </p>
        </div>
    </div>
</body>
</html>
"""
        
        # Send emails to all recipients
        sent_count = 0
        errors = []
        
        for recipient in recipients:
            try:
                email_html = generate_email_html(
                    recipient.get("name", ""),
                    recipient.get("token", "")
                )
                
                resend.Emails.send({
                    "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
                    "to": [recipient.get("email")],
                    "subject": f"Ordre du jour du CCE – {formatted_date}",
                    "html": email_html,
                    # TODO: Attach PDF when we have it stored in Cloud Storage
                })
                
                sent_count += 1
                print(f"[Convocation] Email sent to {recipient.get('email')}")
                
            except Exception as email_error:
                error_msg = f"Failed to send to {recipient.get('email')}: {str(email_error)}"
                print(f"[Convocation] {error_msg}")
                errors.append(error_msg)
        
        # Update convocation record with send status
        if convocation_id:
            db = firestore.client()
            db.collection("meetings").document(meeting_id).collection("convocations").document(convocation_id).update({
                "emailsSent": sent_count,
                "emailErrors": errors,
                "emailSentAt": datetime.now().isoformat()
            })
        
        return {
            "success": True,
            "sentCount": sent_count,
            "errorCount": len(errors),
            "errors": errors if errors else None
        }
        
    except Exception as e:
        print(f"[Convocation] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# ==========================================
# Avis de Convocation (Phase 1) - Simple notification with deadline + PDF attachment
# ==========================================

def generate_avis_pdf(meeting_date: str, meeting_time: str, 
                      meeting_location: str, deadline: str, sender_name: str, 
                      sender_email: str, signature_url: str = None) -> bytes:
    """
    Generate Avis de Convocation PDF using reportlab.
    Matches the official memo format:
    - DESTINATAIRE / EXPÉDITEUR / DATE / OBJET header
    - Body with meeting details and deadline
    - Signature at the bottom
    Returns PDF as bytes for email attachment.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
    import io
    import urllib.request
    
    # Colors
    primary_color = HexColor('#1e4e3d')
    accent_color = HexColor('#c5a065')
    
    # Create PDF buffer
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, 
                           topMargin=0.6*inch, bottomMargin=0.6*inch,
                           leftMargin=1*inch, rightMargin=1*inch)
    
    # Styles
    styles = getSampleStyleSheet()
    
    header_style = ParagraphStyle(
        'HeaderStyle',
        parent=styles['Heading1'],
        fontSize=14,
        textColor=primary_color,
        alignment=TA_CENTER,
        spaceAfter=5,
        fontName='Helvetica-Bold'
    )
    
    subheader_style = ParagraphStyle(
        'SubheaderStyle',
        parent=styles['Heading2'],
        fontSize=11,
        textColor=accent_color,
        alignment=TA_CENTER,
        spaceAfter=20,
        fontName='Helvetica'
    )
    
    label_style = ParagraphStyle(
        'LabelStyle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=HexColor('#333333'),
        fontName='Helvetica-Bold',
        leading=14
    )
    
    value_style = ParagraphStyle(
        'ValueStyle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=HexColor('#333333'),
        fontName='Helvetica',
        leading=14
    )
    
    body_style = ParagraphStyle(
        'BodyStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#333333'),
        alignment=TA_JUSTIFY,
        spaceAfter=12,
        leading=16,
        fontName='Times-Roman'
    )
    
    signature_style = ParagraphStyle(
        'SignatureStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#333333'),
        alignment=TA_LEFT,
        fontName='Times-Roman',
        leftIndent=20
    )
    
    # Build document content
    elements = []
    
    # === HEADER with logos (if available) ===
    elements.append(Paragraph("COMITÉ CONSULTATIF EN ENVIRONNEMENT", header_style))
    elements.append(Paragraph("VILLE DE VAL-D'OR", subheader_style))
    
    # Horizontal line
    from reportlab.platypus import HRFlowable
    elements.append(HRFlowable(width="100%", thickness=2, color=primary_color, spaceAfter=20))
    
    # Format today's date in French
    months_fr = {
        1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
        7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre"
    }
    today = datetime.now()
    today_str = f"Le {today.day} {months_fr[today.month]} {today.year}"
    
    # === MEMO HEADER TABLE ===
    # DESTINATAIRE / EXPÉDITEUR / DATE / OBJET format
    memo_data = [
        [Paragraph("<b>DESTINATAIRE :</b>", label_style), 
         Paragraph("Les membres du Comité consultatif en environnement", value_style)],
        [Paragraph("<b>EXPÉDITEUR :</b>", label_style), 
         Paragraph(f"{sender_name}, coordonnateur en environnement", value_style)],
        [Paragraph("<b>DATE :</b>", label_style), 
         Paragraph(today_str, value_style)],
        [Paragraph("<b>OBJET :</b>", label_style), 
         Paragraph("Réunion du Comité consultatif en environnement", value_style)],
    ]
    
    memo_table = Table(memo_data, colWidths=[1.3*inch, 4.7*inch])
    memo_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(memo_table)
    elements.append(Spacer(1, 20))
    
    # Horizontal line
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor('#cccccc'), spaceAfter=20))
    
    # === BODY ===
    elements.append(Paragraph("Mesdames, Messieurs,", body_style))
    elements.append(Spacer(1, 12))
    
    # Main paragraph with meeting details
    body_text = f"""Je vous prie de prendre note qu'une assemblée du Comité consultatif en environnement 
    est prévue le <b>{meeting_date}</b> à <b>{meeting_time}</b> {meeting_location}."""
    elements.append(Paragraph(body_text, body_style))
    elements.append(Spacer(1, 8))
    
    # Deadline paragraph
    deadline_text = f"""Vous avez jusqu'au <b>{deadline}</b> pour faire vos suggestions de point à l'ordre du jour."""
    elements.append(Paragraph(deadline_text, body_style))
    elements.append(Spacer(1, 8))
    
    # Closing
    elements.append(Paragraph("Je vous remercie grandement de votre collaboration.", body_style))
    elements.append(Spacer(1, 40))
    
    # === SIGNATURE ===
    # Try to add signature image if available
    signature_added = False
    if signature_url:
        try:
            # Download signature image
            with urllib.request.urlopen(signature_url, timeout=10) as response:
                sig_data = response.read()
                sig_buffer = io.BytesIO(sig_data)
                sig_image = Image(sig_buffer, width=1.5*inch, height=0.5*inch)
                elements.append(sig_image)
                signature_added = True
                print(f"[Avis PDF] Signature image added from URL")
        except Exception as sig_error:
            print(f"[Avis PDF] Could not load signature image: {sig_error}")
    
    if not signature_added:
        # Add signature line if no image
        elements.append(Spacer(1, 30))
    
    elements.append(Paragraph(f"{sender_name}, secrétaire du Comité", signature_style))
    
    # Build PDF
    doc.build(elements)
    
    # Get PDF bytes
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    return pdf_bytes


@https_fn.on_call(
    memory=options.MemoryOption.MB_512,  # Increased for PDF generation
    timeout_sec=180,
    region="us-central1"
)
def send_avis_convocation(req: https_fn.CallableRequest):
    """
    Send Avis de Convocation emails to CCE members with PDF attachment.
    Phase 1: Simple notification with meeting date, 15-day deadline for agenda suggestions,
    and the official convocation letter as PDF attachment.
    """
    print("[Avis] Starting send_avis_convocation function with PDF generation")
    
    try:
        import resend
        import base64
        
        # Get Resend API key
        resend_api_key = os.environ.get("RESEND_API_KEY")
        if not resend_api_key:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                message="RESEND_API_KEY non configurée"
            )
        
        resend.api_key = resend_api_key
        
        # Extract data
        data = req.data
        meeting_id = data.get("meetingId")
        avis_id = data.get("avisId")
        meeting = data.get("meeting", {})
        deadline = data.get("deadline", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        
        if not meeting_id or not recipients:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message="meetingId et recipients requis"
            )
        
        # Use pre-formatted dates from frontend
        formatted_meeting_date = meeting.get("formattedDate", "Date à confirmer")
        formatted_deadline = deadline.get("formattedDate", "Date limite")
        sender_email = sender.get("email", "coordonnateur@ville.valdor.qc.ca")
        sender_name = sender.get("name", "Coordonnateur CCE")
        meeting_title = meeting.get("title", "Assemblée CCE")
        meeting_location = meeting.get("location", "Ville de Val-d'Or")
        signature_url = sender.get("signatureUrl")
        
        # Format time from meeting date
        try:
            meeting_datetime = datetime.fromisoformat(meeting.get("date", "").replace("Z", "+00:00"))
            meeting_time = meeting_datetime.strftime("%H h %M")
        except:
            meeting_time = "À confirmer"
        
        # Format location for proper grammar
        location_text = f"dans {meeting_location}" if meeting_location else "au bureau"
        
        # Generate PDF
        print("[Avis] Generating PDF...")
        pdf_bytes = generate_avis_pdf(
            meeting_date=formatted_meeting_date,
            meeting_time=meeting_time,
            meeting_location=location_text,
            deadline=formatted_deadline,
            sender_name=sender_name,
            sender_email=sender_email,
            signature_url=signature_url
        )
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        pdf_filename = f"Avis_Convocation_CCE_{formatted_meeting_date.replace(' ', '_').replace(',', '')}.pdf"
        print(f"[Avis] PDF generated: {len(pdf_bytes)} bytes")
        
        # Generate email HTML
        def generate_avis_email_html(recipient_name: str) -> str:
            return f"""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Georgia, 'Times New Roman', serif; background-color: #f9fbfa; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #1e4e3d; padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-family: Arial, sans-serif;">
                COMITÉ CONSULTATIF EN ENVIRONNEMENT
            </h1>
            <p style="color: #c5a065; margin: 10px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">
                Ville de Val-d'Or
            </p>
        </div>
        
        <!-- Content -->
        <div style="padding: 30px;">
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Bonjour,
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Vous trouverez, <strong>en fichier joint</strong>, l'avis de convocation pour la prochaine assemblée du 
                <strong>Comité consultatif en environnement</strong>, prévue le <strong>{formatted_meeting_date}</strong>.
            </p>
            
            <!-- Deadline box -->
            <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <p style="margin: 0; font-size: 16px; color: #856404;">
                    📅 <strong>Date limite pour suggestions :</strong><br>
                    Vous avez jusqu'au <strong>{formatted_deadline}</strong> pour faire vos suggestions de sujets 
                    à l'ordre du jour, par courriel à <a href="mailto:{sender_email}" style="color: #1e4e3d;">{sender_email}</a>
                </p>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Merci et bonne journée !
            </p>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f9fbfa; padding: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0; font-size: 14px; color: #666; text-align: center;">
                Cordialement,<br>
                <strong style="color: #1e4e3d;">{sender_name}</strong><br>
                Ville de Val-d'Or
            </p>
        </div>
    </div>
</body>
</html>
"""
        
        # Send emails to all recipients with PDF attachment
        sent_count = 0
        errors = []
        
        for recipient in recipients:
            try:
                email_html = generate_avis_email_html(recipient.get("name", ""))
                
                resend.Emails.send({
                    "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
                    "to": [recipient.get("email")],
                    "subject": f"Avis de convocation – Assemblée CCE du {formatted_meeting_date}",
                    "html": email_html,
                    "attachments": [
                        {
                            "filename": pdf_filename,
                            "content": pdf_base64
                        }
                    ]
                })
                
                sent_count += 1
                print(f"[Avis] Email with PDF sent to {recipient.get('email')}")
                
            except Exception as email_error:
                error_msg = f"Failed to send to {recipient.get('email')}: {str(email_error)}"
                print(f"[Avis] {error_msg}")
                errors.append(error_msg)
        
        # Update avis record with send status
        if avis_id:
            db = firestore.client()
            db.collection("meetings").document(meeting_id).collection("avis_convocations").document(avis_id).update({
                "emailsSent": sent_count,
                "emailErrors": errors,
                "emailSentAt": datetime.now().isoformat(),
                "pdfGenerated": True
            })
        
        return {
            "success": True,
            "sentCount": sent_count,
            "errorCount": len(errors),
            "pdfGenerated": True,
            "errors": errors if errors else None
        }
        
    except Exception as e:
        print(f"[Avis] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )
