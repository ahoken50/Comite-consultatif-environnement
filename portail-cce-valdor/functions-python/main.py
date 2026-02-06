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
from datetime import datetime, timedelta
from typing import Any
from firebase_functions import https_fn, options
from firebase_admin import initialize_app, firestore, storage
# NOTE: openai and pydub are no longer needed for Salad Cloud integration.
# They are still used by the legacy_local transcription function if needed.
# Importing them lazily inside the legacy function to reduce cold start memory.
# import openai
# from pydub import AudioSegment
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Firebase
initialize_app()

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

    # 0. CORS Handling
    if req.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return https_fn.Response('', status=204, headers=headers)

    cors_headers = {'Access-Control-Allow-Origin': '*'}

    try:
        # 1. Validation
        name = req.args.get('name')
        if not name:
            return https_fn.Response("Missing 'name' query parameter", status=400, headers=cors_headers)

        # 2. Get Audio Content (JSON URL or Multipart File)
        temp_path = None
        
        content_type = req.headers.get('content-type', '')
        
        # Determine how to get the file
        if 'application/json' in content_type:
            data = req.get_json()
            url = data.get('url')
            if not url:
                return https_fn.Response("JSON body must contain 'url'", status=400, headers=cors_headers)
            
            # Download file
            resp = requests.get(url, stream=True)
            if not resp.ok:
                return https_fn.Response(f"Failed to download audio: {resp.status_code}", status=400, headers=cors_headers)
            
            filename = secure_filename(f"{name}_enrollment.wav")
            temp_path = f"/tmp/{filename}"
            with open(temp_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)

        elif 'multipart/form-data' in content_type:
             if 'file' not in req.files:
                 return https_fn.Response("No file uploaded", status=400, headers=cors_headers)
             
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
        import time
        timestamp = int(time.time())
        bucket = storage.bucket()
        blob_path = f"speaker_enrollments/{name}/enrollment_{timestamp}.wav"
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(temp_path)
        
        # Make public so HF Endpoint can access it
        blob.make_public()
        public_url = blob.public_url
        print(f"[Enroll] Uploaded to Storage: {public_url}")

        # 4. Call Modal/HF Endpoint for embedding generation
        # Supports both HF_ENDPOINT_URL and MODAL_ENDPOINT_URL
        endpoint_url = os.environ.get("MODAL_ENDPOINT_URL") or os.environ.get("HF_ENDPOINT_URL")
        hf_token = os.environ.get("HF_TOKEN")
        
        if not endpoint_url:
            print("[Enroll] MODAL_ENDPOINT_URL or HF_ENDPOINT_URL not configured")
            return https_fn.Response("Server configuration error: AI Endpoint missing", status=500, headers=cors_headers)

        print(f"[Enroll] Calling Endpoint: {endpoint_url}")
        
        try:
            headers = {
                "Content-Type": "application/json"
            }
            # Add auth header if HF_TOKEN is present (for HF Endpoints)
            if hf_token:
                headers["Authorization"] = f"Bearer {hf_token}"
            
            # Modal uses "url", HF uses "inputs" - send both for compatibility
            payload = {"url": public_url, "inputs": public_url}
            
            response = requests.post(endpoint_url, headers=headers, json=payload, timeout=120)
            
            if not response.ok:
                print(f"[Enroll] Endpoint Error {response.status_code}: {response.text}")
                return https_fn.Response(f"AI Provider Error: {response.text}", status=502, headers=cors_headers)
                
            embedding_data = response.json()
            
            # Use the raw list as the embedding
            if isinstance(embedding_data, list):
                embedding = embedding_data
            else:
                print(f"[Enroll] Unexpected HF response format: {str(embedding_data)[:100]}")
                return https_fn.Response("Invalid AI response format", status=502, headers=cors_headers)

        except Exception as hf_error:
            print(f"[Enroll] HF Request Failed: {str(hf_error)}")
            return https_fn.Response(f"AI Request Failed: {str(hf_error)}", status=502, headers=cors_headers)

        # 5. Save to Supabase
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
             return https_fn.Response("Supabase config missing", status=500, headers=cors_headers)

        supabase: Client = create_client(supabase_url, supabase_key)
        
        data = {
            "name": name,
            "embedding": embedding,
            "created_at": datetime.now().isoformat(),
            "sample_url": public_url
        }
        
        res = supabase.table("speakers").insert(data).execute()
        
        # Cleanup
        if os.path.exists(temp_path):
            os.remove(temp_path)

        return https_fn.Response(
            json.dumps({"success": True, "name": name, "id": res.data[0]['id'] if res.data else "unknown"}),
            status=200,
            headers=cors_headers,
            content_type="application/json"
        )

    except Exception as e:
        print(f"[Enroll] Error: {str(e)}")
        # Cleanup on error
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        return https_fn.Response(f"Internal Error: {str(e)}", status=500, headers=cors_headers)
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
        "comite-cce": "https://speechmatics-webhook-bubhsf2gpa-uc.a.run.app"
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
    Fetch all enrolled speakers from Supabase with their embeddings.
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("[Speakers] Supabase config missing")
            return []
        
        supabase = create_client(supabase_url, supabase_key)
        result = supabase.table("speakers").select("id, name, embedding, role").execute()
        
        return result.data if result.data else []
        
    except Exception as e:
        print(f"[Speakers] Error fetching speakers: {e}")
        return []


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


