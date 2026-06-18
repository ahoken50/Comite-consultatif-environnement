import os
import requests
import tempfile
import shutil
import subprocess
import time
from datetime import timedelta
from firebase_admin import storage

def extract_audio_segment_embedding(audio_url: str, start_sec: float, end_sec: float) -> list:
    """
    Extract audio segment and get embedding via Modal or Hugging Face.
    Returns embedding vector or empty list on failure.
    
    Supports both MODAL_ENDPOINT_URL and HF_ENDPOINT_URL + HF_TOKEN.
    """
    try:
        # Support both Modal and Hugging Face endpoints (same as enroll_speaker)
        endpoint_url = os.environ.get("MODAL_ENDPOINT_URL") or os.environ.get("HF_ENDPOINT_URL")
        hf_token = os.environ.get("HF_TOKEN")
        
        if not endpoint_url:
            print("[VoiceEmbed] MODAL_ENDPOINT_URL or HF_ENDPOINT_URL not configured")
            return []
        
        if os.path.exists(audio_url):
            # Use local file directly
            print(f"[VoiceEmbed] Using local file: {audio_url}")
            input_path = audio_url
            is_local = True
        else:    
            # Download audio file (Streamed to avoid RAM spike)
            print(f"[VoiceEmbed] Downloading audio from {audio_url[:50]}...")
            is_local = False
            
            with requests.get(audio_url, stream=True, timeout=60) as r:
                if not r.ok:
                    print(f"[VoiceEmbed] Failed to download audio: {r.status_code}")
                    return []
                    
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
                    shutil.copyfileobj(r.raw, tmp_in)
                    input_path = tmp_in.name
        
        # Extract segment with ffmpeg
        # Create unique output path to avoid overwriting input file
        with tempfile.NamedTemporaryFile(suffix="_segment.wav", delete=False) as tmp_out:
            output_path = tmp_out.name
        
        duration = min(end_sec - start_sec, 30)  # Max 30 seconds
        
        # DEBUG: Check input file
        input_size = os.path.getsize(input_path)
        print(f"[VoiceEmbed] Input file size: {input_size} bytes")
        if input_size == 0:
            print("[VoiceEmbed] ERROR: Input file is empty")
            return []

        # Check if ffmpeg is available
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("[VoiceEmbed] ERROR: ffmpeg is not installed or not in PATH.")
            return []

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_sec),
            "-i", input_path,
            "-t", str(duration),
            "-ar", "16000", "-ac", "1",
            output_path
        ]
        
        try:
            # Capture stdout/stderr to debug
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            # print(f"[VoiceEmbed] FFMPEG Output: {result.stderr[:200]}...") # Optional: print first 200 chars
        except subprocess.CalledProcessError as e:
            print(f"[VoiceEmbed] FFMPEG Failed: {e.stderr}")
            if hasattr(e, 'stderr'): print(e.stderr)
            return []
        
        # Verify output exists
        if not os.path.exists(output_path):
            print(f"[VoiceEmbed] ERROR: Output file not created: {output_path}")
            return []

        # Read segment
        with open(output_path, "rb") as f:
            segment_data = f.read()
            
        print(f"[VoiceEmbed] Segment created: {len(segment_data)} bytes")
        
        # Clean up temp files
        if not is_local:
            os.unlink(input_path)
        os.unlink(output_path)
        
        duration = min(end_sec - start_sec, 30)
        return get_embedding_from_segment_data(segment_data, duration, start_sec, end_sec)

    except Exception as e:
        print(f"[VoiceEmbed] Error: {e}")
        import traceback
        traceback.print_exc()
        return []

