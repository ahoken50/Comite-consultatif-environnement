import os
import time
import json
import subprocess
import tempfile
import requests
from core.config import get_openai_client, MAX_WHISPER_SIZE_MB, SEGMENT_DURATION_MINUTES, SUPPORTED_FORMATS

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
    parts.append("Transcription d'une réunion du Comité consultatif en environnement de Val-d'Or.")
    
    # Add attendee names if available
    if attendee_names:
        names = ", ".join([name for name in attendee_names if name])
        if names:
            parts.append(f"Participants: {names}.")
    
    # Add agenda topics if available
    if agenda_items:
        topics = ", ".join([item for item in agenda_items if item])
        if topics:
            parts.append(f"Sujets à l'ordre du jour: {topics}.")
    
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


def build_custom_whisper_prompt(attendee_names: list = None, agenda_items: list = None) -> str:

    """
    Build a context prompt to help Whisper with proper nouns and terminology.
    Using a narrative style to set the context and disable auto-completion behavior.
    """
    # Base narrative prompt (Zero-shot styling)
    base_prompt = (
        "Enregistrement audio en français québécois. "
        "Il sâ€™agit dâ€™une réunion officielle dâ€™un comité consultatif en environnement. "
        "La rencontre se déroule dans une salle de conférence avec un micro central. "
        "Les intervenants parlent à tour de rôle, parfois à voix basse ou à distance du micro. "
        "Le langage est professionnel, technique et institutionnel. "
        "Le vocabulaire peut inclure : environnement, développement durable, politique environnementale, "
        "plan dâ€™action, adaptation aux changements climatiques, gestion des eaux pluviales, "
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


# =============================================================================
# SPEECHMATICS INTEGRATION (Primary Transcription Provider)
# =============================================================================

SPEECHMATICS_API_BASE = os.environ.get("SPEECHMATICS_API_BASE", "https://us2.asr.api.speechmatics.com/v2")  # US region

# Custom dictionary for CCE meetings (Speechmatics format)
# Each entry can have optional "sounds_like" for pronunciation hints
# Limited to 1000 terms per Speechmatics API
CCE_CUSTOM_VOCAB = [
    # =========================================================================
    # CCE MEMBER NAMES
    # =========================================================================
    {"content": "Patricia Boutin"},
    {"content": "Sébastien Brodeur-Girard", "sounds_like": ["Sébastien Brodeur Girard"]},
    {"content": "Jacinthe Pothier", "sounds_like": ["Jacinthe Potiè"]},
    {"content": "Donald Ratté", "sounds_like": ["Donald Raté"]},
    {"content": "Michaël Ross", "sounds_like": ["Michael Ross"]},
    {"content": "Benjamin Turcotte"},
    {"content": "Marguerite Larochelle"},
    {"content": "Céline Brindamour", "sounds_like": ["Céline Brind'amour"]},
    {"content": "Jocelyn Hébert", "sounds_like": ["Jocelyn Ã‰bert"]},
    
    # =========================================================================
    # ROLES & GOVERNANCE
    # =========================================================================
    {"content": "CCE", "sounds_like": ["C.C.E.", "Cécé"]},
    {"content": "Président"},
    {"content": "Présidente"},
    {"content": "Vice-président"},
    {"content": "Vice-présidente"},
    {"content": "Secrétaire"},
    {"content": "Conseiller"},
    {"content": "Conseillère"},
    {"content": "Mairesse"},
    {"content": "Maire"},
    {"content": "Directeur général"},
    {"content": "Greffier"},
    {"content": "Coordonnateur"},
    {"content": "Coordonnatrice"},
    
    # =========================================================================
    # ORGANIZATIONS & LOCATIONS
    # =========================================================================
    {"content": "MRCVO", "sounds_like": ["M.R.C.V.O."]},
    {"content": "MRC Vallée-de-l'Or"},
    {"content": "SESAT", "sounds_like": ["S.E.S.A.T."]},
    {"content": "OBVAJ", "sounds_like": ["O.B.V.A.J."]},
    {"content": "Val-d'Or", "sounds_like": ["Valdor", "Val d'Or"]},
    {"content": "Abitibi"},
    {"content": "Abitibi-Témiscamingue"},
    {"content": "Rouyn-Noranda"},
    {"content": "Ministère de l'Environnement"},
    {"content": "MELCCFP", "sounds_like": ["M.E.L.C.C.F.P."]},
    {"content": "MAMH", "sounds_like": ["M.A.M.H."]},
    {"content": "MTQ", "sounds_like": ["M.T.Q."]},
    
    # =========================================================================
    # MEETING PROCEDURES
    # =========================================================================
    {"content": "Procès-verbal", "sounds_like": ["PV"]},
    {"content": "Ordre du jour"},
    {"content": "Résolution"},
    {"content": "Adoption"},
    {"content": "Approbation"},
    {"content": "Amendement"},
    {"content": "Proposition"},
    {"content": "Seconde"},
    {"content": "Vote"},
    {"content": "Unanimité"},
    {"content": "Majorité"},
    {"content": "Quorum"},
    {"content": "Levée de la séance"},
    {"content": "Point d'information"},
    {"content": "Suivi"},
    {"content": "Avis de motion"},
    {"content": "Huis clos"},
    
    # =========================================================================
    # ENVIRONMENTAL TERMS
    # =========================================================================
    # Climate
    {"content": "Changements climatiques"},
    {"content": "Réchauffement climatique"},
    {"content": "Gaz à effet de serre"},
    {"content": "GES", "sounds_like": ["G.E.S."]},
    {"content": "Ã‰missions de carbone"},
    {"content": "Bilan carbone"},
    {"content": "Carboneutralité"},
    {"content": "ÃŽlot de chaleur"},
    {"content": "ÃŽlots de fraîcheur"},
    {"content": "Adaptation climatique"},
    {"content": "Résilience climatique"},
    
    # Biodiversity
    {"content": "Biodiversité"},
    {"content": "Espèces menacées"},
    {"content": "Espèces vulnérables"},
    {"content": "Habitat faunique"},
    {"content": "Corridor écologique"},
    {"content": "Milieu naturel"},
    {"content": "Ã‰cosystème"},
    {"content": "Faune"},
    {"content": "Flore"},
    {"content": "Espèces envahissantes"},
    {"content": "Agrile du frêne"},
    {"content": "Herbe à poux"},
    {"content": "Berce du Caucase"},
    
    # Water
    {"content": "Gestion des eaux pluviales"},
    {"content": "Eaux de ruissellement"},
    {"content": "Bassin de rétention"},
    {"content": "Bassin versant"},
    {"content": "Noue végétalisée"},
    {"content": "Nappe phréatique"},
    {"content": "Aquifère"},
    {"content": "Eau potable"},
    {"content": "Eaux usées"},
    {"content": "Station d'épuration"},
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
    {"content": "Matières résiduelles"},
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
    {"content": "Réduction à la source"},
    {"content": "Valorisation"},
    {"content": "3RV", "sounds_like": ["trois R V"]},
    
    # Energy
    {"content": "Efficacité énergétique"},
    {"content": "Ã‰nergies renouvelables"},
    {"content": "Ã‰nergie solaire"},
    {"content": "Ã‰nergie éolienne"},
    {"content": "Hydro-Québec"},
    {"content": "Ã‰lectrification"},
    {"content": "Bornes de recharge"},
    {"content": "Véhicules électriques"},
    
    # Pollution & Contamination
    {"content": "Contamination"},
    {"content": "Sol contaminé"},
    {"content": "Terrain contaminé"},
    {"content": "Déversement"},
    {"content": "Pollution atmosphérique"},
    {"content": "Qualité de l'air"},
    {"content": "Poussière"},
    {"content": "Bruit"},
    {"content": "Nuisance"},
    
    # =========================================================================
    # URBAN PLANNING TERMS
    # =========================================================================
    {"content": "Urbanisme"},
    {"content": "Aménagement du territoire"},
    {"content": "Plan d'urbanisme"},
    {"content": "Schéma d'aménagement"},
    {"content": "Zonage"},
    {"content": "Règlement de zonage"},
    {"content": "Dérogation mineure"},
    {"content": "PIIA", "sounds_like": ["P.I.I.A."]},
    {"content": "PAE", "sounds_like": ["P.A.E."]},
    {"content": "PPU", "sounds_like": ["P.P.U."]},
    {"content": "Permis de construction"},
    {"content": "Permis de lotissement"},
    {"content": "Certificat d'autorisation"},
    {"content": "Consultation publique"},
    {"content": "Assemblée publique"},
    {"content": "Référendum"},
    {"content": "Registre"},
    {"content": "Usage conditionnel"},
    {"content": "Usage dérogatoire"},
    {"content": "Coefficient d'emprise"},
    {"content": "Densification"},
    {"content": "Ã‰talement urbain"},
    
    # Green Infrastructure
    {"content": "Verdissement"},
    {"content": "Canopée"},
    {"content": "Indice de canopée"},
    {"content": "Plantation d'arbres"},
    {"content": "Forêt urbaine"},
    {"content": "Parc"},
    {"content": "Espace vert"},
    {"content": "Toit vert"},
    {"content": "Mur végétal"},
    {"content": "Infrastructure verte"},
    {"content": "Stationnement perméable"},
    {"content": "Pavé perméable"},
    
    # Transportation
    {"content": "Transport actif"},
    {"content": "Piste cyclable"},
    {"content": "Trottoir"},
    {"content": "Transport en commun"},
    {"content": "Covoiturage"},
    {"content": "Autopartage"},
    {"content": "Mobilité durable"},
    
    # =========================================================================
    # LEGAL & REGULATORY
    # =========================================================================
    {"content": "Règlement municipal"},
    {"content": "Loi sur la qualité de l'environnement"},
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