def extract_audio_segment_embedding(audio_url: str, start_sec: float, end_sec: float) -> list:
    """
    Extract audio segment and get embedding via Modal.
    Returns embedding vector or empty list on failure.
    """
    try:
        modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
        if not modal_endpoint:
            print("[VoiceEmbed] MODAL_ENDPOINT_URL not configured")
            return []
        
        # Download audio file
        print(f"[VoiceEmbed] Downloading audio from {audio_url[:50]}...")
        audio_response = requests.get(audio_url, timeout=30)
        if not audio_response.ok:
            print(f"[VoiceEmbed] Failed to download audio: {audio_response.status_code}")
            return []
        
        # Save to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
            tmp_in.write(audio_response.content)
            input_path = tmp_in.name
        
        # Extract segment with ffmpeg
        output_path = input_path.replace(".mp3", "_segment.wav")
        duration = min(end_sec - start_sec, 30)  # Max 30 seconds
        
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start_sec),
            "-t", str(duration),
            "-ar", "16000", "-ac", "1",
            output_path
        ]
        
        subprocess.run(cmd, capture_output=True, check=True)
        
        # Read segment and send to Modal
        with open(output_path, "rb") as f:
            segment_data = f.read()
        
        # Clean up temp files
        os.unlink(input_path)
        os.unlink(output_path)
        
        # Base64 encode for Modal
        import base64
        audio_b64 = base64.b64encode(segment_data).decode()
        
        # Call Modal endpoint
        print(f"[VoiceEmbed] Sending segment to Modal ({duration:.1f}s)")
        modal_response = requests.post(
            modal_endpoint,
            json={"audio_base64": audio_b64},
            timeout=60
        )
        
        if not modal_response.ok:
            print(f"[VoiceEmbed] Modal error: {modal_response.status_code}")
            return []
        
        result = modal_response.json()
        embedding = result.get("embedding", [])
        print(f"[VoiceEmbed] Got embedding with {len(embedding)} dimensions")
        return embedding
        
    except Exception as e:
        print(f"[VoiceEmbed] Error: {e}")
        return []


