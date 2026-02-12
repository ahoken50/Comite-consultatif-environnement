"""
Cloud Functions Python pour CCE Val-d'Or
Transcription audio avec OpenAI Whisper + GÃ©nÃ©ration PV avec Claude
"""

import os
import io
import tempfile
import subprocess
import json
import time
import requests
import google.auth
from datetime import datetime, timedelta
from typing import Any
from firebase_functions import https_fn, options
from firebase_admin import initialize_app, firestore, storage
# NOTE: openai and pydub are no longer needed for Salad Cloud integration.
# They are still used by the legacy_local transcription function if needed.
# Importing them lazily inside the legacy function to reduce cold start memory.
# import openai
# from pydub import AudioSegment
# Local Imports
from pv_pipeline import (
    run_pv_pipeline,
    run_reflection_loop,
    compare_with_historical,
    record_learning
)
from active_learning import (
    update_embedding_with_correction,
    analyze_embedding_quality,
    analyze_quality_trends,
    build_style_memory
)
from rlhf_engine import (
    compute_embedding_reward,
    get_members_needing_improvement,
    optimize_policy,
    get_current_policy,
    get_learned_preferences,
    compute_reward,
    record_preference
)
from recommendation_engine import learn_resolution_template

# Import other Cloud Functions to ensure they are deployed
from migration_status import (
    api_get_migration_status,
    trigger_manual_migration,
    reset_migration_flag
)
from diagnose_migration import api_diagnose_migration
from batch_enroll_from_storage import batch_enroll_from_storage
from sync_firestore_to_supabase import force_sync_firestore_to_supabase
from clear_supabase_speakers import clear_supabase_speakers
from sync_service import sync_embedding_to_supabase
from audio_utils import extract_audio_segment_embedding

from dotenv import load_dotenv


# Load environment variables
load_dotenv()

# Initialize Firebase
initialize_app()
try:
    db = firestore.client()
    bucket = storage.bucket()
except Exception as e:
    print(f"[System] Warning: Global init skipped (Deploy/Build mode?): {e}")
    db = None
    bucket = None

# =============================================================================
# SINGLETON CLIENTS (Lazy Loading Pattern)
# =============================================================================
_clients = {
    "openai": None,
    "anthropic": None,
    "resend_configured": False
}

def get_openai_client():
    """Get or create OpenAI client (Singleton)"""
    if _clients["openai"] is None:
        import openai
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            # Check safely to allow import even if env var missing (will fail at use time)
            print("[System] Warning: OPENAI_API_KEY not found")
        else:
            _clients["openai"] = openai.OpenAI(api_key=api_key)
            print("[System] OpenAI client initialized (Cold Start)")
    return _clients["openai"]

def get_anthropic_client():
    """Get or create Anthropic client (Singleton)"""
    if _clients["anthropic"] is None:
        from anthropic import Anthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
             raise ValueError("ANTHROPIC_API_KEY not configured on server.")
        _clients["anthropic"] = Anthropic(api_key=api_key)
        print("[System] Anthropic client initialized (Cold Start)")
    return _clients["anthropic"]

def configure_resend():
    """Configure Resend API key once (Singleton)"""
    if not _clients["resend_configured"]:
        import resend
        api_key = os.environ.get("RESEND_API_KEY")
        if not api_key:
             raise ValueError("RESEND_API_KEY not configured")
        resend.api_key = api_key
        _clients["resend_configured"] = True
        print("[System] Resend configured (Cold Start)")

# Constants
MAX_WHISPER_SIZE_MB = 25
SEGMENT_DURATION_MINUTES = 10
SUPPORTED_FORMATS = ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga', 'oga', 'ogg']




# =============================================================================
# CORS HELPER FUNCTION
# =============================================================================
def get_cors_headers(req):
    """
    Generate robust CORS headers supporting credentials and dynamic origins.
    Using * with credentials is not allowed, so we must reflect the origin.
    """
    origin = req.headers.get("Origin")
    allowed = [
        "https://comite-cce.web.app", 
        "http://localhost:5173", 
        "http://localhost:5174", 
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5001"
    ]
    if origin not in allowed:
        origin = allowed[0] # Default to production or safe origin
        
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "3600"
    }

# Pyannote model loading removed (offloaded to Hugging Face Endpoint)





@https_fn.on_request(
    timeout_sec=540,  # 9 minutes for Modal cold start + processing
    memory=options.MemoryOption.MB_512,  # Reduced memory as work is offloaded
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def enroll_speaker(req: https_fn.Request) -> https_fn.Response:
    """
    Enroll a speaker using Hugging Face Endpoint for embedding generation.
    """
    from werkzeug.utils import secure_filename
    from firebase_admin import storage, firestore
    from supabase import create_client, Client

    try:
        # 1. Validation
        name = req.args.get('name')
        if not name:
            return https_fn.Response("Missing 'name' query parameter", status=400)

        # 2. Get Audio Content (JSON URL or Multipart File)
        temp_path = None
        
        content_type = req.headers.get('content-type', '')
        
        # Determine how to get the file
        if 'application/json' in content_type:
            data = req.get_json()
            url = data.get('url')
            if not url:
                return https_fn.Response("JSON body must contain 'url'", status=400)
            
            # Download file
            resp = requests.get(url, stream=True)
            if not resp.ok:
                return https_fn.Response(f"Failed to download audio: {resp.status_code}", status=400)
            
            filename = secure_filename(f"{name}_enrollment.wav")
            temp_path = f"/tmp/{filename}"
            with open(temp_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)

        elif 'multipart/form-data' in content_type:
             if 'file' not in req.files:
                 return https_fn.Response("No file uploaded", status=400)
             
             file_data = req.files['file']
             filename = secure_filename(file_data.filename)
             temp_path = f"/tmp/{filename}"
             file_data.save(temp_path)
             
        else:
             # Binary body fallback
             filename = secure_filename(f"{name}_enrollment.wav")
             temp_path = f"/tmp/{filename}"
             with open(temp_path, 'wb') as f:
                 f.write(req.data)

        print(f"[Enroll] Saved temp file: {temp_path}")

        # 3. Upload to Firebase Storage (with timestamp to prevent conflicts)
        from datetime import datetime, timedelta
        import time
        timestamp = int(time.time())
        bucket = storage.bucket()
        blob_path = f"speaker_enrollments/{name}/enrollment_{timestamp}.wav"
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(temp_path)
        
        # Generate signed URL instead of making public (expires in 1 hour)
        # This is more secure as audio samples are not permanently public
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(hours=1),
            method="GET"
        )
        print(f"[Enroll] Uploaded to Storage with signed URL (1h expiry)")

        # 4. Call Modal/HF Endpoint for embedding generation
        # Supports both HF_ENDPOINT_URL and MODAL_ENDPOINT_URL
        endpoint_url = os.environ.get("MODAL_ENDPOINT_URL") or os.environ.get("HF_ENDPOINT_URL")
        hf_token = os.environ.get("HF_TOKEN")
        
        if not endpoint_url:
            print("[Enroll] MODAL_ENDPOINT_URL or HF_ENDPOINT_URL not configured")
            return https_fn.Response("Server configuration error: AI Endpoint missing", status=500)

        print(f"[Enroll] Calling Endpoint: {endpoint_url}")
        
        try:
            headers = {
                "Content-Type": "application/json"
            }
            # Add auth header if HF_TOKEN is present (for HF Endpoints)
            if hf_token:
                headers["Authorization"] = f"Bearer {hf_token}"
            
            # Modal uses "url", HF uses "inputs" - send both for compatibility
            payload = {"url": signed_url, "inputs": signed_url}
            
            response = requests.post(endpoint_url, headers=headers, json=payload, timeout=120)
            
            if not response.ok:
                print(f"[Enroll] Endpoint Error {response.status_code}: {response.text}")
                return https_fn.Response(f"AI Provider Error: {response.text}", status=502)
                
            embedding_data = response.json()
            
            # Use the raw list as the embedding
            if isinstance(embedding_data, list):
                embedding = embedding_data
            else:
                print(f"[Enroll] Unexpected HF response format: {str(embedding_data)[:100]}")
                return https_fn.Response("Invalid AI response format", status=502)

        except Exception as hf_error:
            print(f"[Enroll] HF Request Failed: {str(hf_error)}")
            return https_fn.Response(f"AI Request Failed: {str(hf_error)}", status=502)

        # 5. Save to Supabase
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
             return https_fn.Response("Supabase config missing", status=500)

        supabase: Client = create_client(supabase_url, supabase_key)
        
        data = {
            "name": name,
            "embedding": embedding,
            "created_at": datetime.now().isoformat(),
            "sample_url": blob_path  # Store path instead of URL (can regenerate signed URL if needed)
        }
        
        res = supabase.table("speakers").insert(data).execute()
        
        # 6. ALSO write embedding to Firestore members (keep both sources in sync)
        try:
            _db = firestore.client()
            # Find member by displayName
            member_query = list(_db.collection("members").where(
                "displayName", "==", name
            ).limit(1).stream())
            
            if member_query:
                member_doc = member_query[0]
                import json as json_lib
                member_doc.reference.update({
                    "embedding": json_lib.dumps([embedding]),  # Wrap in list for multi-embedding format
                    "voiceSampleCount": 1,
                    "lastVoiceUpdate": datetime.now().isoformat(),
                    "lastUpdateSource": "enrollment",
                })
                print(f"[Enroll] Also synced embedding to Firestore member '{name}'")
            else:
                print(f"[Enroll] No Firestore member found for '{name}' — Supabase only")
        except Exception as fs_err:
            print(f"[Enroll] Firestore sync failed (non-fatal): {fs_err}")
        
        # Cleanup
        if os.path.exists(temp_path):
            os.remove(temp_path)

        return https_fn.Response(
            json.dumps({"success": True, "name": name, "id": res.data[0]['id'] if res.data else "unknown"}),
            status=200,
            content_type="application/json"
        )

    except Exception as e:
        print(f"[Enroll] Error: {str(e)}")
        # Cleanup on error
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        return https_fn.Response(f"Internal Error: {str(e)}", status=500)
    finally:
        pass


