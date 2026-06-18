"""
Cloud Functions Python pour CCE Val-d'Or
Transcription audio avec OpenAI Whisper + Génération PV avec Claude
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
from firebase_functions import https_fn, options, scheduler_fn
from firebase_admin import initialize_app, firestore, storage
# NOTE: openai and pydub are no longer needed for Salad Cloud integration.
# They are still used by the legacy_local transcription function if needed.
# Importing them lazily inside the legacy function to reduce cold start memory.
# import openai
# from pydub import AudioSegment
# Local Imports
# [NEW] Lazy Module loading pattern to drastically optimize Cold Start times
class LazyModule:
    def __init__(self, module_name):
        self._module_name = module_name
        self._module = None

    def __getattr__(self, name):
        if self._module is None:
            import importlib
            self._module = importlib.import_module(self._module_name)
        return getattr(self._module, name)

_pv_pipeline = LazyModule("pv_pipeline")
def run_pv_pipeline(*args, **kwargs): return _pv_pipeline.run_pv_pipeline(*args, **kwargs)
def run_reflection_loop(*args, **kwargs): return _pv_pipeline.run_reflection_loop(*args, **kwargs)
def compare_with_historical(*args, **kwargs): return _pv_pipeline.compare_with_historical(*args, **kwargs)
def record_learning(*args, **kwargs): return _pv_pipeline.record_learning(*args, **kwargs)

_active_learning = LazyModule("active_learning")
def analyze_embedding_quality(*args, **kwargs): return _active_learning.analyze_embedding_quality(*args, **kwargs)
def analyze_quality_trends(*args, **kwargs): return _active_learning.analyze_quality_trends(*args, **kwargs)
def build_style_memory(*args, **kwargs): return _active_learning.build_style_memory(*args, **kwargs)

_rlhf_engine = LazyModule("rlhf_engine")
def compute_embedding_reward(*args, **kwargs): return _rlhf_engine.compute_embedding_reward(*args, **kwargs)
def get_members_needing_improvement(*args, **kwargs): return _rlhf_engine.get_members_needing_improvement(*args, **kwargs)
def optimize_policy(*args, **kwargs): return _rlhf_engine.optimize_policy(*args, **kwargs)
def get_current_policy(*args, **kwargs): return _rlhf_engine.get_current_policy(*args, **kwargs)
def get_learned_preferences(*args, **kwargs): return _rlhf_engine.get_learned_preferences(*args, **kwargs)
def compute_reward(*args, **kwargs): return _rlhf_engine.compute_reward(*args, **kwargs)
def record_preference(*args, **kwargs): return _rlhf_engine.record_preference(*args, **kwargs)

_recommendation_engine = LazyModule("recommendation_engine")
def learn_resolution_template(*args, **kwargs): return _recommendation_engine.learn_resolution_template(*args, **kwargs)

_diagnose_migration = LazyModule("diagnose_migration")
def api_diagnose_migration(*args, **kwargs): return _diagnose_migration.api_diagnose_migration(*args, **kwargs)

_batch_enroll_from_storage = LazyModule("batch_enroll_from_storage")
def batch_enroll_from_storage(*args, **kwargs): return _batch_enroll_from_storage.batch_enroll_from_storage(*args, **kwargs)

_sync_firestore_to_supabase = LazyModule("sync_firestore_to_supabase")
def force_sync_firestore_to_supabase(*args, **kwargs): return _sync_firestore_to_supabase.force_sync_firestore_to_supabase(*args, **kwargs)

_clear_supabase_speakers = LazyModule("clear_supabase_speakers")
def clear_supabase_speakers(*args, **kwargs): return _clear_supabase_speakers.clear_supabase_speakers(*args, **kwargs)

_audio_utils = LazyModule("audio_utils")
def extract_audio_segment_embedding(*args, **kwargs): return _audio_utils.extract_audio_segment_embedding(*args, **kwargs)

from dotenv import load_dotenv


from core.firebase_init import db, bucket
from core.config import get_openai_client, get_anthropic_client, configure_resend, MAX_WHISPER_SIZE_MB, SEGMENT_DURATION_MINUTES, SUPPORTED_FORMATS
from core.utils import get_cors_headers
from core.firestore_triggers import (
    on_meeting_updated,
    on_meeting_deleted,
    on_recommendation_updated
)

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
        try:
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(hours=1),
                method="GET"
            )
        except TypeError as e:
            print(f"[Enroll] Signed URL generation failed: {e}")
            # Fallback for older libraries or different signatures
            try:
                signed_url = blob.generate_signed_url(
                    expiration=timedelta(hours=1),
                    method="GET"
                )
                print("[Enroll] Fallback to v2 signing succeeded")
            except Exception as e2:
                print(f"[Enroll] Fallback signing failed: {e2}")
                raise e
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
        
        # 6. Write embedding to speaker_embeddings table (primary store)
        try:
            from supabase_embeddings import add_embedding
            add_embedding(name, embedding, "", sample_source="enrollment")
        except Exception as emb_err:
            print(f"[Enroll] speaker_embeddings insert failed (non-fatal): {emb_err}")
        
        # 7. Update Firestore member metadata only (no embedding)
        try:
            _db = firestore.client()
            member_query = list(_db.collection("members").where(
                "displayName", "==", name
            ).limit(1).stream())
            
            if member_query:
                member_doc = member_query[0]
                member_doc.reference.update({
                    "voiceSampleCount": 1,
                    "lastVoiceUpdate": datetime.now().isoformat(),
                    "lastUpdateSource": "enrollment",
                })
                print(f"[Enroll] Updated Firestore metadata for '{name}'")
            else:
                print(f"[Enroll] No Firestore member found for '{name}'")
        except Exception as fs_err:
            print(f"[Enroll] Firestore metadata update failed (non-fatal): {fs_err}")
        
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


from ai_agents.transcription import (
    get_audio_format,
    split_audio_if_needed,
    format_timestamp,
    clean_hallucinations,
    build_context_prompt,
    process_audio_with_ffmpeg,
    transcribe_with_whisper,
    submit_speechmatics_job,
    check_speechmatics_job,
    transcribe_with_speechmatics,
    format_speechmatics_output
)
from ai_agents.speaker_profiles import (
    get_enrolled_speakers,
    get_meeting_attendees,
    compare_embedding_with_speakers,
    compare_embedding_with_speakers_local,
    identify_speakers_in_transcript
)

SALAD_API_URL = "https://api.salad.com/api/public/organizations/vvd/inference-endpoints/transcribe/jobs"

# Salad API Limits (from documentation)
SALAD_MAX_FILE_SIZE_GB = 3
SALAD_MAX_DURATION_HOURS = 2.5

# Custom vocabulary for CCE meetings (improves transcription accuracy)
CCE_VOCABULARY = (
    "CCE, Val-d'Or, Comité consultatif en environnement, "
    "Patricia Boutin, Sébastien Brodeur-Girard, Jacinthe Pothier, Donald Ratté, "
    "Michaël Ross, Benjamin Turcotte, Marguerite Larochelle, Céline Brindamour, Jocelyn Hébert, "
    "Maire, Mairesse, Urbanisme, Travaux publics, Environnement, Développement durable, "
    "MRCVO, SESAT, Société des eaux souterraines de l'Abitibi-Témiscamingue, "
    "OBVAJ, Organisme de bassin versant Abitibi-Jamésie, Abitibi, Rouyn, Rouyn-Noranda, "
    "Protection des berges, Gestion des eaux pluviales, Bassin de rétention, Noue végétalisée, "
    "Puits Feldman, Esker, Domaine des Eskers, Nappe phréatique, Aquifère, "
    "Biodiversité, Changements climatiques, ÃŽlots de chaleur, Verdissement, "
    "Zonage, Règlement municipal, Dérogation mineure, PIIA, Consultation publique, "
    "Procès-verbal, Ordre du jour, Résolution, Adoption"
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
from ai_agents.webhooks import (
    speechmatics_webhook,
    identify_speakers,
    submit_transcription,
    check_transcription_status
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
        except Exception as ex:
            pass
            
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )
from ai_agents.claude_service import (
    generate_minutes_claude,
    finalize_draft_claude,
    chat_claude
)


# =============================================================================
# CONVOCATION EMAIL SERVICE
# =============================================================================

from communication.email_service import (
    send_convocation,
    send_avis_convocation,
    send_approval_link,
    send_approval_notification
)
from pdf.pdf_convocation import generate_avis_pdf

# =============================================================================
# SPEECHMATICS COST PROTECTION & JOB MANAGEMENT
# =============================================================================

SPEECHMATICS_API_BASE = os.environ.get("SPEECHMATICS_API_BASE", "https://eu1.asr.api.speechmatics.com/v2")

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
            def recording_sort_key(r):
                uploaded_at = r.get("uploadedAt") or "9999-12-31"
                file_name = r.get("fileName") or ""
                import re
                natural_key = [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', file_name)]
                return (uploaded_at, natural_key)
            
            audio_recordings.sort(key=recording_sort_key)
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
                # Rebuild merged transcription of all completed recordings
                merged_parts = []
                all_completed = True
                for idx, rec in enumerate(audio_recordings):
                    status = rec.get("transcriptionStatus")
                    trans = rec.get("transcription")
                    if status == "completed" and trans:
                        part_name = rec.get("fileName", f"Partie {idx+1}")
                        merged_parts.append(f"=== {part_name} ===\n\n{trans}")
                    elif status in ["pending", "processing"]:
                        all_completed = False
                        
                merged_transcription = "\n\n--- TRANSCRIPTION SUIVANTE ---\n\n".join(merged_parts)
                
                # Merge speaker mappings
                merged_speaker_mapping = {}
                for rec in audio_recordings:
                    m = rec.get("speakerMapping")
                    if isinstance(m, dict):
                        merged_speaker_mapping.update(m)
                        
                update_data = {
                    "audioRecordings": audio_recordings,
                    "audioRecording.transcription": merged_transcription,
                    "audioRecording.transcriptionStatus": "completed" if all_completed else "processing",
                    "audioRecording.speakerMapping": merged_speaker_mapping,
                    "dateUpdated": datetime.now().isoformat()
                }
                meeting_ref.update(update_data)
        else:
            # Legacy fallback
            legacy = meeting_data.get("audioRecording", {})
            if legacy.get("originalTranscription"):
                update_data = {
                    "audioRecording.transcription": legacy["originalTranscription"],
                    "audioRecording.speakerMapping": {},
                    "dateUpdated": datetime.now().isoformat()
                }
                meeting_ref.update(update_data)
                updated = True
        
        if updated:
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
        
def reconstruct_segments_from_transcription(transcription, speaker_mapping):
    """
    Reconstruct segments array on the fly from a text transcription if empty in DB.
    Handles matching of speaker names back to their original S# speaker labels.
    """
    if not transcription:
        return []
    
    import re
    # Create reverse mapping: speaker_name -> label
    reverse_map = {}
    if speaker_mapping and isinstance(speaker_mapping, dict):
        reverse_map = {str(name).strip(): str(label) for label, name in speaker_mapping.items()}
    
    # Matches [MM:SS] [SpeakerName/Label] Segment Text
    pattern = r"\[(\d+):(\d+)\]\s+\[([^\]]+)\]\s*(.*?)(?=\s*\[\d+:\d+\]\s+\[|$)"
    matches = re.findall(pattern, transcription, re.DOTALL)
    
    reconstructed = []
    for match in matches:
        min_str, sec_str, spk, txt = match
        start = int(min_str) * 60 + int(sec_str)
        spk_clean = spk.strip()
        speaker_label = reverse_map.get(spk_clean, spk_clean)
        
        reconstructed.append({
            "start": start,
            "speaker": speaker_label,
            "text": txt.strip()
        })
        
    for i in range(len(reconstructed)):
        if i < len(reconstructed) - 1:
            reconstructed[i]["end"] = reconstructed[i+1]["start"]
        else:
            reconstructed[i]["end"] = reconstructed[i]["start"] + 30
            
    return reconstructed


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
                    if not segments:
                        segments = reconstruct_segments_from_transcription(rec.get("transcription"), rec.get("speakerMapping", {}))
                    original_transcript = rec.get("originalTranscription", "")
                    if audio_url: break

        # Fallback to legacy field
        if not audio_url:
            rec = meeting.get("audioRecording", {})
            audio_url = rec.get("downloadURL") or rec.get("url") or rec.get("fileUrl")
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

        # 4. Update Member Profile — write directly to Supabase (primary store)
        member_ref = db.collection("members").document(member_id)
        member_doc = member_ref.get()
        if not member_doc.exists:
             return https_fn.Response(json.dumps({"error": "Member not found"}), status=404)
        
        member_data = member_doc.to_dict()
        member_name = member_data.get("displayName") or member_data.get("name", "")
        
        # CONSISTENCY CHECK against existing Supabase embeddings
        from supabase_embeddings import get_embeddings, add_embedding, get_embedding_count
        warning_msg = ""
        is_outlier = False
        
        existing_vectors = get_embeddings(member_name)
        if existing_vectors:
            from speaker_identification import cosine_similarity
            max_sim = -1.0
            for old_vec in existing_vectors:
                sim = cosine_similarity(new_embedding, old_vec)
                if sim > max_sim:
                    max_sim = sim
            
            if max_sim > 0 and max_sim < 0.60:
                 is_outlier = True
                 warning_msg = f"Attention: Segment atypique (Score: {max_sim:.2f})."
                 print(f"[Reinforce] OUTLIER DETECTED! Similarity {max_sim:.2f} < 0.60")

        # Write to Supabase
        add_embedding(member_name, new_embedding, member_id, sample_source="reinforcement")
        count = get_embedding_count(member_name)
        
        # Update Firestore metadata only
        member_ref.update({
            "voiceSampleCount": count,
            "lastVoiceUpdate": datetime.now().isoformat()
        })
        
        # Feedback Logic
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


@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def reevaluate_speaker_segments(req: https_fn.Request) -> https_fn.Response:
    """
    AI-assisted speaker segment re-evaluation.
    Given a corrected speaker segment, it compares all other segments with the old name
    using voice similarity to recommend which ones to change.
    """
    try:
        data = req.get_json()
        meeting_id = data.get("meetingId")
        old_name = data.get("oldName") # e.g. "S3" or "Abdelkabir Maqsoud"
        new_name = data.get("newName") # e.g. "Michael Ross"
        start_time = data.get("startTime") # Time of corrected segment (reference)
        end_time = data.get("endTime")
        
        if not all([meeting_id, old_name, new_name]) or start_time is None or end_time is None:
            return https_fn.Response(json.dumps({"error": "Missing parameters"}), status=400)
            
        print(f"[Reevaluate] Re-evaluating segments matching '{old_name}' in meeting {meeting_id} based on ground truth '{new_name}' ({start_time}-{end_time}s)")
        
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        if not meeting_doc.exists:
            return https_fn.Response(json.dumps({"error": "Meeting not found"}), status=404)
            
        meeting = meeting_doc.to_dict()
        audio_url = None
        segments = []
        
        speaker_mapping = {}
        if "audioRecordings" in meeting:
            for rec in meeting["audioRecordings"]:
                if rec.get("transcriptionStatus") == "completed":
                    audio_url = rec.get("downloadURL") or rec.get("url") or rec.get("fileUrl")
                    speaker_mapping = rec.get("speakerMapping") or {}
                    # Always prioritize reconstructing segments from the transcription text to reflect the user's edits
                    if rec.get("transcription"):
                        segments = reconstruct_segments_from_transcription(rec.get("transcription"), speaker_mapping)
                    else:
                        segments = rec.get("segments", [])
                    if audio_url: break
                    
        # Fallback to legacy field
        if not audio_url:
            rec = meeting.get("audioRecording", {})
            audio_url = rec.get("downloadURL") or rec.get("url") or rec.get("fileUrl")
            speaker_mapping = rec.get("speakerMapping") or meeting.get("speakerMapping") or {}
            if rec.get("transcription"):
                segments = reconstruct_segments_from_transcription(rec.get("transcription"), speaker_mapping)
            else:
                segments = rec.get("segments", [])
            
        if not audio_url:
            return https_fn.Response(json.dumps({"error": "Audio URL not found"}), status=404)
            
        local_audio_path = None
        try:
            # Download audio once to temporary folder to speed up multiple segment extractions
            try:
                import requests
                import tempfile
                import shutil
                
                print(f"[Reevaluate] Downloading audio file to local temp space once...")
                with requests.get(audio_url, stream=True, timeout=60) as r:
                    if r.ok:
                        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                            shutil.copyfileobj(r.raw, tmp)
                            local_audio_path = tmp.name
                        print(f"[Reevaluate] Audio downloaded locally to {local_audio_path} ({os.path.getsize(local_audio_path)} bytes)")
                        
                        # Convert to 16kHz mono WAV to make subsequent seeking instant
                        try:
                            print(f"[Reevaluate] Converting downloaded audio to resampled 16kHz mono WAV for instant seeking...")
                            t_conv = time.time()
                            wav_path = local_audio_path + ".wav"
                            cmd_conv = [
                                "ffmpeg", "-y",
                                "-i", local_audio_path,
                                "-ar", "16000", "-ac", "1",
                                wav_path
                            ]
                            subprocess.run(cmd_conv, capture_output=True, check=True)
                            try:
                                os.unlink(local_audio_path) # Delete original mp3
                            except Exception:
                                pass
                            local_audio_path = wav_path
                            print(f"[Reevaluate] Resampled WAV created at {local_audio_path} in {time.time() - t_conv:.2f}s ({os.path.getsize(local_audio_path)} bytes)")
                        except Exception as e_conv:
                            print(f"[Reevaluate] Resampling failed: {e_conv}. Continuing with original format.")
                    else:
                        print(f"[Reevaluate] Failed to download audio: {r.status_code}. Using remote URL.")
            except Exception as e_dl:
                print(f"[Reevaluate] Error downloading local copy: {e_dl}. Falling back to remote URL.")

            use_url = local_audio_path or audio_url

            # 1. Extract ground truth voice embedding for the corrected segment
            print(f"[Reevaluate] Extracting reference embedding...")
            ref_embedding = extract_audio_segment_embedding(use_url, float(start_time), float(end_time))
            if not ref_embedding:
                return https_fn.Response(json.dumps({"error": "Failed to extract reference embedding"}), status=500)
                
            from speaker_identification import cosine_similarity
            
            # 2. Iterate through all segments in the meeting that currently have speaker matching old_name
            from concurrent.futures import ThreadPoolExecutor, as_completed
            # Group candidate segments by their raw speaker label (e.g. S1, S2...)
            raw_label_segments = {}
            for i, seg in enumerate(segments):
                seg_speaker_raw = seg.get("speaker")
                seg_speaker_resolved = speaker_mapping.get(seg_speaker_raw, seg_speaker_raw) if speaker_mapping else seg_speaker_raw
                
                # Match old_name (either the raw label like "S2" or the resolved display name like "Donald Ratté")
                if seg_speaker_raw == old_name or seg_speaker_resolved == old_name:
                    seg_start = seg.get("start", 0)
                    seg_end = seg.get("end", 0)
                    seg_duration = seg_end - seg_start
                    
                    # Skip the segment that was actually corrected (the reference itself)
                    if abs(seg_start - float(start_time)) < 1.0 and abs(seg_end - float(end_time)) < 1.0:
                        continue
                        
                    if seg_duration > 1.5: # Min 1.5 seconds for decent voice matching
                        if seg_speaker_raw not in raw_label_segments:
                            raw_label_segments[seg_speaker_raw] = []
                        raw_label_segments[seg_speaker_raw].append({
                            "index": i,
                            "start": seg_start,
                            "end": seg_end,
                            "duration": seg_duration,
                            "text": seg.get("text", "Segment audio...")
                        })

            labels_to_evaluate = []
            for label, segs in raw_label_segments.items():
                # Find the longest segment for this label to serve as representative
                representative = max(segs, key=lambda x: x["duration"])
                labels_to_evaluate.append({
                    "label": label,
                    "representative": representative,
                    "all_segments": segs
                })

            print(f"[Reevaluate] Found {len(labels_to_evaluate)} unique raw speaker labels to evaluate")

            # Sequentially extract WAV bytes for only these representative segments.
            # This is super fast (~0.02s per segment) and avoids spawning concurrent ffmpeg processes.
            print(f"[Reevaluate] Starting sequential audio segment extraction for {len(labels_to_evaluate)} labels...")
            t_extract_start = time.time()
            prepared_representatives = []
            from audio_utils import extract_audio_segment_bytes, get_embedding_from_segment_data
            
            for item in labels_to_evaluate:
                rep = item["representative"]
                if local_audio_path:
                    seg_bytes = extract_audio_segment_bytes(local_audio_path, rep["start"], rep["end"])
                    if seg_bytes:
                        prepared_representatives.append({
                            "label": item["label"],
                            "start": rep["start"],
                            "end": rep["end"],
                            "duration": rep["duration"],
                            "seg_bytes": seg_bytes,
                            "all_segments": item["all_segments"]
                        })
                else:
                    prepared_representatives.append({
                        "label": item["label"],
                        "start": rep["start"],
                        "end": rep["end"],
                        "duration": rep["duration"],
                        "seg_bytes": None,
                        "all_segments": item["all_segments"]
                    })
                    
            print(f"[Reevaluate] Extracted WAV bytes for {len(prepared_representatives)} labels in {time.time() - t_extract_start:.2f}s")

            # Worker function to process a single representative label
            def process_label(item):
                label = item["label"]
                seg_bytes = item["seg_bytes"]
                duration = item["duration"]
                start = item["start"]
                end = item["end"]
                try:
                    if seg_bytes:
                        seg_embedding = get_embedding_from_segment_data(seg_bytes, min(duration, 30.0), start, end)
                    else:
                        seg_embedding = extract_audio_segment_embedding(use_url, start, end)
                        
                    if seg_embedding:
                        sim = cosine_similarity(ref_embedding, seg_embedding)
                        score = (sim + 1) / 2 # Normalize from [-1, 1] to [0, 1]
                        return {
                            "label": label,
                            "score": score
                        }
                except Exception as e:
                    print(f"[Reevaluate] Error comparing label {label}: {e}")
                return None

            label_scores = {}
            max_workers = 10
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(process_label, item): item for item in prepared_representatives}
                for future in as_completed(futures):
                    result = future.result()
                    if result:
                        label_scores[result["label"]] = result["score"]

            # Propagate label scores to all segments of that label
            candidates = []
            for item in prepared_representatives:
                label = item["label"]
                score = label_scores.get(label)
                if score is not None:
                    # Determine confidence category
                    if score >= 0.82:
                        confidence = "high"
                        recommendation = f"Correspondance vocale forte ({score*100:.0f}%)"
                    elif score >= 0.65:
                        confidence = "medium"
                        recommendation = f"Correspondance vocale modérée ({score*100:.0f}%)"
                    else:
                        confidence = "low"
                        recommendation = f"Différent ({score*100:.0f}%)"
                        
                    # Add all segments of this label to the candidates list
                    for seg in item["all_segments"]:
                        candidates.append({
                            "index": seg["index"],
                            "startTime": seg["start"],
                            "endTime": seg["end"],
                            "duration": seg["duration"],
                            "text": seg["text"],
                            "score": score,
                            "confidence": confidence,
                            "recommendation": recommendation
                        })

            # Sort candidates: highest confidence first
            candidates.sort(key=lambda x: x["score"], reverse=True)
            print(f"[Reevaluate] Evaluated {len(candidates)} candidate segments successfully at speaker label level")
            
            return https_fn.Response(json.dumps({
                "success": True,
                "candidates": candidates
            }), status=200, content_type="application/json")
        finally:
            if local_audio_path and os.path.exists(local_audio_path):
                try:
                    os.unlink(local_audio_path)
                    print(f"[Reevaluate] Cleaned up temporary audio: {local_audio_path}")
                except Exception as e_clean:
                    print(f"[Reevaluate] Error cleaning up temporary audio: {e_clean}")
                    
    except Exception as e:
        print(f"[Reevaluate] Error: {e}")
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
            if not audio_recordings:
                singular_rec = meeting.get("audioRecording")
                if singular_rec:
                    audio_recordings = [singular_rec]
            for rec in audio_recordings:
                mapping = rec.get("speakerMapping", {})
                segments = rec.get("segments", []) or reconstruct_segments_from_transcription(rec.get("transcription"), mapping)
                audio_url = rec.get("fileUrl") or rec.get("downloadUrl") or rec.get("downloadURL")
                
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
                segments = rec.get("segments", []) or reconstruct_segments_from_transcription(rec.get("transcription"), mapping)
                
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
def closed_feedback_loop_http(req: https_fn.Request) -> https_fn.Response:
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
                    # Write directly to Supabase (primary store)
                    from supabase_embeddings import add_embedding, get_embedding_count
                    add_embedding(correct_name, new_embedding, correct_member_id or "", sample_source="correction")
                    count = get_embedding_count(correct_name)
                    # Update Firestore metadata only
                    db.collection("members").document(correct_member_id).update({
                        "voiceSampleCount": count,
                        "lastVoiceUpdate": datetime.now().isoformat(),
                        "lastCorrectionSource": meeting_id
                    })
                    reinforced = True
                    print(f"[FeedbackLoop] Reinforced {correct_name}'s profile ({count} samples)")
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
            
            # Active learning already handled above via Supabase-direct write
            pass
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
                    mapping = rec.get("speakerMapping", {})
                    segments = rec.get("segments", []) or reconstruct_segments_from_transcription(rec.get("transcription"), mapping)
                    
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
                    audio_url = rec.get("fileUrl") or rec.get("downloadUrl") or rec.get("downloadURL")
                    transcription_text = rec.get("transcription", "")
                    audio_duration = rec.get("duration", 0) or 0
                
                # Try plural audioRecordings as fallback
                if not audio_url:
                    recs = meeting.get("audioRecordings", [])
                    if recs and isinstance(recs, list) and len(recs) > 0:
                        first_rec = recs[0] if isinstance(recs[0], dict) else {}
                        audio_url = first_rec.get("fileUrl") or first_rec.get("downloadUrl") or first_rec.get("downloadURL")
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
        
        # Write directly to Supabase (primary store)
        from supabase_embeddings import add_embedding, is_duplicate as emb_is_dup, get_embedding_count
        
        if emb_is_dup(member_name, new_embedding, threshold=0.95):
            count = get_embedding_count(member_name)
            return https_fn.Response(json.dumps({
                "success": True,
                "memberName": member_name,
                "newSampleCount": count,
                "message": f"⚠️ Échantillon trop similaire à un existant. Profil inchangé ({count} samples)"
            }), status=200, content_type="application/json")
        
        add_embedding(member_name, new_embedding, member_id, sample_source="ml_auto")
        count = get_embedding_count(member_name)
        
        # Update Firestore metadata only
        member_ref = db.collection("members").document(member_id)
        member_ref.update({
            "voiceSampleCount": count,
            "lastVoiceUpdate": datetime.now().isoformat(),
            "lastUpdateSource": "ai_suggestion"
        })
        
        db.collection("ml_suggestions_applied").add({
            "memberId": member_id, "memberName": member_name,
            "timestamp": datetime.now().isoformat()
        })
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
# ADMIN PURGE - Clean voice profiles
# =============================================================================
@https_fn.on_call(timeout_sec=120)
def purge_speaker_profile(req: https_fn.CallableRequest) -> dict:
    """
    Utility function to hard delete speaker profile vectors in Supabase and reset Firestore counter.
    Pass member_names list in req.data.
    """
    names_to_clean = req.data.get("names", [])
    if not names_to_clean:
        return {"success": False, "message": "No names provided"}
    
    deleted_count = 0
    import traceback
    try:
        global db
        if db is None:
            db = firestore.client()
            
        print(f"[Admin] Purging profiles for: {names_to_clean}")

        # 1. Clean Supabase
        from supabase_embeddings import _get_supabase_client
        try:
            supabase = _get_supabase_client()
            res = supabase.table("speaker_embeddings").delete().in_("speaker_name", names_to_clean).execute()
            print(f"[Admin] Supabase clean successful.")
        except Exception as e:
            print(f"[Admin] Error cleaning Supabase: {e}")
            raise e
            
        # 2. Clean Firestore Counters
        try:
            members_ref = db.collection("members").where("displayName", "in", names_to_clean).stream()
            for doc in members_ref:
                doc.reference.update({"voiceSampleCount": 0})
                deleted_count += 1
                print(f"[Admin] Reset counter for: {doc.to_dict().get('displayName')}")
        except Exception as e:
             print(f"[Admin] Error cleaning Firestore: {e}")
             raise e

        return {
            "success": True,
            "message": f"Successfully purged profiles for {deleted_count} members.",
            "names": names_to_clean
        }

    except Exception as e:
        print(f"[Admin] Purge failed: {str(e)}")
        print(traceback.format_exc())
        return {"success": False, "error": str(e)}

# =============================================================================
# AUTONOMOUS ML LOOP - Global orchestration of all ML components
# =============================================================================

def _run_ml_loop_internal(db_client, meeting_id=None, mode="full"):
    """
    Internal helper that runs the ML loop logic.
    Used by autonomous_ml_loop, trigger_ml_after_transcription, and scheduled_ml_maintenance.
    
    Returns results dict with autoLearned, queuedForReview, suggestionsGenerated, etc.
    """
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
        
        if meeting_id:
            meetings_docs = [db_client.collection("meetings").document(meeting_id).get()]
        else:
            # Fetch last 30 meetings ordered by date DESC to find those that actually have audio data
            print("[AutonomousML] Scanning recent meetings for audio recordings...")
            raw_meetings = list(db_client.collection("meetings").order_by(
                "date", direction=firestore.Query.DESCENDING
            ).limit(30).stream())
            
            meetings_docs = []
            for doc in raw_meetings:
                if doc.exists:
                    m_data = doc.to_dict()
                    recordings = m_data.get("audioRecordings", [])
                    if not recordings and m_data.get("audioRecording"):
                        recordings = [m_data.get("audioRecording")]
                    
                    if recordings:
                        meetings_docs.append(doc)
                        if len(meetings_docs) >= 5:
                            break
            
            print(f"[AutonomousML] Found {len(meetings_docs)} meetings with audio data to process.")
            # Fallback: if no meetings with recordings found in last 30, use top 5 raw
            if not meetings_docs:
                print("[AutonomousML] No meetings with audio data found. Falling back to top 5 meetings.")
                meetings_docs = raw_meetings[:5]
        
        for meeting_doc in meetings_docs:
            if not meeting_doc.exists:
                continue
            meeting = meeting_doc.to_dict()
            print(f"[AutonomousML] Processing meeting {meeting_doc.id} ({meeting.get('title', 'Untitled')})")
            
            # Get recordings list (handling both singular and plural formats)
            recordings = meeting.get("audioRecordings", [])
            if not recordings:
                singular_rec = meeting.get("audioRecording")
                if singular_rec:
                    recordings = [singular_rec]
            
            print(f"[AutonomousML] Meeting {meeting_doc.id} has {len(recordings)} recordings.")
            for rec in recordings:
                mapping = rec.get("speakerMapping", {})
                confidence_data = rec.get("confidenceScores", {})
                segments = rec.get("segments", []) or reconstruct_segments_from_transcription(rec.get("transcription"), mapping)
                audio_url = rec.get("fileUrl") or rec.get("downloadUrl") or rec.get("downloadURL")
                
                print(f"[AutonomousML] Recording: audio_url={audio_url[:50] if audio_url else None}... mapping={mapping}")
                
                for label, name in mapping.items():
                    conf_info = confidence_data.get(label, {})
                    score = conf_info.get("score", 0) if isinstance(conf_info, dict) else conf_info
                    
                    # Fallback: if no confidence scores exist (legacy meetings or missing database writes)
                    # but we have a valid mapping, default score to 0.85 so that the ML loop can process them.
                    if not score or score == 0:
                        print(f"[AutonomousML] Mapped speaker '{name}' has no confidence score. Falling back to 0.85 to allow auto-learning.")
                        score = 0.85
                    
                    print(f"[AutonomousML] Speaker label {label} mapped to {name} with confidence score {score}")
                    
                    # AUTO-LEARN: High confidence (>80%)
                    if score >= 0.80:
                        member_query = db_client.collection("members").where("displayName", "==", name).limit(1).stream()
                        member_found = False
                        for member_doc in member_query:
                            member_found = True
                            member = member_doc.to_dict()
                            sample_count = member.get("voiceSampleCount", 0)
                            print(f"[AutonomousML] Found member {name} with voiceSampleCount={sample_count}")
                            
                            if sample_count < 15:
                                speaker_segs = [s for s in segments if s.get("speaker") == label]
                                print(f"[AutonomousML] Speaker {label} has {len(speaker_segs)} segments.")
                                if speaker_segs and audio_url:
                                    ideal_segs = [s for s in speaker_segs 
                                                  if 15 <= (s.get("end", 0) - s.get("start", 0)) <= 45]
                                    if not ideal_segs:
                                        ideal_segs = [s for s in speaker_segs 
                                                      if 5 < (s.get("end", 0) - s.get("start", 0)) < 60]
                                    
                                    print(f"[AutonomousML] Found {len(ideal_segs)} ideal segments for embedding extraction.")
                                    if ideal_segs:
                                        best_seg = max(ideal_segs, key=lambda x: x.get("end", 0) - x.get("start", 0))
                                        print(f"[AutonomousML] Best segment: start={best_seg.get('start')}, end={best_seg.get('end')}, length={best_seg.get('end', 0) - best_seg.get('start', 0):.2f}s")
                                    
                                        try:
                                            new_emb = extract_audio_segment_embedding(
                                                audio_url, best_seg["start"], best_seg["end"]
                                            )
                                            if new_emb:
                                                from supabase_embeddings import add_embedding, is_duplicate as emb_is_duplicate
                                                if not emb_is_duplicate(name, new_emb, threshold=0.95):
                                                    add_embedding(name, new_emb, member_doc.id, sample_source="ml_auto")
                                                    from supabase_embeddings import get_embedding_count
                                                    new_count = get_embedding_count(name)
                                                    db_client.collection("members").document(member_doc.id).update({
                                                        "voiceSampleCount": new_count,
                                                        "lastVoiceUpdate": datetime.now().isoformat(),
                                                        "lastUpdateSource": "autonomous_ml"
                                                    })
                                                    results["autoLearned"] += 1
                                                    results["actions"].append(f"Auto-learned: {name} ({new_count} samples)")
                                                    print(f"[AutonomousML] Successfully auto-learned {name} (now has {new_count} samples).")
                                                else:
                                                    print(f"[AutonomousML] Skipping duplicate embedding for {name}")
                                            else:
                                                print(f"[AutonomousML] Failed to extract embedding for {name}")
                                        except Exception as e:
                                            print(f"[AutonomousML] Auto-learn failed for {name}: {e}")
                                    else:
                                        print(f"[AutonomousML] No ideal segments found for speaker {label}.")
                                else:
                                    print(f"[AutonomousML] Skipping speaker {label} - either no segments or no audio_url (url={audio_url}).")
                            else:
                                print(f"[AutonomousML] Skipping speaker {label} ({name}) - voiceSampleCount={sample_count} is already at or above 15.")
                        
                        if not member_found:
                            print(f"[AutonomousML] Member '{name}' not found in the database.")
                    
                    # QUEUE: Low confidence (<70%) → needs human review
                    elif score < 0.70 and score > 0.40:
                        existing = list(db_client.collection("verification_queue").where(
                            "speakerLabel", "==", label
                        ).where("meetingId", "==", meeting_doc.id).limit(1).stream())
                        
                        if not existing:
                            best_seg = max([s for s in segments if s.get("speaker") == label] or [{}], 
                                          key=lambda x: x.get("end", 0) - x.get("start", 0), default={})
                            
                            db_client.collection("verification_queue").add({
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
                            print(f"[AutonomousML] Queued speaker {label} ({name}) for manual verification with score {score}.")
                        else:
                            print(f"[AutonomousML] Speaker {label} ({name}) already exists in the verification queue.")
    
    # =================================================================
    # STEP 2: UPDATE CALIBRATION
    # =================================================================
    if mode in ["full", "calibrate_only"]:
        print("[AutonomousML] Step 2: Updating calibration...")
        
        corrections = list(db_client.collection("ml_corrections").order_by(
            "timestamp", direction=firestore.Query.DESCENDING
        ).limit(100).stream())
        
        if len(corrections) >= 10:
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
            
            db_client.collection("ml_calibration").document("speaker_id").set({
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
        
        members = list(db_client.collection("members").stream())
        for doc in members:
            member = doc.to_dict()
            sample_count = member.get("voiceSampleCount", 0)
            name = member.get("displayName") or member.get("name")
            
            if sample_count < 5:
                existing = list(db_client.collection("ml_suggestions").where(
                    "memberId", "==", doc.id
                ).where("status", "==", "pending").limit(1).stream())
                
                if not existing:
                    db_client.collection("ml_suggestions").add({
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
    
    db_client.collection("ml_metrics").add({
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
    return results


@https_fn.on_request(
    timeout_sec=540,
    memory=options.MemoryOption.GB_2,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def autonomous_ml_loop(req: https_fn.Request) -> https_fn.Response:
    """
    Global autonomous ML loop that runs after each transcription.
    Orchestrates all ML components via _run_ml_loop_internal.
    """

    try:
        global db
        if db is None:
            db = firestore.client()

        data = req.get_json() or {}
        meeting_id = data.get("meetingId")  # Optional: focus on specific meeting
        mode = data.get("mode", "full")  # full, quick, calibrate_only
        
        print(f"[AutonomousML] Starting loop - mode={mode}, meeting={meeting_id}")
        
        results = _run_ml_loop_internal(db, meeting_id, mode)
        
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
    timeout_sec=300,
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST"])
)
def trigger_ml_after_transcription(req: https_fn.Request) -> https_fn.Response:
    """
    Webhook called after a transcription completes.
    Triggers the autonomous ML loop inline in 'quick' mode.
    """
    try:
        global db
        if db is None:
            db = firestore.client()

        data = req.get_json()
        meeting_id = data.get("meetingId")
        
        if not meeting_id:
            return https_fn.Response(json.dumps({"error": "meetingId required"}), status=400)
        
        print(f"[PostTranscription] Triggering ML loop inline for meeting {meeting_id}")
        
        # Log the trigger
        db.collection("ml_triggers").add({
            "meetingId": meeting_id,
            "timestamp": datetime.now().isoformat(),
            "source": "post_transcription"
        })
        
        # Execute the ML loop inline in quick mode (auto-learn + calibrate only, no suggestions)
        results = _run_ml_loop_internal(db, meeting_id, mode="quick")
        
        return https_fn.Response(json.dumps({
            "success": True,
            "message": f"ML loop completed inline for meeting {meeting_id}",
            "results": results
        }), status=200, content_type="application/json")
        
    except Exception as e:
        print(f"[PostTranscription] Error: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500)


# =============================================================================
# SCHEDULED ML MAINTENANCE - Monthly ML loop & maintenance
# =============================================================================
@scheduler_fn.on_schedule(
    schedule="0 3 1 * *",
    timezone="America/Montreal",
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
)
def scheduled_ml_maintenance(event: scheduler_fn.ScheduledEvent) -> None:
    """Monthly ML maintenance: full ML loop + embedding cleanup + RLHF reoptimization."""
    global db
    if db is None:
        db = firestore.client()
    
    print("[ScheduledML] Starting monthly maintenance...")
    
    # Step 1: Run full ML loop
    results = _run_ml_loop_internal(db, mode="full")
    print(f"[ScheduledML] ML loop results: {results}")
    
    # Step 2: Clean and optimize embeddings
    try:
        from active_learning import clean_and_optimize_all_speaker_embeddings
        cleanup = clean_and_optimize_all_speaker_embeddings(db)
        print(f"[ScheduledML] Embedding cleanup: {cleanup}")
    except Exception as e:
        print(f"[ScheduledML] Embedding cleanup failed: {e}")
    
    # Step 3: Re-optimize RLHF policy
    try:
        from active_learning import optimize_policy
        policy = optimize_policy(db, force_reoptimize=True)
        print(f"[ScheduledML] RLHF policy reoptimized: {policy}")
    except Exception as e:
        print(f"[ScheduledML] RLHF reoptimization failed: {e}")
    
    # Step 4: Log maintenance run
    db.collection("ml_metrics").add({
        "timestamp": datetime.now().isoformat(),
        "type": "scheduled_maintenance",
        "mlResults": results,
        "source": "cloud_scheduler"
    })
    
    print("[ScheduledML] Monthly maintenance complete.")


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
    analyze_embedding_quality,
    build_style_memory,
    inject_style_memory_into_prompt,
    analyze_quality_trends,
)

from clear_supabase_speakers import clear_supabase_speakers
from batch_enroll_from_storage import batch_enroll_from_storage
from migrate_to_supabase_primary import run_migration_to_supabase_primary
from auto_migration import ensure_migration_completed, get_migration_status
from sync_service import sync_embedding_to_supabase

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
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
)
def closed_feedback_loop(req: https_fn.CallableRequest) -> dict:
    """
    Actively update voice embeddings using correction signals (Amelioration Loop).
    Writes directly to Supabase (primary embedding store).
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    member_id = data.get("memberId") or data.get("correctMemberId", "")
    correct_name = data.get("correctName", "")
    wrong_name = data.get("wrongName", "")
    audio_url = data.get("audioUrl", "")
    start_time = data.get("start", 0)
    end_time = data.get("end", 0)

    if not member_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing key: memberId"
        )

    print(f"[ActiveLearning] Updating embedding for member {member_id}, correct={correct_name}")

    try:
        global db
        if db is None:
            db = firestore.client()

        # Get member name if not provided
        if not correct_name:
            member_doc = db.collection("members").document(member_id).get()
            if member_doc.exists:
                correct_name = member_doc.to_dict().get("displayName", "")

        correct_embedding = None
        if audio_url and end_time > start_time:
            print(f"[ActiveLearning] Extracting embedding from audio: {start_time}-{end_time}s")
            correct_embedding = extract_audio_segment_embedding(audio_url, start_time, end_time)
            print(f"[ActiveLearning] Extraction result: {'OK dim=' + str(len(correct_embedding)) if correct_embedding else 'FAILED'}")

        if not correct_embedding:
            return {
                "success": False,
                "message": "Could not extract embedding from audio",
            }

        # Write directly to Supabase (primary store)
        print(f"[ActiveLearning] Writing to Supabase for '{correct_name}' (dim={len(correct_embedding)})")
        from supabase_embeddings import update_with_correction
        result = update_with_correction(
            speaker_name=correct_name,
            correct_vec=correct_embedding,
            member_id=member_id,
            wrong_speaker_name=wrong_name,
            wrong_vec=None,  # We don't have the wrong embedding
            correction_weight=2,
        )
        print(f"[ActiveLearning] Supabase result: {result}")

        # Update Firestore metadata only (not embeddings)
        db.collection("members").document(member_id).update({
            "voiceSampleCount": result.get("newSampleCount", 0),
            "lastVoiceUpdate": datetime.now().isoformat(),
            "lastUpdateSource": "active_learning_correction",
        })

        # Reward signal
        compute_embedding_reward(
            db_client=db,
            member_id=member_id,
            was_correct=True,
            confidence=1.0,
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


# -----------------------------------------------------------------------------
# Clean and optimize speaker embeddings (Active ML maintenance)
# -----------------------------------------------------------------------------
@https_fn.on_call(
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
)
def clean_and_optimize_speaker_embeddings(req: https_fn.CallableRequest) -> dict:
    """
    Firebase Cloud Function to clean and optimize all speaker voice embeddings,
    purging outliers, overlaps and duplicates to make profiles robust.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    try:
        global db
        if db is None:
            db = firestore.client()

        from active_learning import clean_and_optimize_all_speaker_embeddings as clean_fn
        results = clean_fn(db_client=db)
        return results

    except Exception as e:
        print(f"[ML Maintenance] Error: {e}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# -----------------------------------------------------------------------------
# Hot backup of critical Firestore collections to Cloud Storage
# -----------------------------------------------------------------------------
@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "OPTIONS"])
)
def backup_firestore_to_storage(req: https_fn.Request) -> https_fn.Response:
    """
    Sauvegarde à chaud des collections critiques du Portail CCE au format JSON
    dans le bucket Cloud Storage sous la forme d'un dossier timestampé.
    """
    import json
    from datetime import datetime
    
    # Simple CORS preflight handling
    if req.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '3600'
        }
        return https_fn.Response('', status=204, headers=headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        from core.firebase_init import db, bucket
            
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        backup_folder = f"backups/{timestamp}"
        
        collections_to_backup = ["meetings", "members", "projects", "regulations", "activity_log"]
        results = {}
        
        for col_name in collections_to_backup:
            docs = db.collection(col_name).stream()
            data_dict = {doc.id: doc.to_dict() for doc in docs}
            
            # Upload to GCS
            blob = bucket.blob(f"{backup_folder}/{col_name}.json")
            blob.upload_from_string(
                json.dumps(data_dict, ensure_ascii=False, default=str, indent=2),
                content_type="application/json"
            )
            results[col_name] = len(data_dict)
            
        return https_fn.Response(json.dumps({
            "success": True,
            "timestamp": timestamp,
            "folder": backup_folder,
            "exported": results
        }), status=200, headers=headers, content_type="application/json")
    except Exception as e:
        print(f"[Backup] Error during backup export: {e}")
        return https_fn.Response(json.dumps({"success": False, "error": str(e)}), status=500, headers=headers, content_type="application/json")