def compare_embedding_with_speakers(segment_embedding: list, enrolled_speakers: list) -> dict:
    """
    Compare a segment embedding with all enrolled speaker embeddings.
    Returns dict of {name: similarity_score}
    """
    from speaker_identification import cosine_similarity
    
    scores = {}
    
    for speaker in enrolled_speakers:
        stored_embedding = speaker.get("embedding")
        if not stored_embedding or not isinstance(stored_embedding, list):
            continue
        
        if len(stored_embedding) != len(segment_embedding):
            print(f"[VoiceEmbed] Dimension mismatch: {len(segment_embedding)} vs {len(stored_embedding)}")
            continue
        
        similarity = cosine_similarity(segment_embedding, stored_embedding)
        # Convert similarity (-1 to 1) to score (0 to 1)
        scores[speaker["name"]] = (similarity + 1) / 2
    
    return scores


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
        auto_identification_strategy
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
    unique_speakers = {}  # {"S0": {"texts": [...], "start": 0, "end": 30}, ...}
    
    for segment in segments:
        speaker_label = segment.get("speaker", "S0")
        
        # Skip if not S0/S1 format
        if not re.match(r'^S\d+$', speaker_label):
            continue
        
        if speaker_label not in unique_speakers:
            unique_speakers[speaker_label] = {
                "texts": [],
                "start": segment.get("start", 0),
                "end": segment.get("start", 0) + 30
            }
        unique_speakers[speaker_label]["texts"].append(segment.get("text", ""))
    
    print(f"[Identify] Found {len(unique_speakers)} unique speakers to identify")
    
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
        
        # Try voice embedding if available (50% weight)
        if voice_available:
            print(f"[Identify] Getting voice embedding for {speaker_label} ({data['start']:.0f}s-{data['end']:.0f}s)")
            segment_embedding = extract_audio_segment_embedding(audio_url, data["start"], data["end"])
            if segment_embedding:
                voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                print(f"[Identify] Voice scores for {speaker_label}: {voice_scores}")
        
        # Fast pattern strategies
        linguistic_scores = linguistic_pattern_strategy(combined_text, enrolled_speakers)
        mention_scores = name_mention_strategy(combined_text, None, known_member_names)
        auto_id_scores = auto_identification_strategy(combined_text, known_member_names)
        
        # Fuse with proper weighting
        best_score = 0
        best_name = None
        
        for name in known_member_names:
            if voice_scores:
                # Full weighting with voice
                score = (
                    voice_scores.get(name, 0) * 0.50 +
                    linguistic_scores.get(name, 0) * 0.10 +
                    mention_scores.get(name, 0) * 0.10 +
                    auto_id_scores.get(name, 0) * 0.05
                )
            else:
                # Without voice, rebalance
                score = (
                    linguistic_scores.get(name, 0) * 0.4 +
                    mention_scores.get(name, 0) * 0.3 +
                    auto_id_scores.get(name, 0) * 0.3
                )
            
            if score > best_score:
                best_score = score
                best_name = name
        
        threshold = 0.2 if voice_scores else 0.3
        if best_score >= threshold and best_name:
            speaker_mapping[speaker_label] = best_name
            print(f"[Identify] {speaker_label} -> {best_name} (score: {best_score:.2f}, voice: {bool(voice_scores)})")
        else:
            unidentified.append((speaker_label, combined_text))
    
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
    timeout_sec=120,
    memory=options.MemoryOption.GB_1,
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
                
                for segment in segments:
                    speaker_label = segment.get("speaker", "S0")
                    
                    if speaker_label in speaker_mapping:
                        continue
                    
                    transcript_segment = segment.get("text", "")
                    
                    # Run identification strategies (no voice embedding for now)
                    context_scores = contextual_ai_strategy(
                        transcript_segment, meeting_context, known_member_names
                    )
                    linguistic_scores = linguistic_pattern_strategy(
                        transcript_segment, enrolled_speakers
                    )
                    mention_scores = name_mention_strategy(
                        transcript_segment, None, known_member_names
                    )
                    auto_id_scores = auto_identification_strategy(
                        transcript_segment, known_member_names
                    )
                    
                    # Fuse scores
                    identified_name, confidence = fuse_scores(
                        {},  # No voice embedding for now
                        context_scores,
                        linguistic_scores,
                        mention_scores,
                        auto_id_scores
                    )
                    
                    if identified_name:
                        speaker_mapping[speaker_label] = identified_name
                        print(f"[Speaker ID] {speaker_label} -> {identified_name} ({confidence:.2f})")
                
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
        
        return https_fn.Response(
            json.dumps({"success": True, "meetingId": meeting_id, "chars": len(full_transcription), "arrayUpdated": updated_array}),
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

@https_fn.on_call(
    timeout_sec=180,  # 3 minutes
    memory=options.MemoryOption.GB_1
)
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
        
        # Find transcription and audio URL to process
        transcription_text = None
        audio_url = None
        audio_recordings = meeting_data.get("audioRecordings", [])
        target_index = -1
        
        if storage_path and audio_recordings:
            # Find specific recording
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    transcription_text = rec.get("transcription", "")
                    audio_url = rec.get("downloadURL") or rec.get("url")
                    target_index = i
                    break
        elif audio_recordings:
            # Use first recording with transcription
            for i, rec in enumerate(audio_recordings):
                if rec.get("transcription"):
                    transcription_text = rec["transcription"]
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
            if re.match(r'^S\d+$', label) and label not in speaker_timestamps:
                # Use first occurrence (typically longest/clearest)
                speaker_timestamps[label] = {
                    "start": segment["start"],
                    "end": segment["start"] + 30  # 30 seconds max
                }
        
        # Run identification with voice embedding (if audio_url available)
        speaker_mapping = {}
        unidentified = []
        modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
        voice_available = bool(audio_url and modal_endpoint)
        
        print(f"[Manual Speaker ID] Audio URL: {audio_url[:100] if audio_url else 'NOT FOUND'}")
        print(f"[Manual Speaker ID] MODAL_ENDPOINT_URL: {'SET' if modal_endpoint else 'NOT SET'}")
        print(f"[Manual Speaker ID] Voice embedding available: {voice_available}")
        
        for speaker_label, texts in unique_speakers.items():
            combined_text = " ".join(texts[:3])  # Use first 3 segments max
            
            # Initialize scores dict
            voice_scores = {}
            
            # Try voice embedding if available (50% weight)
            if voice_available and speaker_label in speaker_timestamps:
                ts = speaker_timestamps[speaker_label]
                print(f"[Manual Speaker ID] Getting voice embedding for {speaker_label} ({ts['start']:.0f}s-{ts['end']:.0f}s)")
                segment_embedding = extract_audio_segment_embedding(audio_url, ts["start"], ts["end"])
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
            
            # Fuse with proper weighting
            best_score = 0
            best_name = None
            
            for name in known_member_names:
                if voice_scores:
                    # Full weighting with voice (5 strategies)
                    score = (
                        voice_scores.get(name, 0) * 0.50 +
                        linguistic_scores.get(name, 0) * 0.10 +
                        mention_scores.get(name, 0) * 0.10 +
                        auto_id_scores.get(name, 0) * 0.05 +
                        0.25 * 0  # Reserve for GROQ later if needed
                    )
                else:
                    # Without voice, rebalance weights
                    score = (
                        linguistic_scores.get(name, 0) * 0.4 +
                        mention_scores.get(name, 0) * 0.3 +
                        auto_id_scores.get(name, 0) * 0.3
                    )
                
                if score > best_score:
                    best_score = score
                    best_name = name
            
            threshold = 0.15 if voice_scores else 0.1  # Lowered threshold - fast strategies often return 0 - FIX DEPLOY
            if best_score >= threshold and best_name:
                speaker_mapping[speaker_label] = best_name
                print(f"[Manual Speaker ID] {speaker_label} -> {best_name} (score: {best_score:.2f}, voice: {bool(voice_scores)})")
            else:
                unidentified.append((speaker_label, combined_text))
        
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
        
        return {
            "success": True,
            "identifiedCount": len(speaker_mapping),
            "mapping": speaker_mapping
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