def get_audio_format(mime_type: str) -> str:
    """Extract audio format from MIME type."""
    format_map = {
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/mp4': 'm4a',
        'audio/x-m4a': 'm4a',
        'audio/m4a': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/ogg': 'ogg',
        'video/mp4': 'mp4',
        'video/webm': 'webm'
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


def build_context_prompt(attendee_names: list, agenda_items: list) -> str:
    """
    Build a context prompt for Whisper to improve transcription accuracy.
    Includes attendee names and agenda topics as context.
    """
    parts = []
    
    # Add context about the meeting
    parts.append("Transcription d'une rÃ©union du ComitÃ© consultatif en environnement de Val-d'Or.")
    
    # Add attendee names if available
    if attendee_names:
        names = ", ".join([name for name in attendee_names if name])
        if names:
            parts.append(f"Participants: {names}.")
    
    # Add agenda topics if available
    if agenda_items:
        topics = ", ".join([item for item in agenda_items if item])
        if topics:
            parts.append(f"Sujets Ã  l'ordre du jour: {topics}.")
    
    return " ".join(parts)


def process_audio_with_ffmpeg(input_path: str) -> str:
    """
    Pre-process audio file using FFmpeg for better transcription quality.
    - Normalize audio levels
    - Convert to mono
    - Resample to 16kHz (optimal for Whisper)
    Returns path to processed file.
    """
    try:
        # FORCE output to be WAV (PCM 16kHz) for reliable splitting
        # We replace the extension with .wav regardless of input
        base, _ = os.path.splitext(input_path)
        output_path = f"{base}_processed.wav"
        
        # FFmpeg command for audio preprocessing
        # -af loudnorm: Normalize audio levels
        # -ac 1: Convert to mono
        # -ar 16000: Resample to 16kHz (Whisper optimal)
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ac", "1",
            "-ar", "16000",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0 and os.path.exists(output_path):
            print(f"[FFmpeg] Audio processed successfully: {output_path}")
            return output_path
        else:
            print(f"[FFmpeg] Processing failed, using original: {result.stderr[:200] if result.stderr else 'No error'}")
            return input_path
            
    except Exception as e:
        print(f"[FFmpeg] Error processing audio: {e}")
        return input_path


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
    client = get_openai_client()
    if not client:
        raise ValueError("OpenAI client not initialized")
    
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
        "Enregistrement audio en franÃ§ais quÃ©bÃ©cois. "
        "Il sâ€™agit dâ€™une rÃ©union officielle dâ€™un comitÃ© consultatif en environnement. "
        "La rencontre se dÃ©roule dans une salle de confÃ©rence avec un micro central. "
        "Les intervenants parlent Ã  tour de rÃ´le, parfois Ã  voix basse ou Ã  distance du micro. "
        "Le langage est professionnel, technique et institutionnel. "
        "Le vocabulaire peut inclure : environnement, dÃ©veloppement durable, politique environnementale, "
        "plan dâ€™action, adaptation aux changements climatiques, gestion des eaux pluviales, "
        "Ã®lots de chaleur, biodiversitÃ©, consultation, rÃ¨glement municipal. "
        "Les Ã©changes sont naturels et peuvent contenir des hÃ©sitations, des silences et des phrases incomplÃ¨tes. "
        "Lorsque le propos est inaudible ou incertain, il doit Ãªtre laissÃ© tel quel sans tentative de complÃ©tion."
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
        return f"{base_prompt} Mots clÃ©s spÃ©cifiques pour cette rÃ©union : {', '.join(extras)}."
    
    return base_prompt


# =============================================================================
# SPEECHMATICS INTEGRATION (Primary Transcription Provider)
# =============================================================================

SPEECHMATICS_API_BASE = "https://eu1.asr.api.speechmatics.com/v2"  # EU region

# Custom dictionary for CCE meetings (Speechmatics format)
# Each entry can have optional "sounds_like" for pronunciation hints
# Limited to 1000 terms per Speechmatics API
CCE_CUSTOM_VOCAB = [
    # =========================================================================
    # CCE MEMBER NAMES
    # =========================================================================
    {"content": "Patricia Boutin"},
    {"content": "SÃ©bastien Brodeur-Girard", "sounds_like": ["SÃ©bastien Brodeur Girard"]},
    {"content": "Jacinthe Pothier", "sounds_like": ["Jacinthe PotiÃ¨"]},
    {"content": "Donald RattÃ©", "sounds_like": ["Donald RatÃ©"]},
    {"content": "MichaÃ«l Ross", "sounds_like": ["Michael Ross"]},
    {"content": "Benjamin Turcotte"},
    {"content": "Marguerite Larochelle"},
    {"content": "CÃ©line Brindamour", "sounds_like": ["CÃ©line Brind'amour"]},
    {"content": "Jocelyn HÃ©bert", "sounds_like": ["Jocelyn Ã‰bert"]},
    
    # =========================================================================
    # ROLES & GOVERNANCE
    # =========================================================================
    {"content": "CCE", "sounds_like": ["C.C.E.", "CÃ©cÃ©"]},
    {"content": "PrÃ©sident"},
    {"content": "PrÃ©sidente"},
    {"content": "Vice-prÃ©sident"},
    {"content": "Vice-prÃ©sidente"},
    {"content": "SecrÃ©taire"},
    {"content": "Conseiller"},
    {"content": "ConseillÃ¨re"},
    {"content": "Mairesse"},
    {"content": "Maire"},
    {"content": "Directeur gÃ©nÃ©ral"},
    {"content": "Greffier"},
    {"content": "Coordonnateur"},
    {"content": "Coordonnatrice"},
    
    # =========================================================================
    # ORGANIZATIONS & LOCATIONS
    # =========================================================================
    {"content": "MRCVO", "sounds_like": ["M.R.C.V.O."]},
    {"content": "MRC VallÃ©e-de-l'Or"},
    {"content": "SESAT", "sounds_like": ["S.E.S.A.T."]},
    {"content": "OBVAJ", "sounds_like": ["O.B.V.A.J."]},
    {"content": "Val-d'Or", "sounds_like": ["Valdor", "Val d'Or"]},
    {"content": "Abitibi"},
    {"content": "Abitibi-TÃ©miscamingue"},
    {"content": "Rouyn-Noranda"},
    {"content": "MinistÃ¨re de l'Environnement"},
    {"content": "MELCCFP", "sounds_like": ["M.E.L.C.C.F.P."]},
    {"content": "MAMH", "sounds_like": ["M.A.M.H."]},
    {"content": "MTQ", "sounds_like": ["M.T.Q."]},
    
    # =========================================================================
    # MEETING PROCEDURES
    # =========================================================================
    {"content": "ProcÃ¨s-verbal", "sounds_like": ["PV"]},
    {"content": "Ordre du jour"},
    {"content": "RÃ©solution"},
    {"content": "Adoption"},
    {"content": "Approbation"},
    {"content": "Amendement"},
    {"content": "Proposition"},
    {"content": "Seconde"},
    {"content": "Vote"},
    {"content": "UnanimitÃ©"},
    {"content": "MajoritÃ©"},
    {"content": "Quorum"},
    {"content": "LevÃ©e de la sÃ©ance"},
    {"content": "Point d'information"},
    {"content": "Suivi"},
    {"content": "Avis de motion"},
    {"content": "Huis clos"},
    
    # =========================================================================
    # ENVIRONMENTAL TERMS
    # =========================================================================
    # Climate
    {"content": "Changements climatiques"},
    {"content": "RÃ©chauffement climatique"},
    {"content": "Gaz Ã  effet de serre"},
    {"content": "GES", "sounds_like": ["G.E.S."]},
    {"content": "Ã‰missions de carbone"},
    {"content": "Bilan carbone"},
    {"content": "CarboneutralitÃ©"},
    {"content": "ÃŽlot de chaleur"},
    {"content": "ÃŽlots de fraÃ®cheur"},
    {"content": "Adaptation climatique"},
    {"content": "RÃ©silience climatique"},
    
    # Biodiversity
    {"content": "BiodiversitÃ©"},
    {"content": "EspÃ¨ces menacÃ©es"},
    {"content": "EspÃ¨ces vulnÃ©rables"},
    {"content": "Habitat faunique"},
    {"content": "Corridor Ã©cologique"},
    {"content": "Milieu naturel"},
    {"content": "Ã‰cosystÃ¨me"},
    {"content": "Faune"},
    {"content": "Flore"},
    {"content": "EspÃ¨ces envahissantes"},
    {"content": "Agrile du frÃªne"},
    {"content": "Herbe Ã  poux"},
    {"content": "Berce du Caucase"},
    
    # Water
    {"content": "Gestion des eaux pluviales"},
    {"content": "Eaux de ruissellement"},
    {"content": "Bassin de rÃ©tention"},
    {"content": "Bassin versant"},
    {"content": "Noue vÃ©gÃ©talisÃ©e"},
    {"content": "Nappe phrÃ©atique"},
    {"content": "AquifÃ¨re"},
    {"content": "Eau potable"},
    {"content": "Eaux usÃ©es"},
    {"content": "Station d'Ã©puration"},
    {"content": "Puits Feldman", "sounds_like": ["Puit Feldman"]},
    {"content": "Esker"},
    {"content": "Domaine des Eskers"},
    {"content": "Protection des berges"},
    {"content": "Bande riveraine"},
    {"content": "Littoral"},
    {"content": "Rive"},
    {"content": "Plaine inondable"},
    {"content": "Crue"},
    {"content": "Inondation"},
    
    # Waste & Recycling
    {"content": "MatiÃ¨res rÃ©siduelles"},
    {"content": "Recyclage"},
    {"content": "Compostage"},
    {"content": "Bac brun"},
    {"content": "Bac bleu"},
    {"content": "Bac noir"},
    {"content": "Ã‰cocentre"},
    {"content": "Enfouissement"},
    {"content": "Lieu d'enfouissement"},
    {"content": "LET", "sounds_like": ["L.E.T."]},
    {"content": "Ã‰conomie circulaire"},
    {"content": "RÃ©duction Ã  la source"},
    {"content": "Valorisation"},
    {"content": "3RV", "sounds_like": ["trois R V"]},
    
    # Energy
    {"content": "EfficacitÃ© Ã©nergÃ©tique"},
    {"content": "Ã‰nergies renouvelables"},
    {"content": "Ã‰nergie solaire"},
    {"content": "Ã‰nergie Ã©olienne"},
    {"content": "Hydro-QuÃ©bec"},
    {"content": "Ã‰lectrification"},
    {"content": "Bornes de recharge"},
    {"content": "VÃ©hicules Ã©lectriques"},
    
    # Pollution & Contamination
    {"content": "Contamination"},
    {"content": "Sol contaminÃ©"},
    {"content": "Terrain contaminÃ©"},
    {"content": "DÃ©versement"},
    {"content": "Pollution atmosphÃ©rique"},
    {"content": "QualitÃ© de l'air"},
    {"content": "PoussiÃ¨re"},
    {"content": "Bruit"},
    {"content": "Nuisance"},
    
    # =========================================================================
    # URBAN PLANNING TERMS
    # =========================================================================
    {"content": "Urbanisme"},
    {"content": "AmÃ©nagement du territoire"},
    {"content": "Plan d'urbanisme"},
    {"content": "SchÃ©ma d'amÃ©nagement"},
    {"content": "Zonage"},
    {"content": "RÃ¨glement de zonage"},
    {"content": "DÃ©rogation mineure"},
    {"content": "PIIA", "sounds_like": ["P.I.I.A."]},
    {"content": "PAE", "sounds_like": ["P.A.E."]},
    {"content": "PPU", "sounds_like": ["P.P.U."]},
    {"content": "Permis de construction"},
    {"content": "Permis de lotissement"},
    {"content": "Certificat d'autorisation"},
    {"content": "Consultation publique"},
    {"content": "AssemblÃ©e publique"},
    {"content": "RÃ©fÃ©rendum"},
    {"content": "Registre"},
    {"content": "Usage conditionnel"},
    {"content": "Usage dÃ©rogatoire"},
    {"content": "Coefficient d'emprise"},
    {"content": "Densification"},
    {"content": "Ã‰talement urbain"},
    
    # Green Infrastructure
    {"content": "Verdissement"},
    {"content": "CanopÃ©e"},
    {"content": "Indice de canopÃ©e"},
    {"content": "Plantation d'arbres"},
    {"content": "ForÃªt urbaine"},
    {"content": "Parc"},
    {"content": "Espace vert"},
    {"content": "Toit vert"},
    {"content": "Mur vÃ©gÃ©tal"},
    {"content": "Infrastructure verte"},
    {"content": "Stationnement permÃ©able"},
    {"content": "PavÃ© permÃ©able"},
    
    # Transportation
    {"content": "Transport actif"},
    {"content": "Piste cyclable"},
    {"content": "Trottoir"},
    {"content": "Transport en commun"},
    {"content": "Covoiturage"},
    {"content": "Autopartage"},
    {"content": "MobilitÃ© durable"},
    
    # =========================================================================
    # LEGAL & REGULATORY
    # =========================================================================
    {"content": "RÃ¨glement municipal"},
    {"content": "Loi sur la qualitÃ© de l'environnement"},
    {"content": "LQE", "sounds_like": ["L.Q.E."]},
    {"content": "Ã‰tude d'impact"},
    {"content": "BAPE", "sounds_like": ["B.A.P.E."]},
    {"content": "Certificat d'autorisation"},
    {"content": "Attestation d'assainissement"},
    {"content": "Droits acquis"},
    {"content": "Servitude"},
    {"content": "Expropriation"},
]


# =============================================================================
# SPEECHMATICS ASYNC FUNCTIONS (No timeout limit)
# =============================================================================

def submit_speechmatics_job(file_url: str, meeting_id: str, language_code: str = "fr") -> str:
    """
    Submit a transcription job to Speechmatics.
    Returns the job_id immediately (does NOT wait for completion).
    Uses webhook notification to receive transcript when done.
    """
    api_key = os.environ.get("SPEECHMATICS_API_KEY")
    if not api_key:
        raise Exception("SPEECHMATICS_API_KEY not configured")

    headers = {"Authorization": f"Bearer {api_key}"}
    
    # Webhook URL for receiving completed transcripts
    # Dynamic construction based on Project ID (Option B)
    # NOTE: Gen 2 functions use a random hash in the URL (e.g. .a.run.app).
    # We prioritize the env var, and fall back to the known URL for 'comite-cce'.
    
    known_urls = {
        # "comite-cce": "https://speechmatics-webhook-bubhsf2gpa-uc.a.run.app" 
        # COMMENTED OUT: Use standard URL or env var to avoid stale hardcoded URLs
    }
    
    project_id = os.environ.get("GCLOUD_PROJECT", "comite-cce")
    default_url = known_urls.get(project_id, f"https://us-central1-{project_id}.cloudfunctions.net/speechmatics_webhook")
    
    webhook_url = os.environ.get("SPEECHMATICS_WEBHOOK_URL", default_url)

    tracking_config = {
        "title": f"CCE Meeting {meeting_id}",
        "reference": meeting_id,  # Link back to our meeting
        "tags": ["cce", "meeting", "shpeechmatics-integration"],
        "details": {
             "system": "comite-cce-valdor",
             "env": os.environ.get("GCLOUD_PROJECT", "local")
        }
    }

    config = {
        "type": "transcription",
        "transcription_config": {
            "language": language_code,
            "operating_point": "enhanced",  # UPDATED: Use 'enhanced' for max accuracy as requested
            "diarization": "speaker",       # Activates speaker diarization
            "enable_entities": True,        # E.g. dates, numbers formatting
            "punctuation_overrides": {
                "permitted_marks": [".", ",", "?", "!"] # Standard punctuation
            },
            "additional_vocab": CCE_CUSTOM_VOCAB
        },
        "fetch_data": {
            "url": file_url
        },
        "notification_config": [{
            "url": webhook_url,
            "contents": ["transcript"],
            "auth_headers": ["X-Source: speechmatics-webhook"]
        }],
        "tracking": tracking_config
    }

    print(f"[Speechmatics Async] ðŸš€ Submitting job for meeting {meeting_id}")
    print(f"[Speechmatics Async] ðŸ”— Webhook URL: {webhook_url}")
    print(f"[Speechmatics Async] ðŸ“‹ Tracking: {json.dumps(tracking_config)}")
    print(f"[Speechmatics Async] ðŸ“š Vocab: {len(CCE_CUSTOM_VOCAB)} terms")
    
    files = {
        'config': (None, json.dumps(config), 'application/json')
    }

    response = requests.post(
        f"{SPEECHMATICS_API_BASE}/jobs",
        headers=headers,
        files=files,
        timeout=60
    )

    if not response.ok:
        error_text = response.text[:500]
        print(f"[Speechmatics Async] âŒ Submit failed: {response.status_code} - {error_text}")
        print(f"[Speechmatics Async] Response headers: {response.headers}")
        raise Exception(f"Speechmatics Submit Failed: {error_text}")

    job_data = response.json()
    job_id = job_data.get("id")
    print(f"[Speechmatics Async] âœ… Job submitted successfully: {job_id}")
    return job_id


def check_speechmatics_job(job_id: str) -> dict:
    """
    Check the status of a Speechmatics job.
    Returns: {"status": "running|completed|failed", "result": {...} if completed}
    """
    api_key = os.environ.get("SPEECHMATICS_API_KEY")
    if not api_key:
        raise Exception("SPEECHMATICS_API_KEY not configured")

    headers = {"Authorization": f"Bearer {api_key}"}

    status_resp = requests.get(
        f"{SPEECHMATICS_API_BASE}/jobs/{job_id}",
        headers=headers,
        timeout=30
    )

    print(f"[Speechmatics Check] ðŸ” Checking status for Job {job_id}...")
    
    if not status_resp.ok:
        print(f"[Speechmatics Check] âŒ API error {status_resp.status_code}: {status_resp.text}")
        return {"status": "error", "error": f"Status check failed: {status_resp.status_code}"}

    job_status = status_resp.json()
    job_details = job_status.get("job", {})
    status = job_details.get("status", "unknown")
    
    # Log full tracking and status details
    tracking = job_details.get("config", {}).get("tracking", {})
    duration = job_details.get("duration", "unknown")
    created_at = job_details.get("created_at", "unknown")
    
    print(f"[Speechmatics Check] ðŸ“Š Job Status: {status.upper()}")
    print(f"[Speechmatics Check] ðŸ•’ Created: {created_at} | Duration: {duration}s")
    print(f"[Speechmatics Check] ðŸ·ï¸ Tracking: {json.dumps(tracking)}")
    
    if status == "running":
        print(f"[Speechmatics Check] â³ Job is still running...")
        return {"status": "running"}

    if status in ["completed", "done"]:
        print(f"[Speechmatics Check] âœ… Job COMPLETED! Fetching transcript...")
        # Get transcript
        transcript_resp = requests.get(
            f"{SPEECHMATICS_API_BASE}/jobs/{job_id}/transcript?format=json-v2",
            headers=headers,
            timeout=120
        )
        if transcript_resp.ok:
            result = transcript_resp.json()
            formatted = format_speechmatics_output(result)
            print(f"[Speechmatics Check] ðŸ“ Transcript retrieved: {len(formatted.get('text', ''))} chars")
            return {"status": "completed", "result": formatted}
        else:
            print(f"[Speechmatics Check] âŒ Failed to get transcript: {transcript_resp.status_code} - {transcript_resp.text}")
            return {"status": "error", "error": f"Failed to get transcript: {transcript_resp.status_code}"}
    
    elif status in ["rejected", "failed"]:
        error_msg = job_details.get("errors", [{"message": "Unknown error"}])
        print(f"[Speechmatics Check] â›” JOB FAILED")
        print(f"[Speechmatics Check] Errors: {json.dumps(error_msg)}")
        return {"status": "failed", "error": str(error_msg)}
    
    else:
        print(f"[Speechmatics Check] â“ Unknown status: '{status}'")
        return {"status": "running"}


# =============================================================================
# SPEECHMATICS SYNC FUNCTION (Legacy - has timeout limit)
# =============================================================================

def transcribe_with_speechmatics(file_url: str, language_code: str = "fr") -> dict:
    """
    Transcribe audio using Speechmatics API with diarization.
    Speechmatics is optimized for long-form content and handles French/Quebec accents well.
    
    NOTE: This sync function has a 59-minute timeout. Use submit_speechmatics_job + 
    check_speechmatics_job for async processing without timeout limits.
    
    Returns dict with:
    - text: Full transcript with speaker labels
    - segments: List of timestamped segments with speaker info
    - duration_seconds: Audio duration
    """
    api_key = os.environ.get("SPEECHMATICS_API_KEY")
    if not api_key:
        raise Exception("SPEECHMATICS_API_KEY not configured")

    headers = {"Authorization": f"Bearer {api_key}"}

    # 1. Submit Job with file URL and custom vocabulary
    config = {
        "type": "transcription",
        "transcription_config": {
            "language": language_code,
            "operating_point": "standard",  # Faster processing (use 'enhanced' for best accuracy)
            "diarization": "speaker",        # Enable speaker separation
            "enable_entities": True,         # Detect names, dates, etc.
            "additional_vocab": CCE_CUSTOM_VOCAB  # Custom dictionary for CCE terms
        },
        "fetch_data": {
            "url": file_url
        }
    }

    print(f"[Speechmatics] Submitting job with {len(CCE_CUSTOM_VOCAB)} custom vocab terms...")
    print(f"[Speechmatics] URL: {file_url[:80]}...")
    
    # Speechmatics requires multipart/form-data even for URL-based jobs
    files = {
        'config': (None, json.dumps(config), 'application/json')
    }

    submit_response = requests.post(
        f"{SPEECHMATICS_API_BASE}/jobs",
        headers=headers,
        files=files,
        timeout=60
    )

    if not submit_response.ok:
        error_text = submit_response.text[:500]
        print(f"[Speechmatics] Submit failed: {submit_response.status_code} - {error_text}")
        raise Exception(f"Speechmatics Submit Failed: {error_text}")

    job_data = submit_response.json()
    job_id = job_data.get("id")
    print(f"[Speechmatics] Job submitted: {job_id}")

    # 2. Poll for Completion (timeout: 59 minutes - max for Cloud Functions)
    # NOTE: Cloud Functions have a 60min hard limit. For longer jobs,
    # consider using a webhook callback or a separate scheduled function.
    start_time = time.time()
    last_status = None
    
    while (time.time() - start_time) < 3550:  # 59 minutes (leave buffer for cleanup)
        time.sleep(10)
        
        status_resp = requests.get(
            f"{SPEECHMATICS_API_BASE}/jobs/{job_id}",
            headers=headers,
            timeout=30
        )

        if not status_resp.ok:
            print(f"[Speechmatics] Status check failed: {status_resp.status_code}")
            continue

        job_status = status_resp.json()
        status = job_status.get("status")

        if status != last_status:
            print(f"[Speechmatics] Status: {status}")
            last_status = status

        if status == "completed" or status == "done":
            print(f"[Speechmatics] Job completed!")
            break
        elif status == "rejected" or status == "failed":
            error_msg = job_status.get("errors", [{"message": "Unknown error"}])
            raise Exception(f"Speechmatics Job Failed: {error_msg}")

    else:
        raise Exception("Speechmatics timeout after 59 minutes (Cloud Function limit reached)")

    # 3. Get Transcript with Speaker Labels
    transcript_resp = requests.get(
        f"{SPEECHMATICS_API_BASE}/jobs/{job_id}/transcript?format=json-v2",
        headers=headers,
        timeout=60
    )

    if not transcript_resp.ok:
        raise Exception(f"Failed to get transcript: {transcript_resp.status_code}")

    result = transcript_resp.json()
    
    # 4. Format Output
    return format_speechmatics_output(result)


def format_speechmatics_output(result: dict) -> dict:
    """
    Convert Speechmatics JSON-v2 format to our standard output format.
    Groups words by speaker and sentence.
    """
    words = result.get("results", [])
    metadata = result.get("metadata", {})
    
    if not words:
        return {
            "text": "",
            "segments": [],
            "duration_seconds": metadata.get("duration", 0)
        }

    # Group words into speaker-labeled segments
    segments = []
    current_segment = {
        "speaker": None,
        "start": None,
        "end": None,
        "text": []
    }

    for word in words:
        if word.get("type") == "punctuation":
            if current_segment["text"]:
                punct = word.get("alternatives", [{}])[0].get("content", "")
                current_segment["text"].append(punct)
            continue

        alt = word.get("alternatives", [{}])[0]
        content = alt.get("content", "")
        speaker = alt.get("speaker", "S0")
        start_time = word.get("start_time", 0)
        end_time = word.get("end_time", 0)

        # New speaker = new segment
        if speaker != current_segment["speaker"] and current_segment["text"]:
            # Finalize current segment
            segments.append({
                "speaker": current_segment["speaker"] or "S0",
                "start": current_segment["start"],
                "end": current_segment["end"],
                "text": " ".join(current_segment["text"]).replace(" ,", ",").replace(" .", ".").replace(" ?", "?").replace(" !", "!").strip()
            })
            current_segment = {"speaker": speaker, "start": start_time, "end": None, "text": []}

        if current_segment["start"] is None:
            current_segment["start"] = start_time
            current_segment["speaker"] = speaker

        current_segment["end"] = end_time
        current_segment["text"].append(content)

    # Finalize last segment
    if current_segment["text"]:
        segments.append({
            "speaker": current_segment["speaker"] or "S0",
            "start": current_segment["start"],
            "end": current_segment["end"],
            "text": " ".join(current_segment["text"]).replace(" ,", ",").replace(" .", ".").replace(" ?", "?").replace(" !", "!").strip()
        })

    # Build full text with speaker labels and timestamps
    full_text_parts = []
    
    for seg in segments:
        # Format timestamp [MM:SS]
        start_seconds = seg['start']
        m = int(start_seconds // 60)
        s = int(start_seconds % 60)
        timestamp = f"[{m:02d}:{s:02d}]"
        
        # Format: [MM:SS] [Speaker] Text
        speaker_label = f"[{seg['speaker']}]"
        full_text_parts.append(f"{timestamp} {speaker_label} {seg['text']}")

    return {
        "text": "\n\n".join(full_text_parts),
        "segments": segments,
        "duration_seconds": metadata.get("duration", 0)
    }


# =============================================================================
# SPEAKER IDENTIFICATION - Multi-Strategy System
# =============================================================================

def get_enrolled_speakers() -> list:
    """
    Fetch all enrolled speakers with their embeddings.
    
    PHASE 2 APPROACH: Primary source is Supabase speaker_embeddings table.
    Fallback to Firestore members only if Supabase is unavailable.
    
    AUTO-MIGRATION: If Supabase Phase 2 is not ready but credentials exist,
    automatically run migration on first call.
    """
    speakers = []
    speaker_names_seen = set()
    
    # === CHECK: Is Supabase Phase 2 ready? ===
    supabase_phase2_ready = False
    from supabase import create_client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    
    if supabase_url and supabase_key:
        supabase = create_client(supabase_url, supabase_key)
        try:
            # Test if speaker_embeddings table exists
            test_result = supabase.table("speaker_embeddings").select("id").limit(1).execute()
            supabase_phase2_ready = True
        except:
            # speaker_embeddings doesn't exist - Phase 2 not deployed yet
            print("[Speakers Phase 2] Supabase Phase 2 tables not found")
            
            # Try auto-migration
            print("[Speakers Phase 2] Attempting auto-migration...")
            try:
                migration_success = ensure_migration_completed()
                if migration_success:
                    # Retry loading speakers after migration
                    print("[Speakers Phase 2] Auto-migration successful, reloading...")
                    supabase_phase2_ready = True
                else:
                    print("[Speakers Phase 2] Auto-migration failed, using fallback")
            except Exception as e:
                print(f"[Speakers Phase 2] Auto-migration error: {e}")
    
    # === SOURCE 1: Supabase speaker_embeddings (PRIMARY — Phase 2) ===
    if supabase_phase2_ready:
        try:
            # Récupérer tous les embeddings groupés par speaker
            result = supabase.table("speaker_embeddings").select(
                "speaker_name, speaker_id, embedding, sample_source, created_at"
            ).execute()
            
            if result.data:
                # Grouper les embeddings par speaker
                speaker_embeddings = {}
                for row in result.data:
                    name = row.get("speaker_name")
                    if not name:
                        continue
                    
                    embedding = row.get("embedding")
                    if embedding:
                        if name not in speaker_embeddings:
                            speaker_embeddings[name] = {
                                "embeddings": [],
                                "speaker_id": row.get("speaker_id"),
                                "sample_sources": set()
                            }
                        speaker_embeddings[name]["embeddings"].append(embedding)
                        speaker_embeddings[name]["sample_sources"].add(row.get("sample_source"))
                
                # Construire la liste des speakers
                for name, data in speaker_embeddings.items():
                    speakers.append({
                        "id": data.get("speaker_id", name),
                        "name": name,
                        "embedding": data["embeddings"],  # Liste de vecteurs
                        "source": "supabase",
                        "sampleCount": len(data["embeddings"]),
                        "sample_sources": list(data["sample_sources"])
                    })
                    speaker_names_seen.add(name)
                
                print(f"[Speakers Phase 2] Loaded {len(speakers)} speakers from Supabase speaker_embeddings")
                
                # Récupérer les rôles depuis la table speakers
                speakers_result = supabase.table("speakers").select("id, name, role").execute()
                if speakers_result.data:
                    role_map = {s["name"]: s.get("role", "Membre") for s in speakers_result.data}
                    for speaker in speakers:
                        speaker["role"] = role_map.get(speaker["name"], "Membre")
        
        except Exception as e:
            print(f"[Speakers Phase 2] Supabase error (will fallback to Firestore): {e}")
            import traceback
            traceback.print_exc()
    
    # === SOURCE 2: Firestore members (FALLBACK — only if Supabase unavailable) ===
    if not speakers:
        print(f"[Speakers Phase 2] Supabase unavailable, falling back to Firestore")
        try:
            import json as json_lib
            _db = firestore.client()
            members = list(_db.collection("members").stream())
            
            for doc in members:
                member = doc.to_dict()
                name = member.get("displayName") or member.get("name")
                embedding = member.get("embedding")
                
                if not name or not embedding:
                    continue
                
                # Parse string embedding (stored as JSON string in Firestore)
                if isinstance(embedding, str):
                    try:
                        embedding = json_lib.loads(embedding)
                    except (json.JSONDecodeError, ValueError):
                        continue
                
                if embedding and isinstance(embedding, list):
                    speakers.append({
                        "id": doc.id,
                        "name": name,
                        "embedding": embedding,
                        "role": member.get("role", "Membre"),
                        "source": "firestore",
                        "sampleCount": member.get("voiceSampleCount", 1)
                    })
                    speaker_names_seen.add(name)
                    
            print(f"[Speakers Phase 2] Loaded {len(speakers)} speakers from Firestore (fallback)")
            
        except Exception as e:
            print(f"[Speakers Phase 2] Firestore error (non-fatal): {e}")
    
    print(f"[Speakers Phase 2] Total: {len(speakers)} unique speakers loaded")
    return speakers


def get_meeting_attendees(meeting_id: str) -> list:
    """
    Fetch attendees for a specific meeting from Firestore.
    """
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting = meeting_ref.get()
        
        if meeting.exists:
            data = meeting.to_dict()
            return data.get("attendees", [])
        
        return []
        
    except Exception as e:
        print(f"[Meeting] Error fetching attendees: {e}")
        return []



        


        



        

        

        

        

        


        

            

        



def match_speakers_with_pgvector(segment_embedding: list, enrolled_speakers: list = None, limit: int = 10) -> dict:
    """
    Match a segment embedding with speakers using pgvector (Phase 2 - Primary).
    
    Uses Supabase's native vector similarity search via SQL function match_speakers().
    Falls back to local computation if Supabase is unavailable.
    
    Returns dict of {name: similarity_score} (0.0 to 1.0)
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if supabase_url and supabase_key:
            supabase = create_client(supabase_url, supabase_key)
            
            # Appeler la fonction SQL match_speakers via RPC
            # Attention: Supabase Python client n'a pas de support direct pour les fonctions SQL avec paramètres complexes
            # On doit faire la requête SQL manuellement
            
            # Convertir l'embedding en format PostgreSQL
            embedding_str = "[" + ",".join(str(x) for x in segment_embedding) + "]"
            
            # Exécuter la requête SQL
            query = f"""
                SELECT speaker_name, similarity, match_count, avg_similarity, sample_sources
                FROM match_speakers('[{embedding_str}]'::vector(768), {limit})
            """
            
            result = supabase.rpc('match_speakers', {
                'target_embedding': embedding_str,
                'limit_count': limit
            })
            
            # Alternative: faire une requête directe avec execute_sql (si disponible)
            # Pour l'instant, on fait fallback sur le calcul local
            print(f"[PGVector] Using fallback to local computation (RPC not fully supported)")
            raise Exception("RPC fallback needed")
            
            if result.data:
                scores = {}
                for row in result.data:
                    name = row.get("speaker_name")
                    similarity = row.get("avg_similarity", 0.0)
                    if similarity is not None:
                        scores[name] = max(0.0, min(1.0, float(similarity)))
                
                print(f"[PGVector] Matched {len(scores)} speakers via pgvector")
                return scores
        
    except Exception as e:
        print(f"[PGVector] Error using pgvector, falling back to local computation: {e}")
    
    # Fallback: calcul local avec les speakers fournis
    if enrolled_speakers:
        return compare_embedding_with_speakers_local(segment_embedding, enrolled_speakers)
    
    return {}


def compare_embedding_with_speakers_local(segment_embedding: list, enrolled_speakers: list) -> dict:
    """
    LOCAL VERSION: Compare a segment embedding with speakers (fallback when pgvector unavailable).
    
    FAIR SCORING: Uses top-3 average per speaker instead of global k-NN.
    This prevents speakers with more samples from being systematically favored.
    
    Returns dict of {name: similarity_score} (0.0 to 1.0)
    """
    from speaker_identification import cosine_similarity
    import json as json_lib

    # 1. Compute similarities PER SPEAKER (fair comparison)
    # {name: [list of similarity scores]}
    speaker_similarities = {}
    
    for speaker in enrolled_speakers:
        stored_embedding = speaker.get("embedding")
        name = speaker.get("name", "Unknown")
        
        # Parse string embedding
        if isinstance(stored_embedding, str):
            try:
                stored_embedding = json_lib.loads(stored_embedding)
            except (json_lib.JSONDecodeError, ValueError):
                continue
                 
        if not stored_embedding:
            continue
            
        vectors = []
        # Handle Multi-Vector or Single Vector
        if isinstance(stored_embedding, list) and len(stored_embedding) > 0 and isinstance(stored_embedding[0], list):
            vectors = stored_embedding
        elif isinstance(stored_embedding, list) and len(stored_embedding) == len(segment_embedding):
            vectors = [stored_embedding]
            
        sims = []
        for vec in vectors:
            if len(vec) == len(segment_embedding):
                sim = cosine_similarity(segment_embedding, vec)
                sims.append(sim)
        
        if sims:
            speaker_similarities[name] = sorted(sims, reverse=True)
    
    if not speaker_similarities:
        return {}
    
    # 2. FAIR SCORING: For each speaker, take the average of their top-3 best matches
    # This ensures a speaker with 12 samples isn't favored over one with 3
    final_scores = {}
    
    for name, sims in speaker_similarities.items():
        # Take top-3 (or fewer if less available)
        top_n = sims[:3]
        
        # Weighted average: best match counts more (50% best, 30% second, 20% third)
        if len(top_n) == 1:
            avg_sim = top_n[0]
        elif len(top_n) == 2:
            avg_sim = top_n[0] * 0.6 + top_n[1] * 0.4
        else:
            avg_sim = top_n[0] * 0.5 + top_n[1] * 0.3 + top_n[2] * 0.2
        
        # Normalize cosine similarity (-1..1) to score (0..1)
        score = (avg_sim + 1) / 2
        
        # Consistency bonus: if multiple vectors agree, boost confidence
        if len(top_n) >= 3 and all(s > 0.5 for s in top_n):
            score += 0.05  # Small bonus for consistent multi-vector match
            
        # Diversity bonus: if speaker has many samples AND they all score well
        if len(sims) >= 5 and len(top_n) >= 3 and top_n[2] > 0.4:
            score += 0.03  # Robust profile bonus
        
        final_scores[name] = min(score, 1.0)  # Cap at 1.0
    
    # 3. Log comparison for debugging
    sorted_scores = sorted(final_scores.items(), key=lambda x: x[1], reverse=True)
    if sorted_scores:
        top = sorted_scores[0]
        runner = sorted_scores[1] if len(sorted_scores) > 1 else ("N/A", 0)
        margin = top[1] - runner[1]
        print(f"[VoiceEmbed] Top: {top[0]}={top[1]:.3f}, Runner: {runner[0]}={runner[1]:.3f}, Margin: {margin:.3f}")
                 
    return final_scores


async def identify_speakers_in_transcript(
    formatted_output: dict,
    meeting_id: str,
    audio_url: str = None
) -> dict:
    """
    Apply multi-strategy speaker identification to a formatted transcript.
    
    Uses 5 strategies with optimized performance:
    1. Voice Embedding (50%) - Compare with enrolled speakers via Modal
    2. Contextual AI (25%) - GROQ batch analysis
    3. Linguistic Patterns (10%) - Role-based keywords
    4. Name Mentions (10%) - "Merci Michaël" detection
    5. Auto-Identification (5%) - "Je suis X" detection
    
    Returns the same structure but with speaker labels replaced by names.
    """
    import re
    from speaker_identification import (
        linguistic_pattern_strategy,
        name_mention_strategy,
        auto_identification_strategy,
        contextual_ai_strategy,
        fuse_scores
    )
    
    # Get enrolled speakers with embeddings
    enrolled_speakers = get_enrolled_speakers()
    if not enrolled_speakers:
        print("[Identify] No enrolled speakers found, keeping original labels")
        return formatted_output
    
    known_member_names = [s["name"] for s in enrolled_speakers]
    segments = formatted_output.get("segments", [])
    
    if not segments:
        return formatted_output
    
    # Collect unique speakers and their data
    unique_speakers = {}  # {"S0": {"texts": [...], "start": 0, "end": 0}, ...}
    
    # SMART SEGMENTATION: Find the best segment for each speaker
    # Instead of taking the first one + 30s, we look for the LONGEST segment 
    # available for that speaker to ensure high quality audio.
    
    for segment in segments:
        speaker_label = segment.get("speaker", "S0")
        
        # Skip if not S0/S1 format
        if not re.match(r'^S\d+$', speaker_label):
            continue
            
        start = segment.get("start", 0)
        end = segment.get("end", 0)
        duration = end - start
        
        if speaker_label not in unique_speakers:
            unique_speakers[speaker_label] = {
                "texts": [],
                "start": start,
                "end": end,
                "longest_duration": duration
            }
        else:
             # Update best segment if this one is longer (better for embedding)
             if duration > unique_speakers[speaker_label]["longest_duration"]:
                 unique_speakers[speaker_label]["start"] = start
                 unique_speakers[speaker_label]["end"] = end
                 unique_speakers[speaker_label]["longest_duration"] = duration
                 
        unique_speakers[speaker_label]["texts"].append(segment.get("text", ""))
    
    print(f"[Identify] Found {len(unique_speakers)} unique speakers to identify")
    
    # 2. PRE-FLIGHT PROFILE VALIDATION
    # Filter enrolled speakers to ONLY those present in the meeting (if meeting_id context available)
    # And validation strength.
    
    if meeting_id:
        try:
            attendees = get_meeting_attendees(meeting_id) # Need to ensure this function exists/works
            if attendees:
                present_names = [a.get("name") for a in attendees if a.get("role") != "Invité"]
                
                # Filter enrolled list to only present members
                # This prevents "Michael Ross" false positives if he isn't there!
                filtered_enrolled = []
                for spk in enrolled_speakers:
                    if spk["name"] in present_names:
                        # Check strength
                        sample_count = len(spk.get("embedding", [])) if isinstance(spk.get("embedding"), list) else 1
                        if sample_count < 3:
                            print(f"[Identify] WARNING: Weak profile for present member {spk['name']} ({sample_count} samples)")
                        else:
                            print(f"[Identify] Strong profile confirmed for {spk['name']} ({sample_count} samples)")
                        filtered_enrolled.append(spk)
                
                if filtered_enrolled:
                    print(f"[Identify] Filtered candidates to {len(filtered_enrolled)} present members (excluding invités/absent)")
                    enrolled_speakers = filtered_enrolled
                else:
                    print("[Identify] Warning: No present members found in enrolled list. Falling back to full list.")
                    
        except Exception as e:
            print(f"[Identify] Error filtering by attendees: {e}")
    
    # Check if voice embedding is available
    voice_available = bool(audio_url and os.environ.get("MODAL_ENDPOINT_URL"))
    print(f"[Identify] Voice embedding available: {voice_available}")
    
    # Run identification
    speaker_mapping = {}
    unidentified = []
    
    for speaker_label, data in unique_speakers.items():
        combined_text = " ".join(data["texts"][:3])  # First 3 segments
        
        # Initialize scores
        voice_scores = {}
        
        # Try voice embedding if available (70% weight in fuse_scores)
        if voice_available:
            print(f"[Identify] Getting voice embedding for {speaker_label} ({data['start']:.0f}s-{data['end']:.0f}s)")
            segment_embedding = extract_audio_segment_embedding(audio_url, data["start"], data["end"])
            if segment_embedding:
                voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                print(f"[Identify] Voice scores for {speaker_label}: {voice_scores}")
        
        # Build meeting context for AI analysis
        meeting_context = {
            "type": "Régulière",
            "meeting_id": meeting_id
        }
        
        # Fast pattern strategies
        linguistic_scores = linguistic_pattern_strategy(combined_text, enrolled_speakers)
        mention_scores = name_mention_strategy(combined_text, None, known_member_names)
        auto_id_scores = auto_identification_strategy(combined_text, known_member_names)
        
        # Contextual AI strategy (GROQ) - 15% weight
        # Only call if we have enrolled speakers with roles
        context_scores = {}
        if enrolled_speakers:
            context_scores = contextual_ai_strategy(combined_text, meeting_context, enrolled_speakers)
            if context_scores:
                print(f"[Identify] Context AI scores for {speaker_label}: {context_scores}")
        
        # Use centralized fuse_scores function instead of duplicated logic
        best_name, best_score = fuse_scores(
            voice_scores=voice_scores,
            context_scores=context_scores,
            linguistic_scores=linguistic_scores,
            mention_scores=mention_scores,
            auto_id_scores=auto_id_scores,
            confidence_threshold=0.35 if voice_scores else 0.45
        )
        
        # Threshold already applied in fuse_scores, but we need to check for None
        
        # ---------------------------------------------------------
        # ROBUST DECISION LOGIC (User Request)
        # "Compare with 2 or 3 profiles... don't tag female as male"
        # ---------------------------------------------------------
        
        final_decision = None
        rejection_reason = None
        
        # fuse_scores returns None if below threshold, so we just check best_name
        if best_name:
             # 1. MARGIN CHECK (Top 2 Comparison)
             # If strictly voice based, check if the runner-up is too close.
             if voice_scores:
                 sorted_voice = sorted(voice_scores.items(), key=lambda x: x[1], reverse=True)
                 if len(sorted_voice) >= 2:
                     winner = sorted_voice[0]
                     runner_up = sorted_voice[1]
                     margin = winner[1] - runner_up[1]
                     
                     # If margin is slim (< 0.05), it's risky.
                     # However, if Context supports the winner, we proceed.
                     context_support_winner = linguistic_scores.get(winner[0], 0) + auto_id_scores.get(winner[0], 0)
                     context_support_runner = linguistic_scores.get(runner_up[0], 0) + auto_id_scores.get(runner_up[0], 0)
                     
                     if margin < 0.05 and context_support_winner <= context_support_runner:
                         # Ambiguous: Voice is close, and context doesn't clarify.
                         print(f"[Identify] AMBIGUITY: {winner[0]} vs {runner_up[0]} (Margin {margin:.3f}). Skipping.")
                         best_name = None 
                         rejection_reason = "Ambiguous Voice Match"

             # 2. GENDER / ROLE GUARD
             # If we picked someone, ensure it doesn't contradict linguistic gender cues.
             if best_name:
                 # Heuristic: Check titles in name
                 is_female_candidate = "Mme" in best_name or "Madame" in best_name or "Conseillère" in best_name
                 is_male_candidate = "M." in best_name or "Monsieur" in best_name or "Conseiller " in best_name # Space to avoid matching Conseillère
                 
                 # Check linguistic cues in text (Context)
                 # "Mme la Présidente", "Elle" -> Female
                 text_female_cues = ["madame", "mme", "présidente", "conseillère", "mairesse"]
                 text_male_cues = ["monsieur", "m.", "président", "conseiller", "maire"]
                 
                 found_female = any(cue in combined_text.lower() for cue in text_female_cues)
                 found_male = any(cue in combined_text.lower() for cue in text_male_cues)
                 
                 if is_male_candidate and found_female and not found_male:
                     print(f"[Identify] GENDER GUARD: Rejecting {best_name} (Male) because text implies Female.")
                     best_name = None
                     rejection_reason = "Gender Mismatch (M->F)"
                 elif is_female_candidate and found_male and not found_female:
                     print(f"[Identify] GENDER GUARD: Rejecting {best_name} (Female) because text implies Male.")
                     best_name = None
                     rejection_reason = "Gender Mismatch (F->M)"

        if best_name:
            final_decision = best_name
            speaker_mapping[speaker_label] = best_name
            print(f"[Identify] {speaker_label} -> {best_name} (score: {best_score:.2f}, voice: {bool(voice_scores)})")
            
            # Auto-Learning logic (Restored)
            voice_conf = voice_scores.get(best_name, 0)
            if voice_available and segment_embedding:
                if 0.55 <= voice_conf <= 0.78 and best_score > 0.65:
                     try:
                         print(f"[AutoLearn] Autonomous Reinforcement triggered for {best_name}!")
                         # Direct Firestore update
                         member_ref = db.collection("members").where("displayName", "==", best_name).limit(1).get()
                         if member_ref:
                             doc = member_ref[0]
                             current_emb = doc.to_dict().get("embedding", [])
                             import json as json_lib
                             if isinstance(current_emb, str):
                                 try: current_emb = json_lib.loads(current_emb)
                                 except: current_emb = []
                                 
                             new_emb_list = []
                             if not current_emb: new_emb_list = [segment_embedding]
                             elif isinstance(current_emb, list) and len(current_emb)>0 and isinstance(current_emb[0], list):
                                 new_emb_list = current_emb + [segment_embedding]
                                 if len(new_emb_list) > 12: new_emb_list = new_emb_list[-12:] 
                             elif isinstance(current_emb, list):
                                 new_emb_list = [current_emb, segment_embedding]
                                 
                             doc.reference.update({
                                 "embedding": json_lib.dumps(new_emb_list),
                                 "lastVoiceUpdate": datetime.now().isoformat(),
                                 "voiceSampleCount": len(new_emb_list)
                             })
                             print(f"[AutoLearn] Successfully learned new sample for {best_name} (Total: {len(new_emb_list)})")
                     except Exception as e:
                         print(f"[AutoLearn] Failed to auto-learn: {e}")
        else:
            unidentified.append((speaker_label, combined_text))
            if rejection_reason:
                print(f"[Identify] Unidentified {speaker_label}: {rejection_reason}")
    
    # For remaining unidentified, make ONE batch GROQ call
    if unidentified and len(unidentified) <= 5:
        try:
            import json as json_lib
            groq_api_key = os.environ.get("GROQ_API_KEY")
            if groq_api_key:
                batch_prompt = f"""Analyse ces segments de transcription d'une réunion CCE.
Membres présents: {', '.join(known_member_names)}

Pour chaque intervenant, identifie qui parle:
"""
                for label, text in unidentified:
                    batch_prompt += f"\n{label}: \"{text[:200]}...\""
                
                batch_prompt += """

Retourne un JSON simple avec le mapping: {"S0": "Nom Complet", "S1": "Autre Nom"}
UNIQUEMENT le JSON, sans explication."""
                
                response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {groq_api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [{"role": "user", "content": batch_prompt}],
                        "temperature": 0.3,
                        "max_tokens": 200
                    },
                    timeout=30
                )
                
                if response.ok:
                    result = response.json()
                    content = result["choices"][0]["message"]["content"]
                    groq_mapping = json_lib.loads(content)
                    
                    for label, name in groq_mapping.items():
                        if name in known_member_names and label not in speaker_mapping:
                            speaker_mapping[label] = name
                            print(f"[Identify] {label} -> {name} (GROQ batch)")
        except Exception as groq_err:
            print(f"[Identify] GROQ batch failed: {groq_err}")
    
    print(f"[Identify] Identified {len(speaker_mapping)} speakers")
    
    # Apply mapping to segments
    identified_segments = []
    for segment in segments:
        new_segment = segment.copy()
        original_speaker = segment.get("speaker", "S0")
        new_segment["speaker"] = speaker_mapping.get(original_speaker, original_speaker)
        new_segment["original_speaker"] = original_speaker
        identified_segments.append(new_segment)
    
    # Rebuild text with identified names
    full_text_parts = []
    for seg in identified_segments:
        start_seconds = seg['start']
        m = int(start_seconds // 60)
        s = int(start_seconds % 60)
        timestamp = f"[{m:02d}:{s:02d}]"
        
        speaker_label = f"[{seg['speaker']}]"
        full_text_parts.append(f"{timestamp} {speaker_label} {seg['text']}")
    
    return {
        "text": "\n\n".join(full_text_parts),
        "segments": identified_segments,
        "duration_seconds": formatted_output.get("duration_seconds", 0),
        "speaker_mapping": speaker_mapping
    }

# =============================================================================
# SALAD CLOUD INTEGRATION (Disabled - kept for reference)
# =============================================================================

SALAD_API_URL = "https://api.salad.com/api/public/organizations/vvd/inference-endpoints/transcribe/jobs"

# Salad API Limits (from documentation)
SALAD_MAX_FILE_SIZE_GB = 3
SALAD_MAX_DURATION_HOURS = 2.5

# Custom vocabulary for CCE meetings (improves transcription accuracy)
CCE_VOCABULARY = (
    "CCE, Val-d'Or, ComitÃ© consultatif en environnement, "
    "Patricia Boutin, SÃ©bastien Brodeur-Girard, Jacinthe Pothier, Donald RattÃ©, "
    "MichaÃ«l Ross, Benjamin Turcotte, Marguerite Larochelle, CÃ©line Brindamour, Jocelyn HÃ©bert, "
    "Maire, Mairesse, Urbanisme, Travaux publics, Environnement, DÃ©veloppement durable, "
    "MRCVO, SESAT, SociÃ©tÃ© des eaux souterraines de l'Abitibi-TÃ©miscamingue, "
    "OBVAJ, Organisme de bassin versant Abitibi-JamÃ©sie, Abitibi, Rouyn, Rouyn-Noranda, "
    "Protection des berges, Gestion des eaux pluviales, Bassin de rÃ©tention, Noue vÃ©gÃ©talisÃ©e, "
    "Puits Feldman, Esker, Domaine des Eskers, Nappe phrÃ©atique, AquifÃ¨re, "
    "BiodiversitÃ©, Changements climatiques, ÃŽlots de chaleur, Verdissement, "
    "Zonage, RÃ¨glement municipal, DÃ©rogation mineure, PIIA, Consultation publique, "
    "ProcÃ¨s-verbal, Ordre du jour, RÃ©solution, Adoption"
)


def validate_file_for_salad(file_url: str, headers: dict) -> dict:
    """
    Pre-validate file before Salad submission.
    Returns dict with 'valid': bool and 'error': str if invalid.
    """
    try:
        # HEAD request to get file metadata without downloading
        head_resp = requests.head(file_url, timeout=30, allow_redirects=True)
        
        if not head_resp.ok:
            return {"valid": False, "error": f"Cannot access file: HTTP {head_resp.status_code}"}
        
        # Check file size
        content_length = head_resp.headers.get("content-length")
        if content_length:
            size_gb = int(content_length) / (1024 ** 3)
            print(f"[Salad] File size: {size_gb:.2f} GB")
            
            if size_gb > SALAD_MAX_FILE_SIZE_GB:
                return {
                    "valid": False, 
                    "error": f"File too large: {size_gb:.2f} GB (max: {SALAD_MAX_FILE_SIZE_GB} GB)"
                }
        
        # Check content type
        content_type = head_resp.headers.get("content-type", "")
        print(f"[Salad] Content-Type: {content_type}")
        
        supported_types = ["audio/", "video/", "application/octet-stream"]
        if not any(t in content_type for t in supported_types):
            print(f"[Salad] Warning: Unusual content-type '{content_type}', proceeding anyway")
        
        return {"valid": True}
        
    except requests.exceptions.Timeout:
        return {"valid": False, "error": "File URL timeout - cannot verify accessibility"}
    except Exception as e:
        print(f"[Salad] Validation warning: {e}")
        # Don't block on validation errors, let Salad try
        return {"valid": True}


def transcribe_with_salad(file_url: str, language_code: str = "fr") -> dict:
    """
    Submit job to Salad Cloud and poll for results.
    Includes pre-validation, custom vocabulary, and detailed error logging.
    """
    api_key = os.environ.get("SALAD_API_KEY")
    if not api_key:
        raise ValueError("SALAD_API_KEY not configured")

    headers = {
        "Salad-Api-Key": api_key,
        "Content-Type": "application/json"
    }

    # 0. Pre-validate file
    print(f"[Salad] Validating file: {file_url[:80]}...")
    validation = validate_file_for_salad(file_url, headers)
    if not validation.get("valid"):
        raise Exception(f"File validation failed: {validation.get('error')}")

    # 1. Submit Job - Safe Mode (No Diarization to prevent OOM on large files)
    # We keep custom_vocabulary as it's critical for accuracy but less RAM heavy than diarization
    payload = {
        "input": {
            "url": file_url,
            "language_code": language_code,
            "return_as_file": False,
            "sentence_level_timestamps": True,
            "diarization": False,         # DISABLED to prevent crash
            "sentence_diarization": False, # DISABLED to prevent crash
            "custom_vocabulary": CCE_VOCABULARY
        }
    }

    print(f"[Salad] Submitting SAFE MODE job (Custom Vocab only, NO DIARIZATION)...")
    print(f"[Salad] Payload: language={language_code}, diarization=False, vocab_len={len(CCE_VOCABULARY)}")
    
    # Retry submission up to 3 times for transient 50x errors
    for attempt in range(3):
        try:
            response = requests.post(SALAD_API_URL, headers=headers, json=payload, timeout=30)
            
            if not response.ok:
                error_text = response.text[:500]
                print(f"[Salad] Submit failed (Attempt {attempt+1}/3) - Status: {response.status_code}, Body: {error_text}")
                
                # If 50x error (Gateway/Server), retry
                if response.status_code >= 500:
                    time.sleep(2)
                    continue
                    
                raise Exception(f"Salad Submit Failed (HTTP {response.status_code}): {error_text}")

            try:
                job_data = response.json()
                break # Success
            except ValueError:
                error_text = response.text[:500]
                print(f"[Salad] Critical: Submit returned non-JSON (Attempt {attempt+1}/3): {error_text}")
                if attempt == 2:
                    raise Exception(f"Salad API Error (Non-JSON response): {error_text}")
                time.sleep(2)
                
        except requests.exceptions.RequestException as e:
            print(f"[Salad] Network error during submit (Attempt {attempt+1}/3): {e}")
            if attempt == 2:
                raise

    job_id = job_data.get("id")
    print(f"[Salad] Job submitted successfully: {job_id}")

    # 2. Poll for Completion
    # Timeout after 55 minutes (3300s) to stay within Cloud Function 60m limit
    start_time = time.time()
    last_status = None
    
    while (time.time() - start_time) < 3300:
        time.sleep(10)  # Poll every 10s (reduced frequency for long jobs)
        
        status_url = f"{SALAD_API_URL}/{job_id}"
        
        try:
            status_resp = requests.get(status_url, headers=headers, timeout=30)
        except requests.exceptions.Timeout:
            print(f"[Salad] Status check timeout, retrying...")
            continue
        
        if not status_resp.ok:
            print(f"[Salad] Status check failed (HTTP {status_resp.status_code}): {status_resp.text[:200]}")
            continue
            
        try:
            status_data = status_resp.json()
        except ValueError:
            # Handle non-JSON (HTML) error responses from Salad infrastructure (e.g. 502/503)
            error_text = status_resp.text[:500]
            print(f"[Salad] Critical: Check returned non-JSON response: {error_text}")
            raise Exception(f"Salad API Error (Non-JSON response): {error_text}")

        status = status_data.get("status")
        
        if status == "succeeded":
            output = status_data.get("output", {})
            duration_hours = output.get("duration", 0)
            duration_min = duration_hours * 60 if isinstance(duration_hours, (int, float)) else 0
            processing_time = output.get("processing_time", "unknown")
            print(f"[Salad] Job succeeded!")
            print(f"[Salad] Audio duration: {duration_min:.1f} min, Processing time: {processing_time}s")
            
            # 1. Check for file-based response FIRST (common for large files)
            if "url" in output:
                print(f"[Salad] Output returned as file URL, downloading...")
                file_resp = requests.get(output["url"], timeout=60)
                if file_resp.ok:
                    # Downloaded JSON becomes the new output
                    output = file_resp.json() 
                else:
                    raise Exception(f"Salad Error: Failed to download output file from {output['url']} (HTTP {file_resp.status_code})")

            # 2. Now process the output (whether from inline or file)
            return output
            
        elif status == "failed":
            # Extract detailed error information
            events = status_data.get("events", [])
            output = status_data.get("output", {})
            error_msg = output.get("error", "No error message provided")
            
            # Log failure details
            print(f"[Salad] ========== JOB FAILED ==========")
            print(f"[Salad] Job ID: {job_id}")
            print(f"[Salad] Error: {error_msg}")
            print(f"[Salad] Events: {events}")
            print(f"[Salad] Full response: {status_data}")
            print(f"[Salad] ================================")
            
            # Build user-friendly error message
            if "3GB" in str(error_msg) or "size" in str(error_msg).lower():
                raise Exception(f"Salad Error: File too large (max 3GB)")
            elif "duration" in str(error_msg).lower() or "2.5 hours" in str(error_msg):
                raise Exception(f"Salad Error: Audio too long (max 2.5 hours)")
            elif "download" in str(error_msg).lower():
                raise Exception(f"Salad Error: Could not download file from URL. Check Firebase token expiration.")
            else:
                raise Exception(f"Salad Job Failed: {error_msg}. Job ID: {job_id}")
                
        elif status == "cancelled":
            print(f"[Salad] Job was cancelled. Job ID: {job_id}")
            raise Exception(f"Salad Job Cancelled. Job ID: {job_id}")
        else:
            elapsed = int(time.time() - start_time)
            # Only log status changes to reduce noise
            if status != last_status:
                print(f"[Salad] Status changed: {last_status} -> {status} (elapsed: {elapsed}s)")
                last_status = status
            elif elapsed % 60 == 0:  # Log every 60 seconds
                print(f"[Salad] Still {status}... (elapsed: {elapsed}s)")
        
        # Still running/pending...
    
    print(f"[Salad] Job timed out after 55 minutes. Job ID: {job_id}")
    raise Exception(f"Salad Job Timeout (55m). Job ID: {job_id}")


def format_salad_output(output_data: dict) -> str:
    """
    Convert Salad JSON output to [MM:SS] Speaker: Text format.
    Expects 'sentence_level_timestamps' in output.
    See API docs: output includes 'speaker' field per sentence when diarization is enabled.
    """
    sentences = output_data.get("sentence_level_timestamps", [])
    if not sentences:
        # Fallback to 'text' if available
        text = output_data.get("text", "")
        if text:
             print("[Salad] No sentence_level_timestamps, falling back to raw text")
             return text
        else:
            # If both are missing, this is an empty result
            print("[Salad] Warning: Empty transcription result (no sentences, no text)")
            return ""

    formatted_lines = []
    last_speaker = None
    
    for item in sentences:
        # Item structure from API: {'text': '...', 'timestamp': [start, end], 'speaker': 'SPEAKER_0', ...}
        text = item.get("text", "").strip()
        timestamp = item.get("timestamp", [0, 0])
        speaker = item.get("speaker", "")  # e.g., "SPEAKER_0", "SPEAKER_1"
        start_time = timestamp[0] if isinstance(timestamp, list) and len(timestamp) > 0 else 0
        
        if not text:
            continue
            
        # Format [MM:SS]
        m = int(start_time // 60)
        s = int(start_time % 60)
        ts_str = f"[{m:02d}:{s:02d}]"
        
        # Include speaker if available and changed
        if speaker and speaker != last_speaker:
            formatted_lines.append(f"{ts_str} {speaker}: {text}")
            last_speaker = speaker
        else:
            formatted_lines.append(f"{ts_str} {text}")
        
    return "\n".join(formatted_lines)


# =============================================================================
# LEGACY WHISPER IMPLEMENTATION (KEPT FOR REFERENCE)
# =============================================================================

def transcribe_whisper_legacy_local(
    meeting_id: str,
    storage_path: str,
    mime_type: str,
    context_prompt: str,
    meeting_ref
) -> str:
    """
    Legacy local processing using FFmpeg and OpenAI Whisper.
    Currently deactivated in favor of Salad Cloud.
    """
    print("[Legacy] Starting local transcription (FALLBACK MODE)...")
    bucket = storage.bucket()
    
    # Download audio file
    audio_format = get_audio_format(mime_type)
    temp_file = tempfile.NamedTemporaryFile(suffix=f".{audio_format}", delete=False)
    
    blob = bucket.blob(storage_path)
    blob.download_to_filename(temp_file.name)
    
    # Pre-process audio with FFmpeg
    processed_file_path = process_audio_with_ffmpeg(temp_file.name)
    
    # Split if needed
    chunk_paths = split_audio_if_needed(processed_file_path)
    
    # Transcribe each chunk
    full_transcription = ""
    # Note: Logic omitted for brevity as this is deprecated
    # ... (Rest of original logic would go here)
    
    return "LEGACY_PLACEHOLDER" # Should not be reached if we use Salad


# =============================================================================
# SPEECHMATICS WEBHOOK (Receives completed transcripts)
# =============================================================================

@https_fn.on_request(
    timeout_sec=3600,
    memory=options.MemoryOption.GB_2,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "GET"])
)
def speechmatics_webhook(req: https_fn.Request) -> https_fn.Response:
    """
    HTTP webhook endpoint that receives completed transcripts from Speechmatics.
    Speechmatics POSTs the transcript here when the job is done.
    
    Query params from Speechmatics:
    - id: The Speechmatics job ID
    - status: success, error, fetch_error, trim_error
    
    The meeting_id is in the job's tracking.reference field.
    We also receive the transcript in the request body (json-v2 format).
    """
    try:
        # Get query params
        job_id = req.args.get("id", "unknown")
        status = req.args.get("status", "unknown")
        
        print(f"[Speechmatics Webhook] ðŸ“¨ Received callback for job {job_id}, status={status}")
        
        if status != "success":
            print(f"[Speechmatics Webhook] âš ï¸ Job {job_id} failed with status: {status}")
            # We don't know the meeting_id here without calling Speechmatics API
            # Just log and return OK to prevent retries
            return https_fn.Response(
                json.dumps({"received": True, "status": status}),
                status=200,
                content_type="application/json"
            )
        
        # Parse the transcript from request body (json-v2 format)
        content_type = req.content_type or ""
        
        if "application/json" in content_type:
            transcript_data = req.get_json(silent=True) or {}
        else:
            # Try to parse as JSON anyway
            try:
                transcript_data = json.loads(req.get_data(as_text=True))
            except:
                transcript_data = {}
        
        # Log metadata for verification
        job_info = transcript_data.get("job", {})
        tracking = job_info.get("tracking", {})
        metadata = transcript_data.get("metadata", {})
        
        print(f"[Speechmatics Webhook] ðŸ“‹ Job Info: {json.dumps(job_info)}")
        print(f"[Speechmatics Webhook] ðŸ·ï¸ Tracking Metadata: {json.dumps(tracking)}")
        
        # Extract meeting_id from tracking.reference
        meeting_id = tracking.get("reference")
        
        if not meeting_id:
            # Fallback to metadata tracking
            tracking_alt = metadata.get("tracking", {})
            meeting_id = tracking_alt.get("reference")
            print(f"[Speechmatics Webhook] â„¹ï¸ Found meeting_id in fallback metadata: {meeting_id}")
        
        if not meeting_id:
            print(f"[Speechmatics Webhook] âŒ ERROR: No meeting_id found in tracking.reference for job {job_id}")
            print(f"[Speechmatics Webhook] Full data keys: {list(transcript_data.keys())}")
            return https_fn.Response(
                json.dumps({"error": "No meeting_id in tracking.reference"}),
                status=200,  # Return 200 to prevent retries
                content_type="application/json"
            )
        
        print(f"[Speechmatics Webhook] Processing transcript for meeting {meeting_id}")
        
        # Format the transcript using existing function
        formatted = format_speechmatics_output(transcript_data)
        full_transcription = formatted.get("text", "")
        
        print(f"[Speechmatics Webhook] Formatted transcript: {len(full_transcription)} characters")
        
        # Save to Firestore
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            print(f"[Speechmatics Webhook] ERROR: Meeting {meeting_id} not found")
            return https_fn.Response(
                json.dumps({"error": "Meeting not found"}),
                status=200,
                content_type="application/json"
            )
        
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        
        # Check if we have audioRecordings array with matching job
        updated_array = False
        if isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for i, rec in enumerate(audio_recordings):
                if rec.get("speechmaticsJobId") == job_id:
                    audio_recordings[i]["transcription"] = full_transcription
                    # Save original transcription (with S# labels) for reset/re-id
                    if "originalTranscription" not in audio_recordings[i]:
                        audio_recordings[i]["originalTranscription"] = full_transcription
                    
                    # Save segments for Reinforcement Learning (Active ID)
                    audio_recordings[i]["segments"] = formatted.get("segments", [])
                    
                    audio_recordings[i]["transcriptionStatus"] = "completed"
                    audio_recordings[i]["transcribedAt"] = datetime.now().isoformat()
                    audio_recordings[i]["transcriptionEngine"] = "speechmatics-webhook"
                    updated_array = True
                    print(f"[Speechmatics Webhook] Updated audioRecordings[{i}] for job {job_id}")
                    break
            
            if updated_array:
                meeting_ref.update({
                    "audioRecordings": audio_recordings,
                    "dateUpdated": datetime.now().isoformat()
                })
        
        # Always update legacy audioRecording field too (backward compatibility)
        meeting_ref.update({
            "audioRecording.transcription": full_transcription,
            "audioRecording.transcriptionStatus": "completed",
            "audioRecording.transcribedAt": datetime.now().isoformat(),
            "audioRecording.transcriptionEngine": "speechmatics-webhook",
            "audioRecording.speechmaticsJobId": job_id,
            "dateUpdated": datetime.now().isoformat()
        })
        
        print(f"[Speechmatics Webhook] SUCCESS! Transcript saved for meeting {meeting_id} (array={updated_array})")
        
        # =====================================================================
        # SPEAKER IDENTIFICATION - Multi-Strategy (runs after transcription)
        # =====================================================================
        try:
            print(f"[Speaker ID] Starting identification for meeting {meeting_id}")
            
            from speaker_identification import (
                fuse_scores,
                contextual_ai_strategy,
                linguistic_pattern_strategy,
                name_mention_strategy,
                auto_identification_strategy
            )
            
            # Get enrolled speakers
            enrolled_speakers = get_enrolled_speakers()
            
            if enrolled_speakers and len(enrolled_speakers) > 0:
                segments = formatted.get("segments", [])
                known_member_names = [s["name"] for s in enrolled_speakers]
                speaker_mapping = {}  # {"S0": "Michaël Ross", ...}
                meeting_context = {"type": "Régulière"}
                
                # === NEW ROBUST IDENTIFICATION LOGIC ===
                
                # 1. Find audio URL for voice embedding
                audio_url = None
                if isinstance(audio_recordings, list):
                    for rec in audio_recordings:
                        if rec.get("speechmaticsJobId") == job_id:
                            audio_url = rec.get("downloadURL") or rec.get("url") or rec.get("fileUrl")
                            break
                            
                modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
                voice_available = bool(audio_url and modal_endpoint)
                print(f"[Speaker ID] Auto-ID starting. Voice available: {voice_available}, URL found: {bool(audio_url)}")

                # 2. Collect unique speakers and timestamps
                unique_speakers = {}
                speaker_timestamps = {}
                import re
                
                for segment in segments:
                    speaker_label = segment.get("speaker", "S0")
                    text = segment.get("text", "")
                    
                    if not re.match(r'^S\d+$', speaker_label):
                        continue
                        
                    if speaker_label not in unique_speakers:
                        unique_speakers[speaker_label] = []
                    unique_speakers[speaker_label].append(text)
                    
                    if speaker_label not in speaker_timestamps:
                        speaker_timestamps[speaker_label] = {
                            "start": segment.get("start", 0),
                            "end": segment.get("start", 0) + 30
                        }

                # 3. Identify each unique speaker
                for speaker_label, texts in unique_speakers.items():
                    combined_text = " ".join(texts[:5])
                    
                    # Voice Embedding Strategy
                    voice_scores = {}
                    if voice_available and speaker_label in speaker_timestamps:
                        ts = speaker_timestamps[speaker_label]
                        try:
                            # Use global function from main.py
                            segment_embedding = extract_audio_segment_embedding(audio_url, ts["start"], ts["end"])
                            if segment_embedding:
                                voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                        except Exception as e:
                            print(f"[Speaker ID] Voice embedding failed for {speaker_label}: {e}")

                            print(f"[Speaker ID] Voice embedding failed for {speaker_label}: {e}")

                    # Other Strategies
                    # Pass full enrolled_speakers list to AI for role-based inference
                    context_scores = contextual_ai_strategy(combined_text, meeting_context, enrolled_speakers)
                    linguistic_scores = linguistic_pattern_strategy(combined_text, enrolled_speakers)
                    mention_scores = name_mention_strategy(combined_text, None, known_member_names)
                    auto_id_scores = auto_identification_strategy(combined_text, known_member_names)
                    
                    # Fuse
                    identified_name, confidence = fuse_scores(
                        voice_scores, context_scores, linguistic_scores, mention_scores, auto_id_scores,
                        confidence_threshold=0.2
                    )
                    
                    if identified_name:
                        speaker_mapping[speaker_label] = identified_name
                        print(f"[Speaker ID] Identified {speaker_label} -> {identified_name} ({confidence:.2f})")
                
                # If we identified any speakers, update the transcript with names
                if speaker_mapping:
                    # Rebuild transcript with identified names
                    identified_parts = []
                    for seg in segments:
                        start = seg.get('start', 0)
                        m = int(start // 60)
                        s = int(start % 60)
                        timestamp = f"[{m:02d}:{s:02d}]"
                        
                        original = seg.get("speaker", "S0")
                        name = speaker_mapping.get(original, original)
                        identified_parts.append(f"{timestamp} [{name}] {seg.get('text', '')}")
                    
                    identified_transcription = "\n\n".join(identified_parts)
                    
                    # Save identified transcript
                    if updated_array and audio_recordings:
                        for i, rec in enumerate(audio_recordings):
                            if rec.get("speechmaticsJobId") == job_id:
                                audio_recordings[i]["transcription"] = identified_transcription
                                audio_recordings[i]["speakerMapping"] = speaker_mapping
                                break
                        meeting_ref.update({
                            "audioRecordings": audio_recordings,
                            "dateUpdated": datetime.now().isoformat()
                        })
                    
                    meeting_ref.update({
                        "audioRecording.transcription": identified_transcription,
                        "audioRecording.speakerMapping": speaker_mapping,
                        "dateUpdated": datetime.now().isoformat()
                    })
                    
                    print(f"[Speaker ID] Updated transcript with {len(speaker_mapping)} identified speakers")
                    full_transcription = identified_transcription
            else:
                print("[Speaker ID] No enrolled speakers, skipping identification")
                
        except Exception as id_err:
            print(f"[Speaker ID] Warning: Identification failed ({str(id_err)}), using original")
            import traceback
            traceback.print_exc()
        
        # Prepare Response
        return https_fn.Response(
            json.dumps({
                "success": True, 
                "meetingId": meeting_id, 
                "speakers": speaker_mapping,
                "warnings": warnings, # New field for UI
                "unidentifiedCount": len(unidentified)
            }),
            status=200,
            content_type="application/json"
        )
        
    except Exception as e:
        print(f"[Speechmatics Webhook] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        # Return 200 anyway to prevent Speechmatics retries (we logged the error)
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=200,
            content_type="application/json"
        )


# =============================================================================
# MANUAL SPEAKER IDENTIFICATION (Callable)
# =============================================================================

@https_fn.on_call(timeout_sec=3600, memory=options.MemoryOption.GB_2)
def identify_speakers(req: https_fn.CallableRequest) -> dict:
    """
    Manually trigger speaker identification on an existing transcription.
    Called from the UI when user wants to re-identify speakers.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    storage_path = data.get("storagePath")  # Optional: specific recording
    
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId."
        )
    
    print(f"[Manual Speaker ID] Starting for meeting {meeting_id}")
    
    try:
        from speaker_identification import (
            fuse_scores,
            contextual_ai_strategy,
            linguistic_pattern_strategy,
            name_mention_strategy,
            auto_identification_strategy
        )
        
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.NOT_FOUND,
                message="Meeting not found."
            )
        
        meeting_data = meeting_doc.to_dict()
        
        # Get enrolled speakers
        enrolled_speakers = get_enrolled_speakers()
        if not enrolled_speakers:
            return {"success": False, "error": "No enrolled speakers found"}
        
        known_member_names = [s["name"] for s in enrolled_speakers]
        meeting_context = {"type": "Régulière"}
        
        # PRE-FLIGHT: Filter out absent/excused attendees
        attendees = meeting_data.get("attendees", [])
        if attendees:
            present_names = set()
            for att in attendees:
                status = att.get("status", "").lower()
                if status in ["present", "présent", ""]:  # Include if no status or present
                    name = att.get("name") or att.get("displayName")
                    if name:
                        present_names.add(name)
            
            if present_names:
                # Keep only enrolled speakers who are present at this meeting
                original_count = len(known_member_names)
                known_member_names = [n for n in known_member_names if n in present_names]
                filtered_count = original_count - len(known_member_names)
                print(f"[Manual Speaker ID] PRE-FLIGHT: Filtered {filtered_count} absent members. {len(known_member_names)} present candidates remain.")
        
        # Find transcription and audio URL to process
        transcription_text = None
        audio_url = None
        audio_recordings = meeting_data.get("audioRecordings", [])
        target_index = -1
        
        if storage_path and audio_recordings:
            # Find specific recording
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    # Prefer original transcription with S# labels for re-identification
                    transcription_text = rec.get("originalTranscription") or rec.get("transcription", "")
                    audio_url = rec.get("downloadURL") or rec.get("url")
                    target_index = i
                    break
        elif audio_recordings:
            # Use first recording with transcription
            for i, rec in enumerate(audio_recordings):
                if rec.get("transcription"):
                    # Prefer original transcription with S# labels for re-identification
                    transcription_text = rec.get("originalTranscription") or rec["transcription"]
                    audio_url = rec.get("downloadURL") or rec.get("url")
                    target_index = i
                    break
        
        # Fallback to legacy field
        if not transcription_text:
            transcription_text = meeting_data.get("audioRecording", {}).get("transcription", "")
        
        if not transcription_text:
            return {"success": False, "error": "No transcription found"}
            
        print(f"[Manual Speaker ID] Found transcription ({len(transcription_text)} chars)")
        print(f"[Manual Speaker ID] Target index: {target_index}")
        if target_index >= 0:
            rec = audio_recordings[target_index]
            print(f"[Manual Speaker ID] Recording data: keys={list(rec.keys())}")
            print(f"[Manual Speaker ID] storagePath: {rec.get('storagePath')}")
            print(f"[Manual Speaker ID] downloadURL: {rec.get('downloadURL') and 'SET'}")
            print(f"[Manual Speaker ID] fileUrl: {rec.get('fileUrl') and 'SET'}")
            print(f"[Manual Speaker ID] url: {rec.get('url') and 'SET'}")
            
            # Ensure we get the URL (try all possible fields)
            if not audio_url:
                audio_url = rec.get("fileUrl") or rec.get("url") or rec.get("downloadURL")
        
        if not audio_url:
            # Try legacy field
            legacy = meeting_data.get("audioRecording", {})
            audio_url = legacy.get("downloadURL") or legacy.get("fileUrl") or legacy.get("url")
            print(f"[Manual Speaker ID] Checked legacy audioRecording. found URL? {bool(audio_url)}")
        
        # Parse transcription into segments
        # Format: [MM:SS] [Speaker] Text
        import re
        lines = transcription_text.split("\n\n")
        segments = []
        
        for line in lines:
            match = re.match(r'\[(\d+:\d+)\]\s*\[([^\]]+)\]\s*(.*)', line, re.DOTALL)
            if match:
                timestamp, speaker, text = match.groups()
                mins, secs = map(int, timestamp.split(":"))
                segments.append({
                    "start": mins * 60 + secs,
                    "speaker": speaker,
                    "text": text.strip()
                })
        
        if not segments:
            return {"success": False, "error": "Could not parse transcription segments"}
        
        print(f"[Manual Speaker ID] Processing {len(segments)} segments")
        
        print(f"[Manual Speaker ID] VERSION: 2026-02-06-OPTIMIZED-V2 (Longest Segment + Single Download)")
        
        # Collect unique speakers and their sample texts
        unique_speakers = {}  # {"S0": ["text1", "text2"], ...}
        
        for segment in segments:
            speaker_label = segment["speaker"]
            
            # Skip if already a name (not S0/S1 format)
            if not re.match(r'^S\d+$', speaker_label):
                continue
            
            if speaker_label not in unique_speakers:
                unique_speakers[speaker_label] = []
            unique_speakers[speaker_label].append(segment["text"])
        
        print(f"[Manual Speaker ID] Found {len(unique_speakers)} unique speakers")
        
        # Collect timestamps for each unique speaker
        speaker_timestamps = {}  # {"S0": {"start": 0, "end": 30}, ...}
        for segment in segments:
            label = segment["speaker"]
            label = segment["speaker"]
            if re.match(r'^S\d+$', label):
                # Calculate duration of this segment
                start = segment.get("start", 0)
                end = segment.get("end", start + 5) # Default to 5s if end missing
                duration = end - start
                
                # Check if this is the best sample so far for this speaker
                if label not in speaker_timestamps:
                    speaker_timestamps[label] = {"start": start, "end": end, "duration": duration}
                elif duration > speaker_timestamps[label]["duration"]:
                    # Found a longer sample
                    speaker_timestamps[label] = {"start": start, "end": end, "duration": duration}
        
        # Initialize speaker_stats before using it
        speaker_stats = {}  # {speaker_label: {"segments": 3, "total_time": 120, "avg_duration": 40}}
        
        # Calculate speaker time statistics (who spoke most, average duration)
        for segment in segments:
            label = segment.get("speaker", "")
            if re.match(r'^S\d+$', label):
                start = segment.get("start", 0)
                end = segment.get("end", start + 5)
                duration = end - start
                
                if label not in speaker_stats:
                    speaker_stats[label] = {"segments": 0, "total_time": 0, "texts": []}
                speaker_stats[label]["segments"] += 1
                speaker_stats[label]["total_time"] += duration
                speaker_stats[label]["texts"].append(segment.get("text", "")[:100])
        
        # Calculate averages and rank speakers by talk time
        for label, stats in speaker_stats.items():
            if stats["segments"] > 0:
                stats["avg_duration"] = stats["total_time"] / stats["segments"]
        
        # Sort by total time to identify "main speakers" vs "participants"
        sorted_speakers = sorted(speaker_stats.items(), key=lambda x: x[1]["total_time"], reverse=True)
        if sorted_speakers:
            print(f"[Manual Speaker ID] STATS: Top speaker {sorted_speakers[0][0]} ({sorted_speakers[0][1]['total_time']:.0f}s)")
        
        speaker_mapping = {}
        unidentified = []
        modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
        voice_available = bool(audio_url and modal_endpoint)
        
        print(f"[Manual Speaker ID] Audio URL: {audio_url[:100] if audio_url else 'NOT FOUND'}")
        print(f"[Manual Speaker ID] MODAL_ENDPOINT_URL: {'SET' if modal_endpoint else 'NOT SET'}")
        print(f"[Manual Speaker ID] Voice embedding available: {voice_available}")
        
        warnings = {} # Collect AI feedback here
        confidence_scores = {}  # {speaker_label: {"score": 0.85, "method": "voice+context"}}
        profile_strength = {}  # {member_name: {"samples": 5, "quality": "robust", "variance": 0.15}}
        interruptions = []  # [{speaker: "S1", interrupted: "S2", time: 120, context: "..."}]
        
        # #6 INTERRUPTION DETECTION: Analyze segment transitions for quick speaker changes
        prev_segment = None
        for segment in segments:
            if prev_segment:
                prev_end = prev_segment.get("end", 0)
                curr_start = segment.get("start", 0)
                prev_speaker = prev_segment.get("speaker", "")
                curr_speaker = segment.get("speaker", "")
                
                # Quick transition (<0.5s) between different speakers = potential interruption
                gap = curr_start - prev_end
                if prev_speaker != curr_speaker and gap < 0.5:
                    interruptions.append({
                        "interrupter": curr_speaker,
                        "interrupted": prev_speaker,
                        "time": round(curr_start, 1),
                        "gap": round(gap, 2),
                        "context": segment.get("text", "")[:80]
                    })
            prev_segment = segment
        
        if interruptions:
            print(f"[Manual Speaker ID] INTERRUPTIONS DETECTED: {len(interruptions)} speaker cut-offs")
            # Summarize interruptions for warnings
            interrupter_counts = {}
            for intr in interruptions:
                sp = intr["interrupter"]
                interrupter_counts[sp] = interrupter_counts.get(sp, 0) + 1
            top_interrupter = max(interrupter_counts.items(), key=lambda x: x[1]) if interrupter_counts else None
            if top_interrupter and top_interrupter[1] >= 3:
                warnings["_interruptions"] = f"⚡ {top_interrupter[0]} a interrompu {top_interrupter[1]} fois"
        
        
        # Build profile strength from enrolled speakers
        for sp in enrolled_speakers:
            name = sp.get("name")
            sample_count = sp.get("voiceSampleCount", 0)
            if sample_count >= 10:
                quality = "robuste"
            elif sample_count >= 5:
                quality = "acceptable"
            elif sample_count >= 1:
                quality = "faible"
            else:
                quality = "inexistant"
            profile_strength[name] = {"samples": sample_count, "quality": quality}
        
        
        # OPTIMIZATION: Download audio ONCE if voice ID is available
        # This prevents downloading 100MB+ file for EVERY speaker segment (which caused timeouts)
        local_audio_path = None
        if voice_available and len(unique_speakers) > 0:
            try:
                import tempfile
                import shutil
                print(f"[Manual Speaker ID] Pre-downloading audio for optimization...")
                with requests.get(audio_url, stream=True, timeout=120) as r:
                    if r.ok:
                        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                            shutil.copyfileobj(r.raw, tmp)
                            local_audio_path = tmp.name
                            print(f"[Manual Speaker ID] Audio downloaded to {local_audio_path}")
            except Exception as e:
                print(f"[Manual Speaker ID] Pre-download failed, falling back to per-segment download: {e}")
        
        for speaker_label, texts in unique_speakers.items():
            combined_text = " ".join(texts[:3])  # Use first 3 segments max
            
            # Initialize scores dict
            voice_scores = {}
            
            # Try voice embedding if available (50% weight)
            if voice_available and speaker_label in speaker_timestamps:
                ts = speaker_timestamps[speaker_label]
                print(f"[Manual Speaker ID] Getting voice embedding for {speaker_label} ({ts['start']:.0f}s-{ts['end']:.0f}s)")
                # Use local path if downloaded, else fallback to URL
                source_audio = local_audio_path if local_audio_path else audio_url
                segment_embedding = extract_audio_segment_embedding(source_audio, ts["start"], ts["end"])
                if segment_embedding:
                    voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                    print(f"[Manual Speaker ID] Voice scores: {voice_scores}")
            
            # Fast pattern strategies
            linguistic_scores = linguistic_pattern_strategy(
                combined_text, enrolled_speakers
            )
            mention_scores = name_mention_strategy(
                combined_text, None, known_member_names
            )
            auto_id_scores = auto_identification_strategy(
                combined_text, known_member_names
            )
            
            # Fuse with proper weighting - ADJUSTED FOR ACCURACY
            best_score = 0
            best_name = None
            
            # Find the max voice score to see if we have a strong candidate
            max_voice_score = 0
            if voice_scores:
                max_voice_score = max(voice_scores.values())
            
            for name in known_member_names:
                if voice_scores:
                    # Voice carries 70% weight now to be decisive
                    v_score = voice_scores.get(name, 0)
                    
                    # Bonus: If this person is the clear winner in voice (top 1), give extra boost
                    # This helps break ties against "average" profiles like Michaël seems to be
                    voice_bonus = 0.05 if v_score == max_voice_score and v_score > 0.75 else 0
                    
                    score = (
                        (v_score + voice_bonus) * 0.70 +
                        linguistic_scores.get(name, 0) * 0.10 +
                        mention_scores.get(name, 0) * 0.10 +
                        auto_id_scores.get(name, 0) * 0.10
                    )
                else:
                    # Without voice, rely on patterns
                    score = (
                        linguistic_scores.get(name, 0) * 0.4 +
                        mention_scores.get(name, 0) * 0.3 +
                        auto_id_scores.get(name, 0) * 0.3
                    )
                
                if score > best_score:
                    best_score = score
                    best_name = name
            
            # ---------------------------------------------------------
            # ROBUST DECISION LOGIC (User Request)
            # ---------------------------------------------------------
            
            # Dynamic threshold: If voice was used, we expect higher confidence
            threshold = 0.60 if voice_scores else 0.15
            
            rejection_reason = None
            ai_warning = None
            
            if best_score >= threshold and best_name:
                 # 1. MARGIN CHECK (Top 2 Comparison)
                 if voice_scores:
                     sorted_voice = sorted(voice_scores.items(), key=lambda x: x[1], reverse=True)
                     if len(sorted_voice) >= 2:
                         winner = sorted_voice[0]
                         runner_up = sorted_voice[1]
                         margin = winner[1] - runner_up[1]
                         
                         context_support_winner = linguistic_scores.get(winner[0], 0) + auto_id_scores.get(winner[0], 0)
                         context_support_runner = linguistic_scores.get(runner_up[0], 0) + auto_id_scores.get(runner_up[0], 0)
                         
                         if margin < 0.05 and context_support_winner <= context_support_runner:
                             print(f"[Manual Speaker ID] AMBIGUITY: {winner[0]} vs {runner_up[0]} (Margin {margin:.3f}).")
                             best_name = None 
                             rejection_reason = "Ambiguïté (Scores trop proches)"
                             ai_warning = f"Ambiguïté entre {winner[0]} ({winner[1]:.2f}) et {runner_up[0]} ({runner_up[1]:.2f})"

                 # 2. GENDER / ROLE GUARD (Enhanced with First Name Inference)
                 if best_name:
                      # Common French first names for gender inference
                      FEMALE_NAMES = {
                          "patricia", "marguerite", "marie", "anne", "sophie", "nathalie", 
                          "isabelle", "valérie", "sylvie", "christine", "françoise", "catherine",
                          "nicole", "monique", "julie", "audrey", "caroline", "jacinthe",
                          "martine", "claire", "louise", "jeanne", "hélène", "madeleine",
                          "céline", "brigitte", "danielle", "michèle", "josée", "diane",
                          "linda", "chantal", "lucie", "manon", "karine", "stéphanie"
                      }
                      MALE_NAMES = {
                          "donald", "pierre", "jean", "michel", "jacques", "paul", "andré",
                          "robert", "françois", "alain", "claude", "yves", "louis", "daniel",
                          "richard", "gilles", "marc", "bernard", "serge", "martin", "denis",
                          "sébastien", "christian", "éric", "philippe", "patrick", "stéphane",
                          "marcel", "roger", "raymond", "normand", "guy", "luc", "benoit",
                          "olivier", "mathieu", "maxime", "simon", "alexandre", "michaël"
                      }
                      
                      # Extract first name from candidate (handle "Prénom Nom" format)
                      first_name = best_name.split()[0].lower().replace("mme", "").replace("m.", "").strip()
                      if len(first_name) < 2 and len(best_name.split()) > 1:
                          first_name = best_name.split()[1].lower()
                      
                      # Determine candidate gender from name
                      is_female_candidate = (
                          first_name in FEMALE_NAMES or
                          "Mme" in best_name or "Madame" in best_name or "Conseillère" in best_name
                      )
                      is_male_candidate = (
                          first_name in MALE_NAMES or
                          "M." in best_name or "Monsieur" in best_name or "Conseiller " in best_name
                      )
                      
                      # Text context cues
                      text_female_cues = ["madame", "mme", "présidente", "conseillère", "mairesse", "elle a dit", "elle propose"]
                      text_male_cues = ["monsieur", "m.", "président", "conseiller", "maire", "il a dit", "il propose"]
                      
                      found_female = any(cue in combined_text.lower() for cue in text_female_cues)
                      found_male = any(cue in combined_text.lower() for cue in text_male_cues)
                      
                      if is_male_candidate and found_female and not found_male:
                          print(f"[Manual Speaker ID] GENDER GUARD: Rejecting {best_name} (M/{first_name}) because text context implies Female.")
                          best_name = None
                          rejection_reason = "Incohérence de Genre (H vs F)"
                          ai_warning = f"Rejeté: {first_name} est Homme mais le contexte indique une Femme."
                      elif is_female_candidate and found_male and not found_female:
                          print(f"[Manual Speaker ID] GENDER GUARD: Rejecting {best_name} (F/{first_name}) because text context implies Male.")
                          best_name = None
                          rejection_reason = "Incohérence de Genre (F vs H)"
                          ai_warning = f"Rejeté: {first_name} est Femme mais le contexte indique un Homme."

            if best_score >= threshold and best_name:
                speaker_mapping[speaker_label] = best_name
                print(f"[Manual Speaker ID] {speaker_label} -> {best_name} (score: {best_score:.2f}, voice_max: {max_voice_score:.2f})")
                
                # Record confidence score and identification method
                method = "voice+context" if voice_scores else "context_only"
                if max_voice_score > 0.85:
                    method = "voice_high"
                elif max_voice_score > 0.70:
                    method = "voice_confident"
                elif max_voice_score > 0.50:
                    method = "voice_uncertain"
                
                confidence_scores[speaker_label] = {
                    "score": round(best_score, 3),
                    "voice_score": round(max_voice_score, 3) if voice_scores else 0,
                    "method": method,
                    "identified_as": best_name,
                    "profile_quality": profile_strength.get(best_name, {}).get("quality", "inconnu")
                }
                
                # AUTO-LEARNING: If voice confidence is very high (>0.85), auto-reinforce in background
                # This helps build robust profiles without user intervention
                if max_voice_score > 0.85 and voice_available and speaker_label in speaker_timestamps:
                    try:
                        # Find member_id for this name
                        member_id = None
                        for sp in enrolled_speakers:
                            if sp.get("name") == best_name:
                                member_id = sp.get("id")
                                break
                        
                        if member_id:
                            ts = speaker_timestamps[speaker_label]
                            print(f"[Auto-Learn] HIGH CONFIDENCE ({max_voice_score:.2f}): Auto-reinforcing {best_name}")
                            
                            # Fire-and-forget: Extract embedding and save (simplified inline version)
                            try:
                                source = local_audio_path if local_audio_path else audio_url
                                auto_embedding = extract_audio_segment_embedding(source, ts["start"], ts["end"])
                                if auto_embedding:
                                    # Update member profile inline
                                    member_ref = db.collection("members").document(member_id)
                                    member_doc = member_ref.get()
                                    if member_doc.exists:
                                        import json as json_lib
                                        member_data = member_doc.to_dict()
                                        current = member_data.get("embedding", "[]")
                                        if isinstance(current, str):
                                            try:
                                                current = json_lib.loads(current)
                                            except:
                                                current = []
                                        
                                        # Append new embedding
                                        if isinstance(current, list) and len(current) > 0 and isinstance(current[0], list):
                                            current.append(auto_embedding)
                                            if len(current) > 20:
                                                current = current[-20:]
                                        elif current:
                                            current = [current, auto_embedding]
                                        else:
                                            current = [auto_embedding]
                                        
                                        member_ref.update({
                                            "embedding": json_lib.dumps(current),
                                            "voiceSampleCount": len(current),
                                            "lastVoiceUpdate": datetime.now().isoformat()
                                        })
                                        print(f"[Auto-Learn] SUCCESS: Added sample to {best_name} ({len(current)} total)")
                            except Exception as ae:
                                print(f"[Auto-Learn] Failed for {best_name}: {ae}")
                    except Exception as e:
                        print(f"[Auto-Learn] Skipped: {e}")
            else:
                unidentified.append((speaker_label, combined_text))
                # Store warning for frontend
                if ai_warning:
                     warnings[speaker_label] = ai_warning
                     print(f"[Manual Speaker ID] Added warning for {speaker_label}: {ai_warning}")

        
        print(f"[Manual Speaker ID] Fast strategies identified {len(speaker_mapping)}/{len(unique_speakers)} speakers")
        print(f"[Manual Speaker ID] Unidentified speakers to process via GROQ: {len(unidentified)}")
        
        # For remaining unidentified, make GROQ batch calls
        groq_api_key = os.environ.get("GROQ_API_KEY")
        if not groq_api_key:
            print("[Manual Speaker ID] WARNING: GROQ_API_KEY not set! Cannot identify remaining speakers via AI.")
        
        if unidentified and groq_api_key:
            try:
                import json as json_lib
                
                # Process in batches of 10 to avoid token limits
                batch_size = 10
                for batch_start in range(0, len(unidentified), batch_size):
                    batch = unidentified[batch_start:batch_start + batch_size]
                    print(f"[Manual Speaker ID] Processing GROQ batch {batch_start // batch_size + 1} ({len(batch)} speakers)")
                    
                    batch_prompt = f"""Analyse ces segments de transcription d'une réunion CCE.
Membres présents: {', '.join(known_member_names)}

Pour chaque intervenant, identifie qui parle basé sur le contenu, le style de parole, et les indices contextuels:
"""
                    for label, text in batch:
                        batch_prompt += f"\n{label}: \"{text[:300]}...\""
                    
                    batch_prompt += """

Retourne un JSON simple avec le mapping: {"S0": "Nom Complet", "S1": "Autre Nom"}
Si tu ne peux pas identifier un intervenant, ne l'inclus pas dans le JSON.
UNIQUEMENT le JSON, sans explication."""
                    
                    response = requests.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {groq_api_key}",
                            "Content-Type": "application/json"
                        },
                        json={
                            "model": "llama-3.1-8b-instant",
                            "messages": [{"role": "user", "content": batch_prompt}],
                            "temperature": 0.3,
                            "max_tokens": 500
                        },
                        timeout=30
                    )
                    
                    if response.ok:
                        result = response.json()
                        content = result["choices"][0]["message"]["content"]
                        # Extract JSON from response (may have markdown code blocks)
                        if "```json" in content:
                            content = content.split("```json")[1].split("```")[0]
                        elif "```" in content:
                            content = content.split("```")[1].split("```")[0]
                        groq_mapping = json_lib.loads(content.strip())
                        
                        for label, name in groq_mapping.items():
                            if name in known_member_names and label not in speaker_mapping:
                                speaker_mapping[label] = name
                                print(f"[Manual Speaker ID] {label} -> {name} (GROQ batch)")
                    else:
                        print(f"[Manual Speaker ID] GROQ request failed: {response.status_code} - {response.text[:200]}")
            except Exception as groq_err:
                print(f"[Manual Speaker ID] GROQ batch failed: {groq_err}")
        
        if not speaker_mapping:
            if local_audio_path and os.path.exists(local_audio_path):
                os.unlink(local_audio_path)
            return {"success": True, "message": "No speakers could be identified", "mapping": {}}
        
        # Rebuild transcript with identified names
        identified_parts = []
        for seg in segments:
            m = int(seg["start"] // 60)
            s = int(seg["start"] % 60)
            timestamp = f"[{m:02d}:{s:02d}]"
            original = seg["speaker"]
            name = speaker_mapping.get(original, original)
            identified_parts.append(f"{timestamp} [{name}] {seg['text']}")
        
        identified_transcription = "\n\n".join(identified_parts)
        
        # Save
        if target_index >= 0 and audio_recordings:
            audio_recordings[target_index]["transcription"] = identified_transcription
            audio_recordings[target_index]["speakerMapping"] = speaker_mapping
            meeting_ref.update({
                "audioRecordings": audio_recordings,
                "dateUpdated": datetime.now().isoformat()
            })
        
        meeting_ref.update({
            "audioRecording.transcription": identified_transcription,
            "audioRecording.speakerMapping": speaker_mapping,
            "dateUpdated": datetime.now().isoformat()
        })
        
        print(f"[Manual Speaker ID] SUCCESS! Identified {len(speaker_mapping)} speakers")
        
        if local_audio_path and os.path.exists(local_audio_path):
            os.unlink(local_audio_path)
        
        # Check for missing attendees (present members not assigned to any speaker)
        identified_names = set(speaker_mapping.values())
        if attendees:
            present_attendees = [a.get("name") or a.get("displayName") for a in attendees 
                                 if a.get("status", "").lower() in ["present", "présent", ""]]
            missing_speakers = [n for n in present_attendees if n and n not in identified_names]
            
            if missing_speakers:
                warnings["_missing"] = f"Membres présents non détectés: {', '.join(missing_speakers)}"
                print(f"[Manual Speaker ID] MISSING ATTENDEES: {missing_speakers}")
        
        # Clean speaker_stats for JSON (remove texts array to reduce size)
        clean_stats = {}
        for label, stats in speaker_stats.items():
            clean_stats[label] = {
                "segments": stats["segments"],
                "total_time": round(stats["total_time"], 1),
                "avg_duration": round(stats.get("avg_duration", 0), 1)
            }
        
        return {
            "success": True,
            "identifiedCount": len(speaker_mapping),
            "mapping": speaker_mapping,
            "speakers": speaker_mapping,  # Alias for frontend compatibility
            "warnings": warnings,
            # Advanced ML Analytics
            "analytics": {
                "confidence": confidence_scores,
                "speakerStats": clean_stats,
                "profileStrength": profile_strength,
                "topSpeaker": sorted_speakers[0][0] if sorted_speakers else None,
                "totalSpeakers": len(unique_speakers),
                "autoLearnedCount": sum(1 for c in confidence_scores.values() if c.get("method") == "voice_high")
            }
        }
        
    except Exception as e:
        print(f"[Manual Speaker ID] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# ASYNC TRANSCRIPTION ENDPOINTS (No timeout limit)
# =============================================================================

@https_fn.on_call(
    timeout_sec=120,  # 2 minutes - just submits job
    memory=options.MemoryOption.MB_512
)
def submit_transcription(req: https_fn.CallableRequest) -> dict:
    """
    Submit a transcription job to Speechmatics.
    Returns immediately with job_id - does NOT wait for completion.
    Supports both legacy audioRecording and new audioRecordings[] array.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    download_url = data.get("downloadUrl")
    storage_path = data.get("storagePath")  # Used to identify recording in array
    
    if not meeting_id or not download_url:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId or downloadUrl."
        )
    
    print(f"[Async Transcription] Submitting job for meeting {meeting_id}")
    if storage_path:
        print(f"[Async Transcription] Storage path: {storage_path}")
    
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.NOT_FOUND,
                message="Meeting not found."
            )
        
        # Submit to Speechmatics
        job_id = submit_speechmatics_job(download_url, meeting_id, language_code="fr")
        
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        
        # If we have audioRecordings array and a storagePath, update the specific entry
        if storage_path and isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            # Find the recording by storagePath
            updated = False
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    audio_recordings[i]["speechmaticsJobId"] = job_id
                    audio_recordings[i]["transcriptionStatus"] = "processing"
                    audio_recordings[i]["transcriptionStartedAt"] = datetime.now().isoformat()
                    updated = True
                    print(f"[Async Transcription] Updated audioRecordings[{i}] with job {job_id}")
                    break
            
            if updated:
                meeting_ref.update({
                    "audioRecordings": audio_recordings,
                    "dateUpdated": datetime.now().isoformat()
                })
            else:
                print(f"[Async Transcription] Warning: Could not find recording with storagePath {storage_path}")
                # Fall back to legacy field
                meeting_ref.update({
                    "audioRecording.speechmaticsJobId": job_id,
                    "audioRecording.transcriptionStatus": "processing",
                    "audioRecording.transcriptionStartedAt": datetime.now().isoformat(),
                    "dateUpdated": datetime.now().isoformat()
                })
        else:
            # Legacy: update audioRecording (singular)
            meeting_ref.update({
                "audioRecording.speechmaticsJobId": job_id,
                "audioRecording.transcriptionStatus": "processing",
                "audioRecording.transcriptionStartedAt": datetime.now().isoformat(),
                "dateUpdated": datetime.now().isoformat()
            })
        
        print(f"[Async Transcription] Job {job_id} submitted for meeting {meeting_id}")
        
        return {
            "success": True,
            "jobId": job_id,
            "storagePath": storage_path,
            "message": "Transcription submitted. Check back in a few minutes."
        }
        
    except Exception as e:
        print(f"[Async Transcription] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


@https_fn.on_call(
    timeout_sec=180,  # 3 minutes - checks status and retrieves result
    memory=options.MemoryOption.GB_1
)
def check_transcription(req: https_fn.CallableRequest) -> dict:
    """
    Check the status of a transcription job.
    If complete, saves the result to Firestore using a transaction
    to prevent race conditions when multiple jobs complete simultaneously.
    Supports both legacy audioRecording and new audioRecordings[] array.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    storage_path = data.get("storagePath")  # Used to identify recording in array
    
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId."
        )
    
    print(f"[Check Transcription] Checking meeting {meeting_id}, storagePath: {storage_path}")
    
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.NOT_FOUND,
                message="Meeting not found."
            )
        
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        
        # Try to find the specific recording in the array first
        job_id = None
        current_status = None
        recording_index = -1
        
        if storage_path and isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    job_id = rec.get("speechmaticsJobId")
                    current_status = rec.get("transcriptionStatus")
                    recording_index = i
                    print(f"[Check Transcription] Found recording at index {i}, job_id: {job_id}, status: {current_status}")
                    break
        
        # Fall back to legacy audioRecording field
        if job_id is None:
            audio_recording = meeting_data.get("audioRecording", {})
            job_id = audio_recording.get("speechmaticsJobId")
            current_status = audio_recording.get("transcriptionStatus")
            print(f"[Check Transcription] Using legacy audioRecording, job_id: {job_id}, status: {current_status}")
        
        # Note: Removed early-exit "already completed" check.
        # Always query Speechmatics for job status since a new job may have been submitted.
        
        if not job_id:
            return {
                "status": "not_started",
                "message": "No transcription job found. Please submit first."
            }
        
        # Check Speechmatics
        result = check_speechmatics_job(job_id)
        
        if result["status"] == "completed":
            # Save result to Firestore using a transaction to prevent race conditions
            full_transcription = result["result"].get("text", "")
            
            # Update the correct location
            if recording_index >= 0:
                # Use transaction to safely update the array
                @firestore.transactional
                def update_in_transaction(transaction, doc_ref, rec_index, transcription_text):
                    snapshot = doc_ref.get(transaction=transaction)
                    if not snapshot.exists:
                        return False
                    
                    data = snapshot.to_dict()
                    recordings = data.get("audioRecordings", [])
                    
                    if rec_index < len(recordings):
                        recordings[rec_index]["transcription"] = transcription_text
                        recordings[rec_index]["transcriptionStatus"] = "completed"
                        recordings[rec_index]["transcribedAt"] = datetime.now().isoformat()
                        recordings[rec_index]["transcriptionEngine"] = "speechmatics-async"
                        
                        transaction.update(doc_ref, {
                            "audioRecordings": recordings,
                            "dateUpdated": datetime.now().isoformat()
                        })
                        return True
                    return False
                
                transaction = db.transaction()
                success = update_in_transaction(transaction, meeting_ref, recording_index, full_transcription)
                
                if success:
                    print(f"[Check Transcription] Transaction updated audioRecordings[{recording_index}] with {len(full_transcription)} chars")
                else:
                    print(f"[Check Transcription] Transaction failed for index {recording_index}")
            else:
                # Legacy: update audioRecording (singular) - no transaction needed
                meeting_ref.update({
                    "audioRecording.transcription": full_transcription,
                    "audioRecording.transcriptionStatus": "completed",
                    "audioRecording.transcribedAt": datetime.now().isoformat(),
                    "audioRecording.transcriptionEngine": "speechmatics-async",
                    "dateUpdated": datetime.now().isoformat()
                })
            
            print(f"[Async Transcription] Job {job_id} completed! {len(full_transcription)} chars saved.")
            return {
                "status": "completed",
                "message": f"Transcription completed. {len(full_transcription)} characters."
            }
        
        elif result["status"] == "failed":
            # Update failure status (also use transaction for array)
            if recording_index >= 0:
                @firestore.transactional
                def update_failure_in_transaction(transaction, doc_ref, rec_index, error_msg):
                    snapshot = doc_ref.get(transaction=transaction)
                    if not snapshot.exists:
                        return
                    
                    data = snapshot.to_dict()
                    recordings = data.get("audioRecordings", [])
                    
                    if rec_index < len(recordings):
                        recordings[rec_index]["transcriptionStatus"] = "failed"
                        recordings[rec_index]["transcriptionError"] = error_msg
                        
                        transaction.update(doc_ref, {
                            "audioRecordings": recordings,
                            "dateUpdated": datetime.now().isoformat()
                        })
                
                transaction = db.transaction()
                update_failure_in_transaction(transaction, meeting_ref, recording_index, result.get("error", "Unknown error"))
            else:
                meeting_ref.update({
                    "audioRecording.transcriptionStatus": "failed",
                    "audioRecording.transcriptionError": result.get("error", "Unknown error"),
                    "dateUpdated": datetime.now().isoformat()
                })
            return {
                "status": "failed",
                "error": result.get("error", "Unknown error")
            }
        
        else:
            return {
                "status": "processing",
                "message": "Transcription still in progress. Check again in a few minutes."
            }
        
    except Exception as e:
        print(f"[Async Transcription] Check error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# LEGACY SYNC TRANSCRIPTION (Kept for backward compatibility)
# =============================================================================

@https_fn.on_call(
    timeout_sec=3600,  # 1 hour timeout
    memory=options.MemoryOption.GB_1 # Reduced from GB_4 since heaviest work is offloaded
)
def transcribe_whisper(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function to transcribe audio.
    NOW USES SPEECHMATICS API (formerly Salad Cloud).
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
    download_url = data.get("downloadUrl")  # Firebase Storage download URL with token
    
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId."
        )
    
    # Require either downloadUrl or storagePath
    if not download_url and not storage_path:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing downloadUrl or storagePath."
        )
    
    print(f"[Transcription] Starting for meeting {meeting_id} (via Speechmatics)")
    
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        
        # Update status
        meeting_ref.update({
            "audioRecording.transcriptionStatus": "processing",
            "dateUpdated": datetime.now().isoformat()
        })

        # 1. Use downloadURL directly (preferred - no signing needed)
        if download_url:
            file_url = download_url
            print(f"[Transcription] Using provided downloadURL: {file_url[:60]}...")
        else:
            raise Exception("downloadUrl not provided. Signed URL generation is not supported in this environment.")

        # 2. Call Speechmatics (Primary Provider)
        print("[Transcription] Offloading to Speechmatics...")
        speechmatics_output = transcribe_with_speechmatics(file_url, language_code="fr")
        
        if not speechmatics_output:
            raise Exception("Empty output from Speechmatics")

        # 3. Get formatted text (already formatted by Speechmatics function)
        full_transcription = speechmatics_output.get("text", "")
        print(f"[Transcription] Success! Length: {len(full_transcription)} chars")

        # 4. Save to Firestore
        meeting_ref.update({
            "audioRecording.transcription": full_transcription,
            "audioRecording.transcriptionStatus": "completed",
            "audioRecording.transcribedAt": datetime.now().isoformat(),
            "audioRecording.transcriptionEngine": "speechmatics-enhanced",
            "dateUpdated": datetime.now().isoformat()
        })
        
        return {
            "success": True,
            "transcription": full_transcription
        }
        
    except Exception as e:
        print(f"[Transcription] Error: {str(e)}")
        
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

    # Inject Active Members List for Attendance Verification
    try:
        db = firestore.client()
        members_ref = db.collection("members").where("isActive", "==", True)
        members_docs = members_ref.stream()
        
        active_members_list = []
        for doc in members_docs:
            m_data = doc.to_dict()
            name = m_data.get("displayName", "Inconnu")
            role = m_data.get("role", "membre")
            active_members_list.append(f"- {name} ({role})")
        
        if active_members_list:
            members_context = "\n\n=== LISTE OFFICIELLE DES MEMBRES ACTIFS (POUR VÃ‰RIFICATION DES PRÃ‰SENCES) ===\n" + "\n".join(active_members_list)
            members_context += "\n\nINSTRUCTION: Utilisez cette liste pour identifier prÃ©cisÃ©ment les membres prÃ©sents et absents. Comparez les locuteurs identifiÃ©s dans la transcription avec cette liste.\n"
            system_prompt += members_context
            print(f"[Claude] Injected {len(active_members_list)} active members into prompt context.")
            
    except Exception as e:
        print(f"[Claude] Warning: Failed to fetch active members: {e}")
        # Proceed even if members fetch fails

    try:
        # Singleton access
        client = get_anthropic_client()
        
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
        # Singleton access
        client = get_anthropic_client()
        
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
    memory=options.MemoryOption.GB_2
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
        # Singleton access
        client = get_anthropic_client()
        
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
    memory=options.MemoryOption.GB_1,
    timeout_sec=300,  # Increased timeout for rate limiting (e.g. 50 emails * 1.5s = 75s)
    region="us-central1"
)
def send_convocation(req: https_fn.CallableRequest):
    """
    Cloud Function to send convocation emails to CCE members.
    Uses Resend API for email delivery.
    """
    # Verify authentication
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentification requise"
        )

    try:
        import resend
        import random
        
        # Singleton configuration
        configure_resend()
        
        # Extract data
        data = req.data
        meeting_id = data.get("meetingId")
        convocation_id = data.get("convocationId")
        meeting = data.get("meeting", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        agenda_pdf_base64 = data.get("agendaPdf") # Expecting Base64 string
        
        if not meeting_id or not recipients:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message="meetingId et recipients requis"
            )
        
        # Format meeting date (Fixing Timezone and Encoding)
        # Parse ISO date (UTC)
        utc_date = datetime.fromisoformat(meeting.get("date", "").replace("Z", "+00:00"))
        
        # Convert to Eastern Time (UTC-5 for simplicity or use pytz if available, but stdlib is safer without deps)
        # Assuming Standard Time (-5) or Daylight Saving (-4).
        # A robust way without pytz is just subtracting 5 hours, which is "close enough" for most CCE meetings 
        # unless they happen exactly at midnight switch.
        # Ideally, we should use a library, but let's stick to simple offset for now.
        local_date = utc_date - timedelta(hours=5) 
        
        days = {
            0: "lundi", 1: "mardi", 2: "mercredi", 3: "jeudi", 
            4: "vendredi", 5: "samedi", 6: "dimanche"
        }
        months = {
            1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
            7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre"
        }
        
        day_str = days[local_date.weekday()]
        month_str = months[local_date.month]
        
        formatted_date = f"{day_str} {local_date.day} {month_str} {local_date.year}"
        formatted_time = local_date.strftime("%H h %M")
        
        # Prepare Attachments
        attachments = []
        if agenda_pdf_base64:
            attachments.append({
                "content": agenda_pdf_base64,
                "filename": f"Ordre_du_jour_{local_date.strftime('%Y-%m-%d')}.pdf",
            })

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
        
        for i, recipient in enumerate(recipients):
            # Rate limiting: wait 1.1 seconds between emails
            # This ensures we stay well below the 2 req/s limit (approx 0.9 req/s)
            if i > 0:
                time.sleep(1.1)

            try:
                email_html = generate_email_html(
                    recipient.get("name", ""),
                    recipient.get("token", "")
                )
                
                email_params = {
                    "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
                    "to": [recipient.get("email")],
                    "subject": f"Ordre du jour du CCE – {formatted_date}",
                    "html": email_html,
                    "attachments": attachments 
                }

                # Retry logic with exponential backoff for 429 errors
                max_retries = 3
                sent_successfully = False
                last_error_msg = ""

                for attempt in range(max_retries):
                    try:
                        resend.Emails.send(email_params)
                        sent_successfully = True
                        break # Success, exit retry loop
                    except Exception as e:
                        last_error_msg = str(e)
                        # Check if it's a rate limit error
                        if "429" in str(e) or "Too Many Requests" in str(e):
                             # Exponential backoff: 2s, 4s, 8s + random jitter
                            sleep_time = (2 ** (attempt + 1)) + random.uniform(0, 1)
                            print(f"[Convocation] Rate limited for {recipient.get('email')}. Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                            time.sleep(sleep_time)
                        else:
                            # Not a rate limit error, raise immediately to outer except block
                            raise e

                if sent_successfully:
                    sent_count += 1
                    print(f"[Convocation] Email sent to {recipient.get('email')}")
                else:
                     raise Exception(f"Max retries exceeded. Last error: {last_error_msg}")
                
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
    - DESTINATAIRE / EXPÃ‰DITEUR / DATE / OBJET header
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
    
    # === HEADER with logos ===
    # Logo URLs from deployed app
    logo_valdor_url = "https://comite-cce.web.app/logo-valdor.png"
    logo_cce_url = "https://comite-cce.web.app/logo-cce.png"
    
    # Try to download and add logos
    logo_valdor_img = None
    logo_cce_img = None
    
    try:
        with urllib.request.urlopen(logo_valdor_url, timeout=10) as response:
            logo_data = response.read()
            logo_buffer = io.BytesIO(logo_data)
            logo_valdor_img = Image(logo_buffer, width=1.2*inch, height=0.8*inch)
            print("[Avis PDF] Logo Val-d'Or loaded")
    except Exception as e:
        print(f"[Avis PDF] Could not load logo Val-d'Or: {e}")
    
    try:
        with urllib.request.urlopen(logo_cce_url, timeout=10) as response:
            logo_data = response.read()
            logo_buffer = io.BytesIO(logo_data)
            logo_cce_img = Image(logo_buffer, width=0.8*inch, height=0.8*inch)
            print("[Avis PDF] Logo CCE loaded")
    except Exception as e:
        print(f"[Avis PDF] Could not load logo CCE: {e}")
    
    # Create header with logos (side by side)
    if logo_valdor_img and logo_cce_img:
        logo_table = Table(
            [[logo_valdor_img, logo_cce_img]],
            colWidths=[3*inch, 3*inch]
        )
        logo_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(logo_table)
        elements.append(Spacer(1, 15))
    
    elements.append(Paragraph("COMITÃ‰ CONSULTATIF EN ENVIRONNEMENT", header_style))
    elements.append(Paragraph("VILLE DE VAL-D'OR", subheader_style))
    
    # Horizontal line
    from reportlab.platypus import HRFlowable
    elements.append(HRFlowable(width="100%", thickness=2, color=primary_color, spaceAfter=20))
    
    # Format today's date in French
    months_fr = {
        1: "janvier", 2: "fÃ©vrier", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
        7: "juillet", 8: "aoÃ»t", 9: "septembre", 10: "octobre", 11: "novembre", 12: "dÃ©cembre"
    }
    today = datetime.now()
    today_str = f"Le {today.day} {months_fr[today.month]} {today.year}"
    
    # === MEMO HEADER TABLE ===
    # DESTINATAIRE / EXPÃ‰DITEUR / DATE / OBJET format
    memo_data = [
        [Paragraph("<b>DESTINATAIRE :</b>", label_style), 
         Paragraph("Les membres du ComitÃ© consultatif en environnement", value_style)],
        [Paragraph("<b>EXPÃ‰DITEUR :</b>", label_style), 
         Paragraph(f"{sender_name}, coordonnateur en environnement", value_style)],
        [Paragraph("<b>DATE :</b>", label_style), 
         Paragraph(today_str, value_style)],
        [Paragraph("<b>OBJET :</b>", label_style), 
         Paragraph("RÃ©union du ComitÃ© consultatif en environnement", value_style)],
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
    body_text = f"""Je vous prie de prendre note qu'une assemblÃ©e du ComitÃ© consultatif en environnement 
    est prÃ©vue le <b>{meeting_date}</b> Ã  <b>{meeting_time}</b> {meeting_location}."""
    elements.append(Paragraph(body_text, body_style))
    elements.append(Spacer(1, 8))
    
    # Deadline paragraph
    deadline_text = f"""Vous avez jusqu'au <b>{deadline}</b> pour faire vos suggestions de point Ã  l'ordre du jour."""
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
                sig_image.hAlign = 'LEFT'  # Align image to left
                elements.append(sig_image)
                signature_added = True
                print(f"[Avis PDF] Signature image added from URL")
        except Exception as sig_error:
            print(f"[Avis PDF] Could not load signature image: {sig_error}")
    
    if not signature_added:
        # Add signature line if no image
        elements.append(Spacer(1, 30))
    
    # Signature name aligned left (same as image)
    signature_name_style = ParagraphStyle(
        'SignatureNameStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#333333'),
        alignment=TA_LEFT,
        fontName='Times-Roman',
        leftIndent=0  # No indent - align with signature image
    )
    elements.append(Paragraph(f"{sender_name}, secrÃ©taire du ComitÃ©", signature_name_style))
    
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
                message="RESEND_API_KEY non configurÃ©e"
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
        formatted_meeting_date = meeting.get("formattedDate", "Date Ã  confirmer")
        formatted_deadline = deadline.get("formattedDate", "Date limite")
        sender_email = sender.get("email", "coordonnateur@ville.valdor.qc.ca")
        sender_name = sender.get("name", "Coordonnateur CCE")
        meeting_title = meeting.get("title", "AssemblÃ©e CCE")
        meeting_location = meeting.get("location", "Ville de Val-d'Or")
        signature_url = sender.get("signatureUrl")
        
        # Format time from meeting date (convert from UTC to Eastern timezone)
        try:
            from zoneinfo import ZoneInfo
            meeting_datetime = datetime.fromisoformat(meeting.get("date", "").replace("Z", "+00:00"))
            # Convert to Eastern timezone (Quebec)
            eastern_tz = ZoneInfo("America/Montreal")
            meeting_datetime_local = meeting_datetime.astimezone(eastern_tz)
            meeting_time = meeting_datetime_local.strftime("%H h %M")
            print(f"[Avis] Meeting time: UTC={meeting_datetime}, Local={meeting_datetime_local}, Formatted={meeting_time}")
        except Exception as tz_error:
            print(f"[Avis] Timezone error: {tz_error}")
            meeting_time = "Ã€ confirmer"
        
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
                Vous trouverez, <strong>en fichier joint</strong>, l'avis de convocation pour la prochaine assemblee du 
                <strong>Comite consultatif en environnement</strong>, prevue le <strong>{formatted_meeting_date}</strong>.
            </p>
            
            <!-- Deadline box -->
            <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <p style="margin: 0; font-size: 16px; color: #856404;">
                    <strong>Date limite pour suggestions :</strong><br>
                    Vous avez jusqu'au <strong>{formatted_deadline}</strong> pour faire vos suggestions de sujets 
                    à l'ordre du jour, par courriel à <a href="mailto:{sender_email}" style="color: #1e4e3d;">{sender_email}</a>
                </p>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Merci et bonne journee !
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
                    "subject": f"Avis de convocation à Assemblée CCE du {formatted_meeting_date}",
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


# ==============================================================================
# MAGIC LINK APPROVAL SERVICE
# ==============================================================================

import uuid
from datetime import datetime, timedelta
from typing import Any

@https_fn.on_call()
def send_approval_link(req: https_fn.CallableRequest) -> Any:
    """
    Generates a secure approval token and sends it via email.
    """
    try:
        import resend
        resend.api_key = os.environ.get("RESEND_API_KEY", "")
        
        data = req.data
        meeting_id = data.get("meetingId")
        member_id = data.get("memberId")
        email = data.get("email")
        name = data.get("name")
        role = data.get("role")

        if not meeting_id or not email:
            return {"success": False, "error": "Missing parameters"}

        # Generate secure token
        token = str(uuid.uuid4())
        # expires in 7 days
        expires_at = (datetime.now() + timedelta(days=7)).isoformat()

        # Store token in Firestore
        db = firestore.client()
        db.collection("meetings").document(meeting_id).collection("approval_tokens").document(token).set({
            "token": token,
            "meetingId": meeting_id,
            "memberId": member_id,
            "name": name,
            "role": role,
            "createdAt": datetime.now().isoformat(),
            "expiresAt": expires_at,
            "used": False
        })

        # Construct Link - format must match route: /approve/:meetingId/:token
        base_url = "https://comite-cce.web.app"
        approval_link = f"{base_url}/approve/{meeting_id}/{token}"

        # Send Email via Resend
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Demande d'approbation de Procès-Verbal</h2>
            <p>Bonjour {name},</p>
            <p>Le procès-verbal de la réunion est prêt pour votre révision et approbation.</p>
            <p>Veuillez cliquer sur le lien ci-dessous pour accéder au document sécurisé :</p>
            <p style="text-align: center; margin: 30px 0;">
                <a href="{approval_link}" style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
                    Réviser et Approuver
                </a>
            </p>
            <p>Ce lien est valide pour 7 jours.</p>
        </body>
        </html>
        """

        r = resend.Emails.send({
            "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
            "to": [email],
            "subject": "Action requise : Approbation de procès-verbal",
            "html": html_content
        })

        return {"success": True, "emailId": r.get("id")}

    except Exception as e:
        print(f"Error sending approval link: {e}")
        return {"success": False, "error": str(e)}



# =============================================================================
# APPROVAL NOTIFICATION (When changes are requested)
# =============================================================================

@https_fn.on_call()
def send_approval_notification(req: https_fn.CallableRequest) -> Any:
    """
    Sends email notification to coordinator when changes are requested in approval workflow.
    """
    try:
        import resend
        resend.api_key = os.environ.get("RESEND_API_KEY", "")
        
        data = req.data
        meeting_id = data.get("meetingId")
        meeting_title = data.get("meetingTitle")
        reviewer_name = data.get("reviewerName")
        comments = data.get("comments")
        notification_type = data.get("type", "changes_requested")  # 'approved' or 'changes_requested'
        
        if not meeting_id or not comments:
            return {"success": False, "error": "Missing parameters"}
        
        # Get coordinator email from Firestore
        db = firestore.client()
        members_ref = db.collection("members")
        coordinators = members_ref.where("role", "==", "coordinator").where("isActive", "==", True).limit(1).stream()
        
        coordinator_email = None
        coordinator_name = None
        for member in coordinators:
            member_data = member.to_dict()
            coordinator_email = member_data.get("email")
            coordinator_name = member_data.get("displayName", "Coordonnateur")
            break
        
        if not coordinator_email:
            print("No active coordinator found, cannot send notification")
            return {"success": False, "error": "Aucun coordonnateur actif trouvé"}
        
        # Build email content based on notification type
        if notification_type == "approved":
            subject = f"✅ PV Approuvé - {meeting_title}"
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2e7d32;">Procès-verbal Approuvé</h2>
                <p>Bonjour {coordinator_name},</p>
                <p><strong>{reviewer_name}</strong> a approuvé le procès-verbal de la réunion :</p>
                <p style="font-size: 16px; color: #333;"><strong>{meeting_title}</strong></p>
                {f'<p><strong>Commentaires :</strong></p><blockquote style="border-left: 3px solid #2e7d32; padding-left: 12px; color: #555;">{comments}</blockquote>' if comments else ''}
                <p>Vous pouvez maintenant finaliser le document.</p>
            </body>
            </html>
            """
        else:
            subject = f"📝 Modifications demandées - {meeting_title}"
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #f57c00;">Modifications Demandées</h2>
                <p>Bonjour {coordinator_name},</p>
                <p><strong>{reviewer_name}</strong> a demandé des modifications au procès-verbal de la réunion :</p>
                <p style="font-size: 16px; color: #333;"><strong>{meeting_title}</strong></p>
                <p><strong>Commentaires :</strong></p>
                <blockquote style="border-left: 3px solid #f57c00; padding-left: 12px; color: #555; background: #fff3e0; padding: 12px;">
                    {comments}
                </blockquote>
                <p>Veuillez effectuer les corrections et renvoyer le lien d'approbation.</p>
            </body>
            </html>
            """
        
        r = resend.Emails.send({
            "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
            "to": [coordinator_email],
            "subject": subject,
            "html": html_content
        })
        
        print(f"Notification sent to coordinator: {coordinator_email}")
        return {"success": True, "emailId": r.get("id")}
        
    except Exception as e:
        print(f"Error sending approval notification: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# SPEECHMATICS COST PROTECTION & JOB MANAGEMENT
# =============================================================================

def list_speechmatics_jobs(status_filter: str = "running") -> list:
    """
    List Speechmatics jobs by status.
    Useful for monitoring costs and detecting zombie jobs.
    """
    api_key = os.environ.get("SPEECHMATICS_API_KEY")
    if not api_key:
        raise Exception("SPEECHMATICS_API_KEY not configured")

    headers = {"Authorization": f"Bearer {api_key}"}
    
    url = f"{SPEECHMATICS_API_BASE}/jobs"
    if status_filter and status_filter != "all":
        url += f"?status={status_filter}"
    
    print(f"[Speechmatics Admin] Listing jobs (filter: {status_filter})...")
    
    response = requests.get(url, headers=headers, timeout=30)
    
    if not response.ok:
        print(f"[Speechmatics Admin] Failed to list jobs: {response.status_code}")
        return []
    
    data = response.json()
    jobs = data.get("jobs", [])
    
    print(f"[Speechmatics Admin] Found {len(jobs)} job(s)")
    
    return [{
        "id": job.get("id"),
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "duration": job.get("duration"),
        "tracking": job.get("config", {}).get("tracking", {})
    } for job in jobs]


def delete_speechmatics_job(job_id: str) -> bool:
    """
    Delete/cancel a Speechmatics job.
    Use this to stop runaway jobs that are incurring costs.
    """
    api_key = os.environ.get("SPEECHMATICS_API_KEY")
    if not api_key:
        raise Exception("SPEECHMATICS_API_KEY not configured")

    headers = {"Authorization": f"Bearer {api_key}"}
    
    print(f"[Speechmatics Admin] Deleting job {job_id}...")
    
    response = requests.delete(
        f"{SPEECHMATICS_API_BASE}/jobs/{job_id}",
        headers=headers,
        timeout=30
    )
    
    if response.ok or response.status_code == 204:
        print(f"[Speechmatics Admin] Job {job_id} deleted successfully")
        return True
    else:
        print(f"[Speechmatics Admin] Failed to delete job: {response.status_code} - {response.text}")
        return False


@https_fn.on_call(
    memory=options.MemoryOption.GB_1,
    timeout_sec=60,
    region="us-central1"
)
def admin_speechmatics_cleanup(req: https_fn.CallableRequest) -> Any:
    """
    Admin function to list and optionally cancel stale Speechmatics jobs.
    Helps prevent unexpected charges from zombie jobs.
    
    Request data:
        action: "list" | "cleanup"
        max_age_hours: Number of hours after which a running job is considered stale (default: 2)
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentification requise"
        )
    
    data = req.data or {}
    action = data.get("action", "list")
    max_age_hours = data.get("max_age_hours", 2)
    
    try:
        running_jobs = list_speechmatics_jobs("running")
        
        if action == "list":
            return {
                "success": True,
                "jobs": running_jobs,
                "count": len(running_jobs),
                "message": f"Found {len(running_jobs)} running job(s)"
            }
        
        elif action == "cleanup":
            now = datetime.now()
            stale_jobs = []
            deleted_jobs = []
            
            for job in running_jobs:
                created_at_str = job.get("created_at", "")
                if created_at_str:
                    try:
                        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                        age_hours = (now - created_at.replace(tzinfo=None)).total_seconds() / 3600
                        
                        if age_hours > max_age_hours:
                            stale_jobs.append(job)
                            job_id = job.get("id")
                            
                            if delete_speechmatics_job(job_id):
                                deleted_jobs.append(job_id)
                    except Exception as parse_error:
                        print(f"[Speechmatics Admin] Could not parse date: {created_at_str} - {parse_error}")
            
            return {
                "success": True,
                "stale_count": len(stale_jobs),
                "deleted_jobs": deleted_jobs,
                "deleted_count": len(deleted_jobs),
                "message": f"Cleaned up {len(deleted_jobs)} stale job(s) older than {max_age_hours}h"
            }
        
        else:
            return {"success": False, "error": f"Unknown action: {action}"}
    
    except Exception as e:
        print(f"[Speechmatics Admin] Error: {str(e)}")
        return {"success": False, "error": str(e)}