def get_embedding_from_segment_data(segment_data: bytes, duration: float, start_sec: float = 0, end_sec: float = 0) -> list:
    """
    Call Modal/HF endpoint to get voice embedding from raw segment audio bytes in memory.
    """
    try:
        endpoint_url = os.environ.get("MODAL_ENDPOINT_URL") or os.environ.get("HF_ENDPOINT_URL")
        hf_token = os.environ.get("HF_TOKEN")
        
        if not endpoint_url:
            print("[VoiceEmbed] MODAL_ENDPOINT_URL or HF_ENDPOINT_URL not configured")
            return []
            
        import base64
        is_modal = "modal.run" in endpoint_url
        
        if is_modal:
            print(f"[VoiceEmbed] Sending base64 audio to Modal directly...")
            audio_base64 = base64.b64encode(segment_data).decode("utf-8")
            payload = {"audio_base64": audio_base64}
        else:
            print(f"[VoiceEmbed] Fallback to Firebase Storage upload for non-Modal endpoint...")
            # Upload segment to temporary storage for remote access
            bucket = storage.bucket()
            temp_blob_path = f"temp_audio_segments/{int(time.time())}_{start_sec}_{end_sec}.wav"
            temp_blob = bucket.blob(temp_blob_path)
            temp_blob.upload_from_string(segment_data, content_type="audio/wav")
            
            # Generate signed URL (expires in 15 minutes)
            use_token_fallback = False
            try:
                from google.auth import default as auth_default
                credentials, _ = auth_default()
                if "compute_engine" in str(type(credentials)).lower():
                    use_token_fallback = True
            except Exception:
                pass

            signed_url = None
            if not use_token_fallback:
                try:
                    signed_url = temp_blob.generate_signed_url(
                        version="v4",
                        expiration=timedelta(minutes=15),
                        method="GET"
                    )
                except Exception:
                    try:
                        signed_url = temp_blob.generate_signed_url(
                            expiration=timedelta(minutes=15),
                            method="GET"
                        )
                    except Exception:
                        use_token_fallback = True

            if use_token_fallback or not signed_url:
                try:
                    import uuid
                    token = str(uuid.uuid4())
                    metadata = {"firebaseStorageDownloadTokens": token}
                    temp_blob.metadata = metadata
                    temp_blob.patch()
                    
                    bucket_name = temp_blob.bucket.name
                    blob_name = temp_blob.name.replace("/", "%2F")
                    signed_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/{blob_name}?alt=media&token={token}"
                except Exception as e3:
                     print(f"[VoiceEmbed] Token generation/patch failed: {e3}")
                     bucket_name = temp_blob.bucket.name
                     blob_name = temp_blob.name.replace("/", "%2F")
                     signed_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/{blob_name}?alt=media"

            payload = {"url": signed_url, "inputs": signed_url}

        try:
            host_str = endpoint_url.split('//')[1].split('/')[0] if '//' in endpoint_url else endpoint_url
        except Exception:
            host_str = endpoint_url
        print(f"[VoiceEmbed] Sending segment to {host_str} ({duration:.1f}s)")
        
        headers = {"Content-Type": "application/json"}
        if hf_token:
            headers["Authorization"] = f"Bearer {hf_token}"
        
        modal_response = requests.post(
            endpoint_url,
            headers=headers,
            json=payload,
            timeout=600
        )
        
        if not modal_response.ok:
            print(f"[VoiceEmbed] Endpoint Error: {modal_response.status_code} - {modal_response.text}")
            return []
            
        return modal_response.json()
    except Exception as e:
        print(f"[VoiceEmbed] Error in get_embedding_from_segment_data: {e}")
        import traceback
        traceback.print_exc()
        return []

def extract_audio_segment_bytes(local_audio_path: str, start_sec: float, end_sec: float) -> bytes:
    """
    Run ffmpeg locally on a local audio file to extract start_sec to end_sec as WAV bytes.
    """
    try:
        with tempfile.NamedTemporaryFile(suffix="_segment.wav", delete=False) as tmp_out:
            output_path = tmp_out.name
            
        duration = min(end_sec - start_sec, 30)
        
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_sec),
            "-i", local_audio_path,
            "-t", str(duration),
            "-ar", "16000", "-ac", "1",
            output_path
        ]
        
        # Capture output silently to prevent logging pollution
        subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        with open(output_path, "rb") as f:
            segment_data = f.read()
            
        os.unlink(output_path)
        return segment_data
    except Exception as e:
        print(f"[AudioUtils] Error extracting segment bytes: {e}")
        return b""