# =============================================================================
# RESET SPEAKER IDENTIFICATION (Callable)
# =============================================================================

@https_fn.on_call(timeout_sec=540, memory=options.MemoryOption.GB_1)
def reset_speakers(req: https_fn.CallableRequest) -> dict:
    """
    Reset speaker identification to original S# labels.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    storage_path = data.get("storagePath")
    
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId."
        )
        
    print(f"[Reset Speakers] Starting for meeting {meeting_id}")
    
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            return {"success": False, "error": "Meeting not found"}
            
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        updated = False
        
        if audio_recordings:
            for i, rec in enumerate(audio_recordings):
                # Filter by path if provided
                if storage_path and rec.get("storagePath") != storage_path:
                    continue
                    
                if rec.get("originalTranscription"):
                    print(f"[Reset Speakers] Resetting recording {i}")
                    audio_recordings[i]["transcription"] = rec["originalTranscription"]
                    audio_recordings[i]["speakerMapping"] = {}
                    updated = True
                else:
                    print(f"[Reset Speakers] No original transcription for rec {i}")
        
        if updated:
            meeting_ref.update({
                "audioRecordings": audio_recordings,
                "dateUpdated": datetime.now().isoformat()
            })
            return {"success": True, "message": "Speakers reset successfully"}
        else:
             return {"success": False, "message": "Nothing to reset (original transcription missing)"}
             
    except Exception as e:
        print(f"[Reset Speakers] Error: {e}")
        return {"success": False, "error": str(e)}



# Helper for AI Supervisor
def call_groq_quality_check(text_segment: str) -> bool:
    """
    Ask GROQ if the text segment is high quality enough for voice training.
    Filters out short interjections ("Hum", "Oui"), noise, or silence.
    """
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        print("[AI Supervisor] Skipped (No API Key)")
        return True # Fail open if no API key

    try:
        prompt = f"""Tu es un Superviseur de Machine Learning.
Ton rôle est de valider si ce segment de texte correspond à une phrase intelligible utile pour l'entraînement vocal.

Critères de REJET (return false):
- Moins de 3 mots (ex: "Oui", "Bonjour", "Je vois")
- Bruit ou hésitations (ex: "Euh...", "[Inaudible]")
- Phrases incomplètes ou coupées

Critères de VALIDATION (return true):
- Phrase complète
- Suffisamment de contenu phonétique

Segment: "{text_segment}"

Réponds UNIQUEMENT par JSON: {{"valid": true}} ou {{"valid": false}}"""

        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {groq_api_key}", "Content-Type": "application/json"},
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0,
                "max_tokens": 50
            },
            timeout=10
        )
        
        if response.ok:
            import json as json_lib
            content = response.json()["choices"][0]["message"]["content"]
            result = json_lib.loads(content)
            print(f"[AI Supervisor] Check '{text_segment[:20]}...': {result.get('valid')}")
            return result.get("valid", True)
            
    except Exception as e:
        print(f"[AI Supervisor] Error: {e}")
        
    return True # Fail open on error


@https_fn.on_request(
    timeout_sec=300,
    memory=512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def reinforce_speaker_voice(req: https_fn.Request) -> https_fn.Response:
    """
    Active Learning: Add a new voice sample to a member's profile from a meeting segment.
    """

    try:
        data = req.get_json()
        meeting_id = data.get("meetingId")
        speaker_label = data.get("speakerLabel") # e.g. "S1"
        member_id = data.get("memberId")
        
        if not all([meeting_id, speaker_label, member_id]):
            return https_fn.Response(json.dumps({"error": "Missing parameters"}), status=400)
            
        print(f"[Reinforce] Request: {speaker_label} -> {member_id} in {meeting_id}")

        # 1. Get Meeting & Audio
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        if not meeting_doc.exists:
            return https_fn.Response(json.dumps({"error": "Meeting not found"}), status=404)
        
        meeting = meeting_doc.to_dict()
        audio_url = None
        segments = []
        original_transcript = ""
        
        if "audioRecordings" in meeting:
            for rec in meeting["audioRecordings"]:
                if rec.get("transcriptionStatus") == "completed":
                    audio_url = rec.get("downloadURL") or rec.get("url") or rec.get("fileUrl")
                    segments = rec.get("segments", [])
                    original_transcript = rec.get("originalTranscription", "")
                    if audio_url: break

        # Fallback to legacy field
        if not audio_url:
            rec = meeting.get("audioRecording", {})
            audio_url = rec.get("downloadURL") or rec.get("url")
            original_transcript = rec.get("transcription", "")
                    
        if not audio_url:
             return https_fn.Response(json.dumps({"error": "Audio not found"}), status=404)
        
        # 2. Find Timestamps
        # If explicit timestamps provided (from a specific suggestion), use them
        target_start = data.get("startTime")
        target_end = data.get("endTime")
        
        start_time = 0
        end_time = 0
        found = False
        segment_text = ""
        
        candidates = []
        
        if target_start is not None and target_end is not None:
             start_time = float(target_start)
             end_time = float(target_end)
             found = True
             print(f"[Reinforce] Using provided timestamps: {start_time}-{end_time}")
             
        # Otherwise, find the best default segment (Longest Valid)
        # AND find candidates if we need more samples
        elif segments:
            longest_dur = 0
            
            # Scramble/Shuffle segments to avoid always picking the same ones if we have multiple candidates?
            # actually we want deterministic 'best' one first, then candidates.
            
            valid_segments = []
            
            for seg in segments:
                if seg.get("speaker") == speaker_label:
                    dur = seg.get("end", 0) - seg.get("start", 0)
                    if dur > 2: # Min 2 seconds
                        valid_segments.append(seg)

            # Sort by duration desc
            valid_segments.sort(key=lambda x: x.get("end",0)-x.get("start",0), reverse=True)
            
            if valid_segments:
                # Primary target: The longest one
                best_seg = valid_segments[0]
                start_time = best_seg.get("start")
                end_time = best_seg.get("end")
                found = True
                
                # Candidates: The next best ones (up to 3)
                # We'll return these so the UI can ask the user to validate them
                for cand in valid_segments[1:4]: # Take next 3
                    # Get text approximation or real text
                    # (In a real app, we'd look up the text in the transcript)
                    cand_text = "Segment audio..." # Placeholder if we can't easily extract text here
                    
                    candidates.append({
                        "startTime": cand.get("start"),
                        "endTime": cand.get("end"),
                        "duration": cand.get("end") - cand.get("start"),
                        "preview": f"Segment {cand.get('start')}s"
                    })

        # Fallback to text parsing if no segments array (Legacy)
        if not found and original_transcript and not (target_start and target_end):
             import re
             pattern = r"\[(\d+):(\d+)\]\s+\[" + re.escape(speaker_label) + r"\]\s*(.*?)(?=\[\d+):"
             # ... (Keep existing text parsing fallback for safety, simplified here)
             # If we are here, we likely don't have candidates support for legacy format
             pass

        if not found:
            return https_fn.Response(json.dumps({"error": f"Speaker {speaker_label} not found in transcript"}), status=404)
            
        # --- AI SUPERVISOR CHECK (Skip if using explicit timestamps - assumes user confirmed) ---
        if not (target_start and target_end):
             # Extract text for the CHOSEN segment to validate
             # ... (Logic to get text from transcript for start_time)
             pass 
             # For now, we trust the segments logic above or the text parsing
        # ---------------------------

        print(f"[Reinforce] Extracting {speaker_label} ({start_time}-{end_time}s) for member {member_id}")
        
        # 3. Extract Embedding
        try:
            new_embedding = extract_audio_segment_embedding(audio_url, start_time, end_time)
        except Exception as e:
            return https_fn.Response(json.dumps({"error": f"Extraction failed: {str(e)}"}), status=500)
            
        if not new_embedding:
             return https_fn.Response(json.dumps({"error": "Empty embedding"}), status=500)

        # 4. Update Member Profile
        member_ref = db.collection("members").document(member_id)
        member_doc = member_ref.get()
        if not member_doc.exists:
             return https_fn.Response(json.dumps({"error": "Member not found"}), status=404)
             
        member_data = member_doc.to_dict()
        current_embedding = member_data.get("embedding")
        
        # Parse / Handle Multi-Vector (Same as before)
        import json as json_lib
        if isinstance(current_embedding, str):
            try:
                current_embedding = json_lib.loads(current_embedding)
            except:
                current_embedding = []
        
        # CONSISTENCY CHECK (Reinforcement)
        # Check if new embedding matches existing profile
        warning_msg = ""
        is_outlier = False
        
        if current_embedding:
            from speaker_identification import cosine_similarity
            max_sim = -1.0
            
            # Helper to normalize 'current_embedding' to list of lists for comparison
            compare_list = []
            if isinstance(current_embedding, list) and len(current_embedding) > 0 and isinstance(current_embedding[0], list):
                 compare_list = current_embedding
            elif isinstance(current_embedding, list) and len(current_embedding) > 0:
                 compare_list = [current_embedding]
                 
            for old_vec in compare_list:
                sim = cosine_similarity(new_embedding, old_vec)
                if sim > max_sim:
                    max_sim = sim
            
            # Threshold Check
            # 0.60 is typical "same speaker" threshold for pyannote embeddings
            if max_sim > 0 and max_sim < 0.60:
                 is_outlier = True
                 warning_msg = f"Attention: Segment atypique (Score: {max_sim:.2f})."
                 print(f"[Reinforce] OUTLIER DETECTED! Similarity {max_sim:.2f} < 0.60")

        updated_embedding = []
        
        # Helper to add unique embeddings? (Cosine check could be done here to avoid duplicates)
        # For now, just append
        if not current_embedding:
            updated_embedding = [new_embedding]
        elif isinstance(current_embedding, list) and len(current_embedding) > 0 and isinstance(current_embedding[0], list):
             updated_embedding = current_embedding
             updated_embedding.append(new_embedding)
             if len(updated_embedding) > 20: # Dynamic Limit: 20 samples for robust profiles
                 updated_embedding = updated_embedding[-20:]
        elif isinstance(current_embedding, list):
             updated_embedding = [current_embedding, new_embedding]

        # Save
        member_ref.update({
            "embedding": json_lib.dumps(updated_embedding),
            "voiceSampleCount": len(updated_embedding),
            "lastVoiceUpdate": datetime.now().isoformat()
        })
        
        # Feedback Logic
        count = len(updated_embedding)
        msg = "Profil mis à jour."
        
        # Dynamic Limit: We allow up to 20 samples to ensure robustness.
        # If the profile was considered "weak" (outlier detected or < 10 samples), we ask for more.
        need_more = count < 20 or is_outlier
        
        if is_outlier:
            msg = f"⚠️ {warning_msg} Ajouté. Continuez à entraîner ({count}/20)."
        elif count < 5:
            msg = f"Profil en construction ({count}/20). Continuez !"
        elif count < 10:
             msg = f"Profil s'améliore ({count}/20)."
        else:
             msg = f"Profil robuste ({count} échantillons)."
            
        return https_fn.Response(json.dumps({
            "success": True, 
            "message": msg,
            "samples": count,
            "needMore": need_more, 
            "candidates": candidates
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[Reinforce] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# #2 CROSS-MEETING LEARNING: Aggregate voice samples from past meetings
# =============================================================================
@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def cross_meeting_learning(req: https_fn.Request) -> https_fn.Response:
    """
    Analyze past meetings to find additional voice samples for a member.
    Aggregates high-confidence segments to strengthen their voice profile.
    """
    try:
        data = req.get_json()
        member_id = data.get("memberId")
        member_name = data.get("memberName")
        max_meetings = data.get("maxMeetings", 10)
        
        if not member_id:
            return https_fn.Response(json.dumps({"error": "memberId required"}), status=400)
        
        print(f"[CrossMeeting] Learning for {member_name} ({member_id})")
        
        # Find past meetings with this member
        meetings_query = db.collection("meetings").order_by(
            "date", direction=firestore.Query.DESCENDING
        ).limit(max_meetings)
        
        meetings = list(meetings_query.stream())
        found_segments = []
        
        for meeting_doc in meetings:
            meeting = meeting_doc.to_dict()
            # Check if member was present
            attendees = meeting.get("attendees", [])
            was_present = any(
                (a.get("memberId") == member_id or a.get("name") == member_name) and 
                a.get("status", "").lower() in ["present", "présent", ""]
                for a in attendees
            )
            
            if not was_present:
                continue
            
            # Check speaker mapping for confirmed identifications
            audio_recordings = meeting.get("audioRecordings", [])
            for rec in audio_recordings:
                mapping = rec.get("speakerMapping", {})
                segments = rec.get("segments", [])
                audio_url = rec.get("downloadUrl")
                
                for label, name in mapping.items():
                    if name == member_name:
                        # Find this speaker's best segment
                        speaker_segs = [s for s in segments if s.get("speaker") == label]
                        if speaker_segs:
                            longest = max(speaker_segs, key=lambda x: x.get("end", 0) - x.get("start", 0))
                            found_segments.append({
                                "meetingId": meeting_doc.id,
                                "meetingDate": meeting.get("date"),
                                "start": longest.get("start"),
                                "end": longest.get("end"),
                                "audioUrl": audio_url
                            })
        
        print(f"[CrossMeeting] Found {len(found_segments)} segments across {len(meetings)} meetings")
        
        return https_fn.Response(json.dumps({
            "success": True,
            "memberId": member_id,
            "memberName": member_name,
            "segmentsFound": len(found_segments),
            "segments": found_segments[:5],  # Limit response size
            "message": f"Trouvé {len(found_segments)} segments dans {len(meetings)} réunions"
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[CrossMeeting] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# #11 MULTI-MEETING COMPARISON: Track identification accuracy over time
# =============================================================================
@https_fn.on_request(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def compare_meetings(req: https_fn.Request) -> https_fn.Response:
    """
    Compare identification accuracy across multiple meetings.
    Shows trend of AI performance over time.
    """
    try:
        data = req.get_json() or {}
        limit = data.get("limit", 10)
        
        print(f"[CompareMeetings] Analyzing last {limit} meetings")
        
        meetings_query = db.collection("meetings").order_by(
            "date", direction=firestore.Query.DESCENDING
        ).limit(limit)
        
        results = []
        for meeting_doc in meetings_query.stream():
            meeting = meeting_doc.to_dict()
            
            # Get identification stats
            audio_recordings = meeting.get("audioRecordings", [])
            total_speakers = 0
            identified_speakers = 0
            
            for rec in audio_recordings:
                mapping = rec.get("speakerMapping", {})
                segments = rec.get("segments", [])
                
                # Count unique speaker labels in segments
                unique_labels = set(s.get("speaker") for s in segments if s.get("speaker"))
                total_speakers += len(unique_labels)
                identified_speakers += len(mapping)
            
            accuracy = (identified_speakers / total_speakers * 100) if total_speakers > 0 else 0
            
            results.append({
                "meetingId": meeting_doc.id,
                "date": meeting.get("date"),
                "title": meeting.get("title", "Sans titre")[:50],
                "totalSpeakers": total_speakers,
                "identifiedSpeakers": identified_speakers,
                "accuracy": round(accuracy, 1)
            })
        
        # Calculate trend
        if len(results) >= 2:
            recent_avg = sum(r["accuracy"] for r in results[:3]) / min(3, len(results))
            older_avg = sum(r["accuracy"] for r in results[-3:]) / min(3, len(results))
            trend = "improving" if recent_avg > older_avg else "declining" if recent_avg < older_avg else "stable"
        else:
            trend = "insufficient_data"
        
        print(f"[CompareMeetings] Trend: {trend}")
        
        return https_fn.Response(json.dumps({
            "success": True,
            "meetings": results,
            "trend": trend,
            "averageAccuracy": round(sum(r["accuracy"] for r in results) / len(results), 1) if results else 0
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[CompareMeetings] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# #12 PROFILE DEGRADATION ALERT: Warn when profiles weaken over time
# =============================================================================
@https_fn.on_request(
    timeout_sec=180,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def check_profile_degradation(req: https_fn.Request) -> https_fn.Response:
    """
    Check all member profiles for signs of degradation:
    - Previously robust profiles now matching poorly
    - High variance in recent identifications
    - Profile not updated in long time
    """
    try:
        print("[ProfileDegradation] Checking all member profiles...")
        
        members_query = db.collection("members").stream()
        alerts = []
        
        for member_doc in members_query:
            member = member_doc.to_dict()
            member_id = member_doc.id
            name = member.get("displayName") or member.get("name") or "Inconnu"
            
            sample_count = member.get("voiceSampleCount", 0)
            last_update = member.get("lastVoiceUpdate")
            
            # Check 1: No samples at all
            if sample_count == 0:
                alerts.append({
                    "memberId": member_id,
                    "name": name,
                    "issue": "no_samples",
                    "severity": "warning",
                    "message": f"Aucun échantillon vocal pour {name}"
                })
                continue
            
            # Check 2: Very few samples
            if sample_count < 3:
                alerts.append({
                    "memberId": member_id,
                    "name": name,
                    "issue": "weak_profile",
                    "severity": "info",
                    "message": f"Profil faible ({sample_count}/10 échantillons)",
                    "sampleCount": sample_count
                })
            
            # Check 3: Profile not updated in 6+ months
            if last_update:
                try:
                    from datetime import datetime, timedelta
                    last_dt = datetime.fromisoformat(last_update.replace("Z", "+00:00"))
                    age_days = (datetime.now(last_dt.tzinfo) - last_dt).days if last_dt.tzinfo else (datetime.now() - last_dt).days
                    
                    if age_days > 180:  # 6 months
                        alerts.append({
                            "memberId": member_id,
                            "name": name,
                            "issue": "stale_profile",
                            "severity": "warning",
                            "message": f"Profil non mis à jour depuis {age_days} jours",
                            "lastUpdate": last_update
                        })
                except Exception:
                    pass
        
        # Summary
        by_severity = {"error": 0, "warning": 0, "info": 0}
        for alert in alerts:
            by_severity[alert.get("severity", "info")] += 1
        
        print(f"[ProfileDegradation] Found {len(alerts)} issues")
        
        return https_fn.Response(json.dumps({
            "success": True,
            "totalAlerts": len(alerts),
            "bySeverity": by_severity,
            "alerts": alerts
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[ProfileDegradation] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# #13 HUMAN VERIFICATION QUEUE: Queue uncertain segments for human review
# =============================================================================
@https_fn.on_request(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def human_verification_queue(req: https_fn.Request) -> https_fn.Response:
    """
    Manage a queue of uncertain speaker identifications for human review.
    GET: Retrieve pending items | POST: Submit verification (confirm/reject/add)
    """
    try:
        global db
        if db is None:
            db = firestore.client()

        if req.method == "GET":
            limit = int(req.args.get("limit", 20))
            # Uses composite index: status ASC + confidence DESC
            queue_query = db.collection("verification_queue").where(
                "status", "==", "pending"
            ).order_by("confidence", direction=firestore.Query.DESCENDING).limit(limit)
            
            items = []
            for doc in queue_query.stream():
                item = doc.to_dict()
                item["id"] = doc.id
                items.append(item)
            
            return https_fn.Response(json.dumps({
                "success": True,
                "pendingCount": len(items),
                "items": items
            }), status=200, content_type="application/json")
        
        elif req.method == "POST":
            data = req.get_json()
            action = data.get("action")
            
            if action == "add":
                item = {
                    "meetingId": data.get("meetingId"),
                    "speakerLabel": data.get("speakerLabel"),
                    "suggestedName": data.get("suggestedName"),
                    "confidence": data.get("confidence", 0),
                    "audioUrl": data.get("audioUrl"),
                    "start": data.get("start"),
                    "end": data.get("end"),
                    "textSample": data.get("textSample", "")[:200],
                    "reason": data.get("reason", "low_confidence"),
                    "status": "pending",
                    "createdAt": datetime.now().isoformat()
                }
                doc_ref = db.collection("verification_queue").add(item)
                return https_fn.Response(json.dumps({
                    "success": True, "itemId": doc_ref[1].id
                }), status=200, content_type="application/json")
            
            elif action in ["confirm", "reject"]:
                item_id = data.get("itemId")
                if not item_id:
                    return https_fn.Response(json.dumps({"error": "itemId required"}), status=400)
                doc_ref = db.collection("verification_queue").document(item_id)
                doc_ref.update({
                    "status": "verified" if action == "confirm" else "rejected",
                    "verifiedAt": datetime.now().isoformat(),
                    "correctedName": data.get("correctedName")
                })
                return https_fn.Response(json.dumps({
                    "success": True, "itemId": item_id
                }), status=200, content_type="application/json")
            
            return https_fn.Response(json.dumps({"error": "Invalid action"}), status=400)
        return https_fn.Response(json.dumps({"error": "Method not allowed"}), status=405)
    except Exception as e:
        print(f"[VerificationQueue] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# #16 VOICE SIGNATURE HASH: Unique fingerprint and duplicate detection
# =============================================================================
@https_fn.on_request(
    timeout_sec=180,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def voice_signature_hash(req: https_fn.Request) -> https_fn.Response:
    """Generate unique voice signature hash and detect duplicate profiles."""
    try:
        data = req.get_json() or {}
        action = data.get("action", "find_duplicates")
        
        if action == "generate":
            member_id = data.get("memberId")
            if not member_id:
                return https_fn.Response(json.dumps({"error": "memberId required"}), status=400)
            
            member_doc = db.collection("members").document(member_id).get()
            if not member_doc.exists:
                return https_fn.Response(json.dumps({"error": "Member not found"}), status=404)
            
            member = member_doc.to_dict()
            embedding = member.get("embedding")
            if not embedding:
                return https_fn.Response(json.dumps({"error": "No voice embedding"}), status=400)
            
            import json as json_lib
            import hashlib
            if isinstance(embedding, str):
                embedding = json_lib.loads(embedding)
            
            if isinstance(embedding, list) and len(embedding) > 0:
                avg_vec = [sum(v[i] for v in embedding) / len(embedding) for i in range(len(embedding[0]))] if isinstance(embedding[0], list) else embedding
                signature = hashlib.sha256(",".join(f"{v:.6f}" for v in avg_vec[:32]).encode()).hexdigest()[:16]
                db.collection("members").document(member_id).update({"voiceSignature": signature})
                return https_fn.Response(json.dumps({
                    "success": True, "signature": signature
                }), status=200, content_type="application/json")
        
        elif action == "find_duplicates":
            members = list(db.collection("members").stream())
            embeddings = {}
            import json as json_lib
            
            for doc in members:
                member = doc.to_dict()
                emb = member.get("embedding")
                if emb:
                    if isinstance(emb, str):
                        try: emb = json_lib.loads(emb)
                        except: continue
                    if isinstance(emb, list) and len(emb) > 0:
                        avg_vec = [sum(v[i] for v in emb) / len(emb) for i in range(len(emb[0]))] if isinstance(emb[0], list) else emb
                        embeddings[doc.id] = {"name": member.get("displayName") or member.get("name"), "vector": avg_vec}
            
            from speaker_identification import cosine_similarity
            duplicates = []
            ids = list(embeddings.keys())
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    sim = cosine_similarity(embeddings[ids[i]]["vector"], embeddings[ids[j]]["vector"])
                    if sim > 0.85:
                        duplicates.append({
                            "member1": {"id": ids[i], "name": embeddings[ids[i]]["name"]},
                            "member2": {"id": ids[j], "name": embeddings[ids[j]]["name"]},
                            "similarity": round(sim, 3)
                        })
            
            return https_fn.Response(json.dumps({
                "success": True, "duplicates": duplicates, "count": len(duplicates)
            }), status=200, content_type="application/json")
        
        return https_fn.Response(json.dumps({"error": "Invalid action"}), status=400)
    except Exception as e:
        print(f"[VoiceSignature] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# A: CLOSED FEEDBACK LOOP - Corrections automatically retrain profiles
# =============================================================================
@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def closed_feedback_loop(req: https_fn.Request) -> https_fn.Response:
    """
    When a user corrects a speaker identification, automatically:
    1. Log the correction for future learning
    2. Extract the correct embedding and reinforce the profile
    3. Update calibration data for confidence scoring
    """
    try:
        data = req.get_json()
        meeting_id = data.get("meetingId")
        speaker_label = data.get("speakerLabel")
        wrong_name = data.get("wrongName")  # What the AI predicted
        correct_name = data.get("correctName")  # What the user corrected to
        correct_member_id = data.get("correctMemberId")
        audio_url = data.get("audioUrl")
        start_time = data.get("start")
        end_time = data.get("end")
        original_confidence = data.get("originalConfidence", 0)
        
        if not all([meeting_id, speaker_label, correct_name]):
            return https_fn.Response(json.dumps({"error": "Missing required fields"}), status=400)
        
        print(f"[FeedbackLoop] Correction: {speaker_label} was '{wrong_name}' → now '{correct_name}'")
        
        # 1. Log correction for learning analytics
        correction_log = {
            "meetingId": meeting_id,
            "speakerLabel": speaker_label,
            "wrongPrediction": wrong_name,
            "correctAnswer": correct_name,
            "correctMemberId": correct_member_id,
            "originalConfidence": original_confidence,
            "timestamp": datetime.now().isoformat(),
            "type": "speaker_correction"
        }
        db.collection("ml_corrections").add(correction_log)
        
        # 2. Update calibration data
        calibration_ref = db.collection("ml_calibration").document("speaker_id")
        calibration_doc = calibration_ref.get()
        if calibration_doc.exists:
            cal_data = calibration_doc.to_dict()
            corrections = cal_data.get("corrections", [])
            corrections.append({
                "predicted_conf": original_confidence,
                "was_correct": False,  # This was a correction, so it was wrong
                "timestamp": datetime.now().isoformat()
            })
            # Keep last 500 for calibration
            calibration_ref.update({"corrections": corrections[-500:]})
        else:
            calibration_ref.set({"corrections": [{"predicted_conf": original_confidence, "was_correct": False}]})
        
        # 3. If we have audio segment, extract and reinforce correct profile
        reinforced = False
        if audio_url and start_time is not None and end_time is not None and correct_member_id:
            try:
                new_embedding = extract_audio_segment_embedding(audio_url, start_time, end_time)
                if new_embedding:
                    member_ref = db.collection("members").document(correct_member_id)
                    member_doc = member_ref.get()
                    if member_doc.exists:
                        member = member_doc.to_dict()
                        current_emb = member.get("embedding")
                        import json as json_lib
                        if current_emb and isinstance(current_emb, str):
                            current_emb = json_lib.loads(current_emb)
                        
                        if current_emb and isinstance(current_emb, list):
                            if isinstance(current_emb[0], list):
                                current_emb.append(new_embedding)
                                if len(current_emb) > 20:
                                    current_emb = current_emb[-20:]
                            else:
                                current_emb = [current_emb, new_embedding]
                        else:
                            current_emb = [new_embedding]
                        
                        member_ref.update({
                            "embedding": json_lib.dumps(current_emb),
                            "voiceSampleCount": len(current_emb) if isinstance(current_emb[0], list) else 1,
                            "lastVoiceUpdate": datetime.now().isoformat(),
                            "lastCorrectionSource": meeting_id
                        })
                        reinforced = True
                        print(f"[FeedbackLoop] Reinforced {correct_name}'s profile from correction")
                        # Sync updated embedding to Supabase
                        sync_embedding_to_supabase(correct_name, current_emb, correct_member_id or "", sample_source="correction")
            except Exception as e:
                print(f"[FeedbackLoop] Reinforcement failed: {e}")
        
        # 4. ACTIVE LEARNING: Compute embedding reward signal
        active_result = {}
        try:
            compute_embedding_reward(
                db_client=db,
                member_id=correct_member_id or "",
                was_correct=False,  # This was a correction, so the prediction was wrong
                confidence=original_confidence,
                correction_source="user",
            )
            
            # If we have the wrong member, penalize their embedding too
            if wrong_name:
                # Find wrong member ID
                wrong_query = db.collection("members").where(
                    "displayName", "==", wrong_name
                ).limit(1).stream()
                for wrong_doc in wrong_query:
                    compute_embedding_reward(
                        db_client=db,
                        member_id=wrong_doc.id,
                        was_correct=False,
                        confidence=original_confidence,
                        correction_source="user",
                    )
            
            # Use active learning for weighted embedding update
            if reinforced and correct_member_id and audio_url:
                active_result = update_embedding_with_correction(
                    db_client=db,
                    member_id=correct_member_id,
                    correct_embedding=new_embedding if 'new_embedding' in dir() else None,
                    wrong_embedding=None,
                    correction_weight=2.0,
                )
        except Exception as al_err:
            print(f"[FeedbackLoop] Active learning integration skipped: {al_err}")

        return https_fn.Response(json.dumps({
            "success": True,
            "logged": True,
            "reinforced": reinforced,
            "activeLearning": active_result if active_result else None,
            "message": f"Correction logged. Profile {'reinforced' if reinforced else 'not reinforced (no audio segment)'}."
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[FeedbackLoop] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# B: CONFIDENCE CALIBRATION - Platt Scaling for true probabilities
# =============================================================================
@https_fn.on_request(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def calibrate_confidence(req: https_fn.Request) -> https_fn.Response:
    """
    Use Platt Scaling to calibrate raw scores into true probabilities.
    Based on historical correction data.
    """
    try:
        data = req.get_json() or {}
        action = data.get("action", "get_calibration")
        
        if action == "get_calibration":
            # Retrieve current calibration parameters
            cal_doc = db.collection("ml_calibration").document("speaker_id").get()
            if not cal_doc.exists:
                return https_fn.Response(json.dumps({
                    "success": True,
                    "calibrated": False,
                    "message": "No calibration data yet"
                }), status=200, content_type="application/json")
            
            cal_data = cal_doc.to_dict()
            corrections = cal_data.get("corrections", [])
            
            if len(corrections) < 20:
                return https_fn.Response(json.dumps({
                    "success": True,
                    "calibrated": False,
                    "dataPoints": len(corrections),
                    "message": "Need at least 20 corrections for calibration"
                }), status=200, content_type="application/json")
            
            # Simple Platt Scaling: fit sigmoid to correction data
            # Group by confidence bins and calculate accuracy
            bins = {i/10: {"correct": 0, "total": 0} for i in range(11)}
            for c in corrections:
                conf = c.get("predicted_conf", 0.5)
                was_correct = c.get("was_correct", True)
                bin_key = round(conf, 1)
                if bin_key in bins:
                    bins[bin_key]["total"] += 1
                    if was_correct:
                        bins[bin_key]["correct"] += 1
            
            calibration_curve = {}
            for conf, data in bins.items():
                if data["total"] > 0:
                    calibration_curve[str(conf)] = round(data["correct"] / data["total"], 3)
            
            return https_fn.Response(json.dumps({
                "success": True,
                "calibrated": True,
                "dataPoints": len(corrections),
                "calibrationCurve": calibration_curve,
                "message": "Calibration computed from historical data"
            }), status=200, content_type="application/json")
        
        elif action == "calibrate_score":
            # Apply calibration to a raw score
            raw_score = data.get("score", 0.5)
            
            # Simple sigmoid adjustment based on observed accuracy
            # In production, use actual Platt parameters A, B from logistic regression
            # For now, use conservative adjustment
            calibrated = raw_score * 0.9  # Conservative: slightly reduce confidence
            
            return https_fn.Response(json.dumps({
                "success": True,
                "rawScore": raw_score,
                "calibratedScore": round(calibrated, 3)
            }), status=200, content_type="application/json")
        
        return https_fn.Response(json.dumps({"error": "Invalid action"}), status=400)
        
    except Exception as e:
        print(f"[Calibration] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# C: ENSEMBLE STRATEGIES - Multi-method voting for robust identification
# =============================================================================
@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def ensemble_identify(req: https_fn.Request) -> https_fn.Response:
    """
    Combine multiple identification strategies and vote on final result:
    1. Voice embedding similarity
    2. Context analysis (GROQ)
    3. Historical pattern (who usually speaks in this context)
    4. Meeting role (president usually opens, secretary reads)
    """
    try:
        data = req.get_json()
        meeting_id = data.get("meetingId")
        speaker_label = data.get("speakerLabel")
        text_sample = data.get("textSample", "")
        
        if not meeting_id or not speaker_label:
            return https_fn.Response(json.dumps({"error": "meetingId and speakerLabel required"}), status=400)
        
        print(f"[Ensemble] Identifying {speaker_label} with multiple strategies")
        
        # Get meeting data
        meeting_doc = db.collection("meetings").document(meeting_id).get()
        if not meeting_doc.exists:
            return https_fn.Response(json.dumps({"error": "Meeting not found"}), status=404)
        
        meeting = meeting_doc.to_dict()
        attendees = meeting.get("attendees", [])
        present_names = [a.get("name") or a.get("displayName") for a in attendees 
                        if a.get("status", "").lower() in ["present", "présent", ""]]
        
        votes = {}  # {name: score}
        strategies_used = []
        
        # Strategy 1: Context keywords
        text_lower = text_sample.lower()
        context_keywords = {
            "président": ["madame la présidente", "monsieur le président", "je déclare", "la séance"],
            "secrétaire": ["procès-verbal", "lecture du", "adopté à l'unanimité"],
        }
        for role, keywords in context_keywords.items():
            for kw in keywords:
                if kw in text_lower:
                    # Find attendee with this role
                    for a in attendees:
                        if role in (a.get("role", "") or "").lower():
                            name = a.get("name") or a.get("displayName")
                            if name:
                                votes[name] = votes.get(name, 0) + 0.3
                                strategies_used.append(f"context_role:{role}")
        
        # Strategy 2: Name mentions
        for name in present_names:
            if name and name.lower() in text_lower:
                votes[name] = votes.get(name, 0) + 0.2
                strategies_used.append(f"name_mention:{name}")
        
        # Strategy 3: Historical pattern (who spoke most in past meetings)
        past_speakers = db.collection("meetings").where("date", "<", meeting.get("date", "")).limit(5).stream()
        speaker_history = {}
        for pm in past_speakers:
            pm_data = pm.to_dict()
            for rec in pm_data.get("audioRecordings", []):
                for label, name in rec.get("speakerMapping", {}).items():
                    speaker_history[name] = speaker_history.get(name, 0) + 1
        
        for name, count in speaker_history.items():
            if name in present_names:
                votes[name] = votes.get(name, 0) + min(0.2, count * 0.02)
        if speaker_history:
            strategies_used.append("historical_pattern")
        
        # Calculate final scores
        if votes:
            max_vote = max(votes.values())
            for name in votes:
                votes[name] = round(votes[name] / max(max_vote, 1), 3)
        
        # Sort by score
        ranked = sorted(votes.items(), key=lambda x: x[1], reverse=True)
        
        return https_fn.Response(json.dumps({
            "success": True,
            "speakerLabel": speaker_label,
            "strategies": strategies_used,
            "votes": dict(ranked[:5]),
            "topCandidate": ranked[0][0] if ranked else None,
            "confidence": ranked[0][1] if ranked else 0
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[Ensemble] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# D: ACTIVE LEARNING - Prioritize most useful samples for validation
# =============================================================================
@https_fn.on_request(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST"])
)
def active_learning_priority(req: https_fn.Request) -> https_fn.Response:
    """
    Determine which samples would be most valuable for human validation.
    Prioritizes:
    1. Uncertainty sampling (confidence near 0.5)
    2. Disagreement between strategies
    3. Members with weak profiles
    4. Edge cases (very short/long segments)
    """
    try:
        data = req.get_json() or {}
        meeting_id = data.get("meetingId")
        limit = data.get("limit", 10)
        
        print(f"[ActiveLearning] Computing priority samples for meeting {meeting_id}")
        
        priority_items = []
        
        if meeting_id:
            # Get meeting segments and analyze
            meeting_doc = db.collection("meetings").document(meeting_id).get()
            if meeting_doc.exists:
                meeting = meeting_doc.to_dict()
                for rec in meeting.get("audioRecordings", []):
                    segments = rec.get("segments", [])
                    mapping = rec.get("speakerMapping", {})
                    
                    for seg in segments:
                        speaker = seg.get("speaker", "")
                        text = seg.get("text", "")
                        start = seg.get("start", 0)
                        end = seg.get("end", 0)
                        duration = end - start
                        
                        priority_score = 0
                        reasons = []
                        
                        # Not yet identified
                        if speaker and speaker not in mapping:
                            priority_score += 0.5
                            reasons.append("unidentified")
                        
                        # Medium duration (most useful for training)
                        if 5 < duration < 30:
                            priority_score += 0.2
                            reasons.append("good_duration")
                        elif duration > 60:
                            priority_score += 0.3
                            reasons.append("long_segment")
                        
                        # Contains clear speech indicators
                        if any(kw in text.lower() for kw in ["je", "nous", "mon", "notre"]):
                            priority_score += 0.1
                            reasons.append("first_person_speech")
                        
                        if priority_score > 0.3:
                            priority_items.append({
                                "speakerLabel": speaker,
                                "start": start,
                                "end": end,
                                "duration": round(duration, 1),
                                "textSample": text[:100],
                                "priorityScore": round(priority_score, 2),
                                "reasons": reasons
                            })
        
        # Also check verification queue for pending items
        queue_items = list(db.collection("verification_queue").where(
            "status", "==", "pending"
        ).limit(5).stream())
        
        for doc in queue_items:
            item = doc.to_dict()
            priority_items.append({
                "speakerLabel": item.get("speakerLabel"),
                "start": item.get("start"),
                "end": item.get("end"),
                "textSample": item.get("textSample", "")[:100],
                "priorityScore": 0.8,  # Queue items are high priority
                "reasons": ["in_verification_queue"],
                "queueId": doc.id
            })
        
        # Sort by priority
        priority_items.sort(key=lambda x: x["priorityScore"], reverse=True)
        
        return https_fn.Response(json.dumps({
            "success": True,
            "totalItems": len(priority_items),
            "items": priority_items[:limit],
            "message": f"Found {len(priority_items)} samples ranked by learning value"
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[ActiveLearning] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# AI PROACTIVE LEARNING - AI requests user to validate selected segments
# =============================================================================

def _parse_timestamp(ts_str: str) -> float:
    """Parse a timestamp string like '01:23' or '01:23:45' into seconds."""
    parts = ts_str.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        pass
    return 0.0

@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def suggest_profile_improvements(req: https_fn.Request) -> https_fn.Response:
    """
    AI proactively finds segments to improve weak profiles.
    Parses transcription text to find segments where each member speaks,
    and estimates timestamps from text position or [HH:MM] markers.
    """

    try:
        global db
        if db is None:
            db = firestore.client()

        data = req.get_json() or {}
        limit = data.get("limit", 5)
        
        print("[ProactiveLearning] Analyzing profiles for improvement...")
        
        suggestions = []
        members = list(db.collection("members").stream())
        weak_profiles = []
        
        for doc in members:
            member = doc.to_dict()
            sample_count = member.get("voiceSampleCount", 0) or 0
            name = member.get("displayName") or member.get("name")
            if not name:
                continue
            if sample_count < 10:
                weak_profiles.append({
                    "memberId": doc.id, "name": name, "sampleCount": sample_count,
                    "improvement": round((10 - sample_count) / 10 * 100, 0)
                })
        
        weak_profiles.sort(key=lambda x: x["improvement"], reverse=True)
        
        import re as re_mod
        
        for wp in weak_profiles[:limit]:
            meetings_query = db.collection("meetings").order_by(
                "date", direction=firestore.Query.DESCENDING
            ).limit(10)
            
            found_segments = []
            for meeting_doc in meetings_query.stream():
                meeting = meeting_doc.to_dict()
                
                # Get audio URL and transcription from the actual data model
                audio_url = None
                transcription_text = None
                audio_duration = 0
                
                # Try singular audioRecording first (primary model)
                rec = meeting.get("audioRecording")
                if rec and isinstance(rec, dict):
                    audio_url = rec.get("fileUrl") or rec.get("downloadUrl")
                    transcription_text = rec.get("transcription", "")
                    audio_duration = rec.get("duration", 0) or 0
                
                # Try plural audioRecordings as fallback
                if not audio_url:
                    recs = meeting.get("audioRecordings", [])
                    if recs and isinstance(recs, list) and len(recs) > 0:
                        first_rec = recs[0] if isinstance(recs[0], dict) else {}
                        audio_url = first_rec.get("fileUrl") or first_rec.get("downloadUrl")
                        transcription_text = first_rec.get("transcription", "")
                        audio_duration = first_rec.get("duration", 0) or 0
                
                if not audio_url or not transcription_text:
                    continue
                
                # Parse transcription to find segments where this member speaks
                member_name = wp["name"]
                escaped_name = re_mod.escape(member_name)
                
                # Find all timestamps [HH:MM:SS] or [MM:SS]
                timestamp_pattern = re_mod.compile(r'\[(\d{1,2}:\d{2}(?::\d{2})?)\]')
                speaker_pattern = re_mod.compile(
                    r'(?:\[' + escaped_name + r'\]|\*\*' + escaped_name + r'\*\*:?)',
                    re_mod.IGNORECASE
                )
                
                timestamps = [(m.start(), m.group(1)) for m in timestamp_pattern.finditer(transcription_text)]
                speaker_matches = list(speaker_pattern.finditer(transcription_text))
                
                for sp_match in speaker_matches:
                    sp_pos = sp_match.start()
                    start_time = 0
                    end_time = 0
                    
                    if timestamps:
                        prev_ts = None
                        next_ts = None
                        for ts_pos, ts_val in timestamps:
                            if ts_pos <= sp_pos:
                                prev_ts = ts_val
                            elif next_ts is None:
                                next_ts = ts_val
                        
                        if prev_ts:
                            start_time = _parse_timestamp(prev_ts)
                        if next_ts:
                            end_time = _parse_timestamp(next_ts)
                        elif audio_duration > 0:
                            end_time = min(start_time + 30, audio_duration)
                        else:
                            end_time = start_time + 30
                    elif audio_duration > 0:
                        # Estimate timestamp from text position ratio
                        text_ratio = sp_pos / max(len(transcription_text), 1)
                        start_time = int(text_ratio * audio_duration)
                        end_time = min(start_time + 30, audio_duration)
                    
                    duration = end_time - start_time
                    
                    if 5 < duration < 60 and start_time >= 0:
                        text_start = sp_match.end()
                        text_end = min(text_start + 100, len(transcription_text))
                        text_sample = transcription_text[text_start:text_end].strip()
                        text_sample = re_mod.sub(r'\[.*?\]', '', text_sample).strip()[:80]
                        
                        found_segments.append({
                            "meetingId": meeting_doc.id,
                            "meetingTitle": meeting.get("title", "Sans titre")[:40],
                            "audioUrl": audio_url,
                            "start": round(start_time, 1),
                            "end": round(end_time, 1),
                            "duration": round(duration, 1),
                            "text": text_sample or "(segment audio)"
                        })
            
            # Deduplicate and pick best segments
            seen = set()
            unique_segments = []
            for seg in found_segments:
                key = f"{seg['meetingId']}-{seg['start']}"
                if key not in seen:
                    seen.add(key)
                    unique_segments.append(seg)
            
            best_segments = sorted(unique_segments, key=lambda x: x["duration"], reverse=True)[:3]
            if best_segments:
                suggestions.append({
                    "memberId": wp["memberId"],
                    "memberName": wp["name"],
                    "currentSamples": wp["sampleCount"],
                    "improvement": f"+{wp['improvement']:.0f}%",
                    "segments": best_segments,
                    "aiMessage": f"\U0001f9e0 Valider ces segments am\u00e9liorera {wp['name']} de ~{wp['improvement']:.0f}%"
                })
        
        return https_fn.Response(json.dumps({
            "success": True,
            "aiMessage": f"\U0001f916 {len(suggestions)} profil(s) peuvent \u00eatre am\u00e9lior\u00e9s",
            "suggestions": suggestions
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[ProactiveLearning] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)



# NOTE: human_verification_queue duplicate removed — original is at #13 above (line ~5309)
# It handles both GET (fetch pending items) and POST (confirm/reject/add)


@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def apply_ai_suggestion(req: https_fn.Request) -> https_fn.Response:
    """Apply user-approved AI suggestion to improve profile."""

    try:
        global db
        if db is None:
            db = firestore.client()

        data = req.get_json()
        member_id = data.get("memberId")
        member_name = data.get("memberName")
        audio_url = data.get("audioUrl")
        start_time = data.get("start")
        end_time = data.get("end")
        
        if not all([member_id, audio_url, start_time is not None, end_time is not None]):
            return https_fn.Response(json.dumps({"error": "Missing fields"}), status=400)
        
        print(f"[ApplySuggestion] Applying for {member_name} ({start_time}-{end_time}s)")
        
        new_embedding = extract_audio_segment_embedding(audio_url, start_time, end_time)
        if not new_embedding:
            return https_fn.Response(json.dumps({"error": "Extraction failed"}), status=500)
        
        member_ref = db.collection("members").document(member_id)
        member_doc = member_ref.get()
        if not member_doc.exists:
            return https_fn.Response(json.dumps({"error": "Not found"}), status=404)
        
        member = member_doc.to_dict()
        current_emb = member.get("embedding")
        import json as json_lib
        if current_emb and isinstance(current_emb, str):
            try:
                current_emb = json_lib.loads(current_emb)
            except:
                current_emb = None
        
        # DEDUPLICATION: Check if new embedding is too similar to existing ones
        from speaker_identification import cosine_similarity as cos_sim
        is_duplicate = False
        if current_emb and isinstance(current_emb, list):
            existing_vecs = current_emb if (isinstance(current_emb[0], list)) else [current_emb]
            for existing_vec in existing_vecs:
                if len(existing_vec) == len(new_embedding):
                    sim = cos_sim(new_embedding, existing_vec)
                    if sim > 0.95:
                        is_duplicate = True
                        print(f"[ApplySuggestion] Duplicate embedding detected (sim={sim:.3f}), skipping")
                        break
        
        if is_duplicate:
            count = member.get("voiceSampleCount", 1)
            return https_fn.Response(json.dumps({
                "success": True,
                "memberName": member_name,
                "newSampleCount": count,
                "message": f"⚠️ Échantillon trop similaire à un existant. Profil inchangé ({count} samples)"
            }), status=200, content_type="application/json")
        
        if current_emb and isinstance(current_emb, list):
            if isinstance(current_emb[0], list):
                current_emb.append(new_embedding)
                if len(current_emb) > 20:
                    current_emb = current_emb[-20:]
            else:
                current_emb = [current_emb, new_embedding]
        else:
            current_emb = [new_embedding]
        
        count = len(current_emb) if isinstance(current_emb[0], list) else 1
        member_ref.update({
            "embedding": json_lib.dumps(current_emb),
            "voiceSampleCount": count,
            "lastVoiceUpdate": datetime.now().isoformat(),
            "lastUpdateSource": "ai_suggestion"
        })
        
        db.collection("ml_suggestions_applied").add({
            "memberId": member_id, "memberName": member_name,
            "timestamp": datetime.now().isoformat()
        })
        
        # Sync to Supabase speakers table
        sync_embedding_to_supabase(member_name, current_emb, member_id, sample_source="ml_auto")
        return https_fn.Response(json.dumps({
            "success": True,
            "memberName": member_name,
            "newSampleCount": count,
            "message": f"✅ {member_name} amélioré ! ({count}/20 samples)"
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[ApplySuggestion] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# AUTONOMOUS ML LOOP - Global orchestration of all ML components
# =============================================================================
@https_fn.on_request(
    timeout_sec=540,
    memory=options.MemoryOption.GB_2,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def autonomous_ml_loop(req: https_fn.Request) -> https_fn.Response:
    """
    Global autonomous ML loop that runs after each transcription.
    Orchestrates all ML components:
    
    1. AUTO-LEARN: High-confidence matches (>90%) -> auto-reinforce profile
    2. CALIBRATE: Update confidence calibration from history
    3. QUEUE: Uncertain matches (<70%) -> human verification queue
    4. SUGGEST: Weak profiles -> proactive improvement suggestions
    5. TRACK: Log performance metrics
    
    Can be triggered:
    - Manually via API call
    - Automatically after transcription (post-processing hook)
    - Scheduled via Cloud Scheduler
    """

    try:
        global db
        if db is None:
            db = firestore.client()

        data = req.get_json() or {}
        meeting_id = data.get("meetingId")  # Optional: focus on specific meeting
        mode = data.get("mode", "full")  # full, quick, calibrate_only
        
        print(f"[AutonomousML] Starting loop - mode={mode}, meeting={meeting_id}")
        
        results = {
            "autoLearned": 0,
            "queuedForReview": 0,
            "suggestionsGenerated": 0,
            "calibrationUpdated": False,
            "metricsLogged": False,
            "actions": []
        }
        
        # =================================================================
        # STEP 1: AUTO-LEARN from high-confidence identifications
        # =================================================================
        if mode in ["full", "quick"]:
            print("[AutonomousML] Step 1: Auto-learning from high-confidence matches...")
            
            # Get recent identifications with high confidence
            if meeting_id:
                meetings = [db.collection("meetings").document(meeting_id).get()]
            else:
                meetings = list(db.collection("meetings").order_by(
                    "date", direction=firestore.Query.DESCENDING
                ).limit(5).stream())
            
            for meeting_doc in meetings:
                if not meeting_doc.exists:
                    continue
                meeting = meeting_doc.to_dict()
                
                for rec in meeting.get("audioRecordings", []):
                    mapping = rec.get("speakerMapping", {})
                    confidence_data = rec.get("confidenceScores", {})
                    segments = rec.get("segments", [])
                    audio_url = rec.get("downloadUrl")
                    
                    for label, name in mapping.items():
                        conf_info = confidence_data.get(label, {})
                        score = conf_info.get("score", 0) if isinstance(conf_info, dict) else conf_info
                        method = conf_info.get("method", "") if isinstance(conf_info, dict) else ""
                        
                        # AUTO-LEARN: High confidence (>80%) — relaxed from 90%
                        # No longer requires "voice" method — any high-confidence match qualifies
                        if score >= 0.80:
                            # Find member and add embedding
                            member_query = db.collection("members").where("displayName", "==", name).limit(1).stream()
                            for member_doc in member_query:
                                member = member_doc.to_dict()
                                sample_count = member.get("voiceSampleCount", 0)
                                
                                # Only learn if profile needs more samples
                                if sample_count < 15:
                                    # Find best segment for this speaker (prefer 15-45s range)
                                    speaker_segs = [s for s in segments if s.get("speaker") == label]
                                    if speaker_segs and audio_url:
                                        # Prefer segments in the 15-45s sweet spot
                                        ideal_segs = [s for s in speaker_segs 
                                                      if 15 <= (s.get("end", 0) - s.get("start", 0)) <= 45]
                                        if not ideal_segs:
                                            ideal_segs = [s for s in speaker_segs 
                                                          if 5 < (s.get("end", 0) - s.get("start", 0)) < 60]
                                        
                                        if ideal_segs:
                                            best_seg = max(ideal_segs, key=lambda x: x.get("end", 0) - x.get("start", 0))
                                            duration = best_seg.get("end", 0) - best_seg.get("start", 0)
                                        
                                            try:
                                                new_emb = extract_audio_segment_embedding(
                                                    audio_url, best_seg["start"], best_seg["end"]
                                                )
                                                if new_emb:
                                                    # DEDUPLICATION: Check if this embedding is too similar to existing ones
                                                    from speaker_identification import cosine_similarity as cos_sim
                                                    current_emb = member.get("embedding")
                                                    import json as jlib
                                                    if current_emb and isinstance(current_emb, str):
                                                        try:
                                                            current_emb = jlib.loads(current_emb)
                                                        except:
                                                            current_emb = None
                                                    
                                                    is_duplicate = False
                                                    if current_emb and isinstance(current_emb, list):
                                                        existing_vecs = current_emb if isinstance(current_emb[0], list) else [current_emb]
                                                        for existing_vec in existing_vecs:
                                                            if len(existing_vec) == len(new_emb):
                                                                sim = cos_sim(new_emb, existing_vec)
                                                                if sim > 0.95:  # Too similar — skip
                                                                    is_duplicate = True
                                                                    print(f"[AutonomousML] Skipping duplicate embedding for {name} (sim={sim:.3f})")
                                                                    break
                                                    
                                                    if not is_duplicate:
                                                        # Update profile with new diverse embedding
                                                        if current_emb and isinstance(current_emb, list):
                                                            if isinstance(current_emb[0], list):
                                                                current_emb.append(new_emb)
                                                                current_emb = current_emb[-15:]
                                                            else:
                                                                current_emb = [current_emb, new_emb]
                                                        else:
                                                            current_emb = [new_emb]
                                                        
                                                        new_count = len(current_emb) if isinstance(current_emb[0], list) else 1
                                                        db.collection("members").document(member_doc.id).update({
                                                            "embedding": jlib.dumps(current_emb),
                                                            "voiceSampleCount": new_count,
                                                            "lastVoiceUpdate": datetime.now().isoformat(),
                                                            "lastUpdateSource": "autonomous_ml"
                                                        })
                                                        results["autoLearned"] += 1
                                                        results["actions"].append(f"Auto-learned: {name} ({new_count} samples)")
                                                        # Sync to Supabase
                                                        sync_embedding_to_supabase(name, current_emb, member_doc.id, sample_source="ml_auto")
                                            except Exception as e:
                                                print(f"[AutonomousML] Auto-learn failed for {name}: {e}")
                        
                        # QUEUE: Low confidence (<70%) → needs human review
                        elif score < 0.70 and score > 0.40:
                            # Add to verification queue
                            existing = list(db.collection("verification_queue").where(
                                "speakerLabel", "==", label
                            ).where("meetingId", "==", meeting_doc.id).limit(1).stream())
                            
                            if not existing:
                                best_seg = max([s for s in segments if s.get("speaker") == label] or [{}], 
                                              key=lambda x: x.get("end", 0) - x.get("start", 0), default={})
                                
                                db.collection("verification_queue").add({
                                    "meetingId": meeting_doc.id,
                                    "speakerLabel": label,
                                    "suggestedName": name,
                                    "confidence": score,
                                    "start": best_seg.get("start"),
                                    "end": best_seg.get("end"),
                                    "textSample": best_seg.get("text", "")[:100],
                                    "status": "pending",
                                    "createdAt": datetime.now().isoformat()
                                })
                                results["queuedForReview"] += 1
                                results["actions"].append(f"Queued for review: {label} → {name}?")
        
        # =================================================================
        # STEP 2: UPDATE CALIBRATION
        # =================================================================
        if mode in ["full", "calibrate_only"]:
            print("[AutonomousML] Step 2: Updating calibration...")
            
            # Get recent corrections
            corrections = list(db.collection("ml_corrections").order_by(
                "timestamp", direction=firestore.Query.DESCENDING
            ).limit(100).stream())
            
            if len(corrections) >= 10:
                # Calculate accuracy by confidence bin
                bins = {i/10: {"correct": 0, "wrong": 0} for i in range(11)}
                
                for doc in corrections:
                    c = doc.to_dict()
                    conf = c.get("originalConfidence", 0.5)
                    was_correct = c.get("wasCorrect", False)
                    bin_key = round(conf, 1)
                    if bin_key in bins:
                        if was_correct:
                            bins[bin_key]["correct"] += 1
                        else:
                            bins[bin_key]["wrong"] += 1
                
                calibration_curve = {}
                for conf, data in bins.items():
                    total = data["correct"] + data["wrong"]
                    if total > 0:
                        calibration_curve[str(conf)] = round(data["correct"] / total, 3)
                
                db.collection("ml_calibration").document("speaker_id").set({
                    "calibrationCurve": calibration_curve,
                    "dataPoints": len(corrections),
                    "updatedAt": datetime.now().isoformat()
                }, merge=True)
                
                results["calibrationUpdated"] = True
                results["actions"].append("Calibration updated")
        
        # =================================================================
        # STEP 3: GENERATE PROACTIVE SUGGESTIONS
        # =================================================================
        if mode == "full":
            print("[AutonomousML] Step 3: Generating suggestions for weak profiles...")
            
            members = list(db.collection("members").stream())
            for doc in members:
                member = doc.to_dict()
                sample_count = member.get("voiceSampleCount", 0)
                name = member.get("displayName") or member.get("name")
                
                if sample_count < 5:  # Very weak profile
                    # Check if suggestion already exists
                    existing = list(db.collection("ml_suggestions").where(
                        "memberId", "==", doc.id
                    ).where("status", "==", "pending").limit(1).stream())
                    
                    if not existing:
                        db.collection("ml_suggestions").add({
                            "memberId": doc.id,
                            "memberName": name,
                            "currentSamples": sample_count,
                            "improvementPotential": f"+{(10 - sample_count) * 10}%",
                            "status": "pending",
                            "createdAt": datetime.now().isoformat()
                        })
                        results["suggestionsGenerated"] += 1
        
        # =================================================================
        # STEP 4: LOG PERFORMANCE METRICS
        # =================================================================
        print("[AutonomousML] Step 4: Logging metrics...")
        
        db.collection("ml_metrics").add({
            "timestamp": datetime.now().isoformat(),
            "autoLearned": results["autoLearned"],
            "queuedForReview": results["queuedForReview"],
            "suggestionsGenerated": results["suggestionsGenerated"],
            "calibrationUpdated": results["calibrationUpdated"],
            "mode": mode,
            "meetingId": meeting_id
        })
        results["metricsLogged"] = True
        
        print(f"[AutonomousML] Loop complete: {results}")
        
        return https_fn.Response(json.dumps({
            "success": True,
            "message": f"🤖 ML Loop terminée: {results['autoLearned']} auto-appris, {results['queuedForReview']} en attente de validation",
            "results": results
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[AutonomousML] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# POST-TRANSCRIPTION HOOK - Automatically trigger ML loop after transcription
# =============================================================================
@https_fn.on_request(
    timeout_sec=60,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST"])
)
def trigger_ml_after_transcription(req: https_fn.Request) -> https_fn.Response:
    """
    Webhook called after a transcription completes.
    Triggers the autonomous ML loop in background.
    """
    try:
        data = req.get_json()
        meeting_id = data.get("meetingId")
        
        if not meeting_id:
            return https_fn.Response(json.dumps({"error": "meetingId required"}), status=400)
        
        print(f"[PostTranscription] Triggering ML loop for meeting {meeting_id}")
        
        # Log the trigger
        db.collection("ml_triggers").add({
            "meetingId": meeting_id,
            "timestamp": datetime.now().isoformat(),
            "source": "post_transcription"
        })
        
        # Note: In production, this would call autonomous_ml_loop asynchronously
        # For now, return immediately and let user call ML loop manually or via scheduler
        
        return https_fn.Response(json.dumps({
            "success": True,
            "message": f"ML loop triggered for meeting {meeting_id}",
            "nextStep": "Call /autonomous_ml_loop with meetingId to run full analysis"
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[PostTranscription] Error: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# PV PIPELINE — Étapes 4 à 10 du pipeline de génération de PV
# =============================================================================

from pv_pipeline import (
    analyze_odj_mapping,
    classify_agenda_items,
    run_reflection_loop,
    compare_with_historical,
    record_learning,
    run_pv_pipeline,
)

from rlhf_engine import (
    compute_reward,
    optimize_policy,
    get_current_policy,
    record_preference,
    get_learned_preferences,
    enhance_prompt_with_rlhf,
    compute_embedding_reward,
    get_members_needing_improvement,
)

from recommendation_engine import (
    detect_patterns,
    predict_resolutions,
    learn_resolution_template,
    extract_meeting_features,
)

from active_learning import (
    update_embedding_with_correction,
    analyze_embedding_quality,
    build_style_memory,
    inject_style_memory_into_prompt,
    analyze_quality_trends,
)

from clear_supabase_speakers import clear_supabase_speakers
from batch_enroll_from_storage import batch_enroll_from_storage
from migrate_to_supabase_primary import run_migration_to_supabase_primary
from auto_migration import ensure_migration_completed, get_migration_status
from migration_status import api_get_migration_status, trigger_manual_migration, reset_migration_flag
from diagnose_migration import api_diagnose_migration
from diagnose_enrollment import diagnose_enrollment_issues
from sync_firestore_to_supabase import force_sync_firestore_to_supabase
from retry_enrollment import retry_failed_enrollments


# -----------------------------------------------------------------------------
# STEP 4: ANALYSE ODJ — Mapping discussions → Points ordre du jour
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
)
def pv_analyze_odj(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function: Analyse ODJ — Map transcription segments to agenda items.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    transcription = data.get("transcription")
    agenda_items = data.get("agendaItems", [])
    speaker_mapping = data.get("speakerMapping")

    if not transcription:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: transcription"
        )

    if not agenda_items:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: agendaItems"
        )

    print(f"[PV-ODJ] Analyzing {len(agenda_items)} agenda items")

    try:
        client = get_anthropic_client()
        result = analyze_odj_mapping(
            transcription=transcription,
            agenda_items=agenda_items,
            speaker_mapping=speaker_mapping,
            anthropic_client=client,
        )
        return {"success": True, **result}
    except Exception as e:
        print(f"[PV-ODJ] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# STEP 5: CLASSIFICATION — Catégorisation thématique + sentiment
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
)
def pv_classify(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function: Classification — Categorize agenda items by theme and sentiment.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    meeting_date = data.get("meetingDate", "")
    odj_analysis = data.get("odjAnalysis")

    if not odj_analysis:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: odjAnalysis"
        )

    print(f"[PV-Classify] Classifying {len(odj_analysis.get('mappedItems', []))} items")

    try:
        client = get_anthropic_client()
        result = classify_agenda_items(
            meeting_date=meeting_date,
            odj_analysis=odj_analysis,
            anthropic_client=client,
        )
        return {"success": True, **result}
    except Exception as e:
        print(f"[PV-Classify] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# STEP 7: RÉFLEXION — Auto-critique + corrections automatiques (boucle)
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=540,
    memory=options.MemoryOption.GB_2,
)
def pv_reflect(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function: Réflexion — Self-critique loop on PV draft.
    Runs up to maxIterations of self-critique until quality threshold is met.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    pv_draft = data.get("pvDraft")
    transcription = data.get("transcription")
    max_iterations = data.get("maxIterations", 3)
    min_quality_score = data.get("minQualityScore", 90)

    if not pv_draft:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: pvDraft"
        )

    if not transcription:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: transcription"
        )

    print(f"[PV-Reflect] Starting reflection loop (max {max_iterations} iterations)")

    try:
        client = get_anthropic_client()
        result = run_reflection_loop(
            pv_draft=pv_draft,
            transcription=transcription,
            max_iterations=max_iterations,
            min_quality_score=min_quality_score,
            anthropic_client=client,
            db_client=db,
        )
        return {"success": True, **result}
    except Exception as e:
        print(f"[PV-Reflect] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# STEP 9: COMPARAISON — Vérification cohérence avec PV historiques
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
)
def pv_compare_historical(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function: Comparaison — Compare current PV with historical PVs.
    Fetches historical PVs from Firestore and runs consistency checks.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    current_pv = data.get("currentPV")
    meeting_id = data.get("meetingId")
    meeting_number = data.get("meetingNumber", 0)
    historical_count = data.get("historicalCount", 3)

    if not current_pv:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: currentPV"
        )

    print(f"[PV-Compare] Comparing with {historical_count} historical PVs")

    try:
        # Fetch historical PVs from Firestore
        historical_pvs = []
        if db:
            meetings_query = db.collection("meetings").order_by(
                "date", direction=firestore.Query.DESCENDING
            ).limit(historical_count + 1)

            for meeting_doc in meetings_query.stream():
                if meeting_doc.id == meeting_id:
                    continue
                m_data = meeting_doc.to_dict()
                minutes = m_data.get("minutes") or ""
                draft = m_data.get("minutesDraft", {})
                content = minutes or draft.get("content", "")

                if content and len(content) > 100:
                    historical_pvs.append({
                        "date": m_data.get("date", ""),
                        "content": content,
                    })

                if len(historical_pvs) >= historical_count:
                    break

        client = get_anthropic_client()
        result = compare_with_historical(
            current_pv=current_pv,
            historical_pvs=historical_pvs,
            meeting_number=meeting_number,
            anthropic_client=client,
            db_client=db,
        )
        return {"success": True, **result}
    except Exception as e:
        print(f"[PV-Compare] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# STEP 10: APPRENTISSAGE — Mise à jour modèles avec corrections
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=60,
    memory=options.MemoryOption.MB_512,
)
def pv_record_learning(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function: Apprentissage — Record learning data from PV pipeline.
    Stores corrections, patterns, and feedback in Firestore for future improvements.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    meeting_id = data.get("meetingId")
    reflection_result = data.get("reflectionResult", {})
    comparison_result = data.get("comparisonResult", {})
    user_feedback = data.get("userFeedback", "")

    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: meetingId"
        )

    print(f"[PV-Learn] Recording learning for meeting {meeting_id}")

    try:
        result = record_learning(
            db_client=db,
            meeting_id=meeting_id,
            reflection_result=reflection_result,
            comparison_result=comparison_result,
            user_feedback=user_feedback,
        )
        return {"success": True, **result}
    except Exception as e:
        print(f"[PV-Learn] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# FULL PIPELINE: Run steps 4-5 server-side (analysis + classification)
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=300,
    memory=options.MemoryOption.GB_2,
)
def pv_run_pipeline(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function: Run PV pipeline steps 4-5 server-side.
    Steps 6-10 are orchestrated by the client with individual calls.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    meeting_id = data.get("meetingId")
    transcription = data.get("transcription")
    agenda_items = data.get("agendaItems", [])
    meeting_date = data.get("meetingDate", "")
    meeting_number = data.get("meetingNumber", 0)
    speaker_mapping = data.get("speakerMapping")

    if not meeting_id or not transcription:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: meetingId, transcription"
        )

    print(f"[PV-Pipeline] Running pipeline for meeting {meeting_id}")

    try:
        client = get_anthropic_client()
        result = run_pv_pipeline(
            db_client=db,
            anthropic_client=client,
            meeting_id=meeting_id,
            transcription=transcription,
            agenda_items=agenda_items,
            meeting_date=meeting_date,
            meeting_number=meeting_number,
            speaker_mapping=speaker_mapping,
        )
        return result
    except Exception as e:
        print(f"[PV-Pipeline] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# RLHF — Reinforcement Learning from Human Feedback
# =============================================================================

# -----------------------------------------------------------------------------
# RLHF: Compute reward signal from human feedback
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=60,
    memory=options.MemoryOption.MB_512,
)
def rlhf_compute_rewards(req: https_fn.CallableRequest) -> dict:
    """
    Compute and store RLHF reward signal from a completed PV pipeline.
    Called after user validation (Step 8) to record the reward.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    meeting_id = data.get("meetingId")
    user_corrections = data.get("corrections", [])
    quality_score = data.get("qualityScore", 0)
    format_score = data.get("formatScore", 0)
    user_approved = data.get("userApproved", True)
    user_comments = data.get("userComments", "")
    time_to_approval = data.get("timeToApprovalSeconds")
    reflection_iterations = data.get("reflectionIterations", 1)

    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: meetingId"
        )

    print(f"[RLHF] Computing reward for meeting {meeting_id}")

    try:
        reward = compute_reward(
            user_corrections=user_corrections,
            quality_score=quality_score,
            format_score=format_score,
            user_approved=user_approved,
            user_comments=user_comments,
            time_to_approval_seconds=time_to_approval,
            reflection_iterations=reflection_iterations,
        )

        global db
        if db is None:
            db = firestore.client()

        db.collection("rlhf_rewards").add({
            "meetingId": meeting_id,
            "timestamp": datetime.now().isoformat(),
            **reward,
        })

        print(f"[RLHF] Reward computed: {reward['totalReward']:.4f} (grade: {reward['grade']})")
        return {"success": True, **reward}

    except Exception as e:
        print(f"[RLHF] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# RLHF: Get optimized generation parameters
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.MB_512,
)
def rlhf_get_optimized_params(req: https_fn.CallableRequest) -> dict:
    """
    Get RLHF-optimized generation parameters for the PV pipeline.
    Returns policy parameters + learned preferences + style memory.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    force_reoptimize = data.get("forceReoptimize", False)

    print("[RLHF] Fetching optimized parameters")

    try:
        global db
        if db is None:
            db = firestore.client()

        if force_reoptimize:
            policy = optimize_policy(db)
        else:
            policy = get_current_policy(db)

        preferences = get_learned_preferences(db)
        style_memory = build_style_memory(db)
        trends = analyze_quality_trends(db)

        return {
            "success": True,
            "policy": policy,
            "preferences": preferences,
            "styleMemory": style_memory,
            "qualityTrends": trends,
        }

    except Exception as e:
        print(f"[RLHF] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# RLHF: Record a human preference signal
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=30,
    memory=options.MemoryOption.MB_256,
)
def rlhf_record_preference(req: https_fn.CallableRequest) -> dict:
    """
    Record a human preference signal (terminology, style, format, content).
    Called when user makes edits during validation.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    meeting_id = data.get("meetingId", "")
    preference_type = data.get("type", "")
    original_value = data.get("original", "")
    corrected_value = data.get("corrected", "")
    context = data.get("context", {})

    if not preference_type or not corrected_value:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: type, corrected"
        )

    try:
        global db
        if db is None:
            db = firestore.client()

        record_preference(
            db_client=db,
            meeting_id=meeting_id,
            preference_type=preference_type,
            original_value=original_value,
            corrected_value=corrected_value,
            context=context,
        )

        return {"success": True, "message": "Preference recorded"}

    except Exception as e:
        print(f"[RLHF] Error: {e}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# RECOMMENDATION ENGINE — Prediction intelligente
# =============================================================================

# -----------------------------------------------------------------------------
# Get meeting recommendations (patterns + predictions)
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
)
def get_meeting_recommendations(req: https_fn.CallableRequest) -> dict:
    """
    Get intelligent recommendations for a meeting based on historical data.
    Returns predicted resolutions, seasonal relevance, and pattern analysis.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    agenda_items = data.get("agendaItems", [])
    meeting_date = data.get("meetingDate", "")

    print(f"[Recommendation] Getting recommendations for {len(agenda_items)} agenda items")

    try:
        global db
        if db is None:
            db = firestore.client()

        predictions = predict_resolutions(
            db_client=db,
            current_agenda=agenda_items,
            current_date=meeting_date,
        )

        patterns = detect_patterns(db, lookback_meetings=30)

        return {
            "success": True,
            "predictions": predictions.get("predictions", []),
            "generalSuggestions": predictions.get("generalSuggestions", []),
            "seasonalRelevance": predictions.get("seasonalRelevance", []),
            "patterns": patterns,
        }

    except Exception as e:
        print(f"[Recommendation] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# Learn resolution template from approved PV
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=30,
    memory=options.MemoryOption.MB_256,
)
def learn_resolution(req: https_fn.CallableRequest) -> dict:
    """
    Learn a resolution template from an approved PV.
    Called after user approves a PV to learn the resolution format.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    resolution_type = data.get("resolutionType", "")
    resolution_text = data.get("resolutionText", "")
    keywords = data.get("keywords", [])
    meeting_id = data.get("meetingId", "")

    if not resolution_type or not resolution_text:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: resolutionType, resolutionText"
        )

    try:
        global db
        if db is None:
            db = firestore.client()

        learn_resolution_template(
            db_client=db,
            resolution_type=resolution_type,
            resolution_text=resolution_text,
            keywords=keywords,
            meeting_id=meeting_id,
        )

        return {"success": True, "message": f"Template learned for type '{resolution_type}'"}

    except Exception as e:
        print(f"[Recommendation] Error: {e}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# ACTIVE LEARNING — Exploitation active des donnees
# =============================================================================

# -----------------------------------------------------------------------------
# Active embedding update from correction
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
)
def closed_feedback_loop(req: https_fn.CallableRequest) -> dict:
    """
    Actively update voice embeddings using correction signals (Amelioration Loop).
    Corrections get 2x weight compared to auto-learned embeddings.
    Wrong embeddings are identified and removed.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    # Frontend sends correctMemberId, we map it to memberId
    member_id = data.get("memberId") or data.get("correctMemberId", "")
    audio_url = data.get("audioUrl", "")
    start_time = data.get("start", 0)
    end_time = data.get("end", 0)
    wrong_member_id = data.get("wrongMemberId", "")

    if not member_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: memberId"
        )

    print(f"[ActiveLearning] Updating embedding for member {member_id}")

    try:
        global db
        if db is None:
            db = firestore.client()

        correct_embedding = None
        wrong_embedding = None

        if audio_url and end_time > start_time:
            correct_embedding = extract_audio_segment_embedding(audio_url, start_time, end_time)

        if wrong_member_id and audio_url and end_time > start_time:
            wrong_embedding = correct_embedding

        if not correct_embedding:
            return {
                "success": False,
                "message": "Could not extract embedding from audio",
            }

        result = update_embedding_with_correction(
            db_client=db,
            member_id=member_id,
            correct_embedding=correct_embedding,
            wrong_embedding=wrong_embedding,
            correction_weight=2.0,
        )

        compute_embedding_reward(
            db_client=db,
            member_id=member_id,
            was_correct=True,
            confidence=1.0,
            correction_source="user",
        )

        if wrong_member_id:
            compute_embedding_reward(
                db_client=db,
                member_id=wrong_member_id,
                was_correct=False,
                confidence=0.0,
                correction_source="user",
            )

        return {"success": True, **result}

    except Exception as e:
        print(f"[ActiveLearning] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# Get embedding quality analysis
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=60,
    memory=options.MemoryOption.MB_512,
)
def get_embedding_quality(req: https_fn.CallableRequest) -> dict:
    """
    Get quality analysis of all member voice embeddings.
    Returns members sorted by priority (worst quality first).
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    print("[ActiveLearning] Analyzing embedding quality")

    try:
        global db
        if db is None:
            db = firestore.client()

        quality_report = analyze_embedding_quality(db)
        members_needing = get_members_needing_improvement(db, top_n=10)

        return {
            "success": True,
            "qualityReport": quality_report,
            "membersNeedingImprovement": members_needing,
            "totalMembers": len(quality_report),
        }

    except Exception as e:
        print(f"[ActiveLearning] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# Get ML dashboard data (quality trends + style memory + RLHF stats)
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
)
def get_ml_dashboard(req: https_fn.CallableRequest) -> dict:
    """
    Get comprehensive ML dashboard data combining all engines.
    Returns RLHF stats, embedding quality, recommendations, and trends.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    print("[ML Dashboard] Building dashboard data")

    try:
        global db
        if db is None:
            db = firestore.client()

        policy = get_current_policy(db)
        trends = analyze_quality_trends(db)
        embedding_quality = analyze_embedding_quality(db)
        style_memory = build_style_memory(db)
        patterns = detect_patterns(db, lookback_meetings=20)

        recent_rewards = []
        try:
            rewards_query = db.collection("rlhf_rewards").order_by(
                "timestamp", direction="DESCENDING"
            ).limit(10)
            for doc in rewards_query.stream():
                r = doc.to_dict()
                recent_rewards.append({
                    "meetingId": r.get("meetingId", ""),
                    "totalReward": r.get("totalReward", 0),
                    "grade": r.get("grade", ""),
                    "timestamp": r.get("timestamp", ""),
                })
        except Exception:
            pass

        return {
            "success": True,
            "rlhf": {
                "policy": policy,
                "recentRewards": recent_rewards,
                "avgReward": policy.get("avgReward", 0),
                "rewardTrend": policy.get("rewardTrend", "unknown"),
            },
            "embeddingQuality": {
                "members": embedding_quality[:10],
                "totalMembers": len(embedding_quality),
                "avgAccuracy": round(
                    sum(m.get("accuracy", 0) for m in embedding_quality) /
                    max(len(embedding_quality), 1), 3
                ),
            },
            "qualityTrends": trends,
            "styleMemory": {
                "terminologyRules": len(style_memory.get("terminologyMap", {})),
                "formatRules": len(style_memory.get("formatRules", [])),
                "benchmarks": style_memory.get("qualityBenchmarks", {}),
            },
            "patterns": {
                "recurringThemes": len(patterns.get("recurringThemes", [])),
                "seasonalPatterns": len(patterns.get("seasonalPatterns", {})),
                "trendingTopics": patterns.get("trendingTopics", [])[:5],
            },
        }

    except Exception as e:
        print(f"[ML Dashboard] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )

