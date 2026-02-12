
import os
import time
import requests
import subprocess
import google.auth
import google.auth.iam
from google.auth.transport import requests as google_requests
from datetime import timedelta
from firebase_admin import storage

def extract_audio_segment_embedding(audio_url: str, start_sec: float, end_sec: float) -> list:
    """
    Extract audio segment and get embedding via Modal or Hugging Face.
    Returns embedding vector or empty list on failure.
    
    Supports both MODAL_ENDPOINT_URL and HF_ENDPOINT_URL + HF_TOKEN.
    """
    try:
        # Support both Modal and Hugging Face endpoints
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
            
            # Save to temp file
            import tempfile
            import shutil
            
            with requests.get(audio_url, stream=True, timeout=60) as r:
                if not r.ok:
                    print(f"[VoiceEmbed] Failed to download audio: {r.status_code}")
                    return []
                    
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
                    shutil.copyfileobj(r.raw, tmp_in)
                    input_path = tmp_in.name
        
        # Extract segment with ffmpeg
        # Create unique output path to avoid overwriting input file
        import tempfile
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
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start_sec),
            "-t", str(duration),
            "-ar", "16000", "-ac", "1",
            output_path
        ]
        
        try:
            # Capture stdout/stderr to debug
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            print(f"[VoiceEmbed] FFMPEG Failed: {e.stderr}")
            return []
        
        # Verify output exists
        if not os.path.exists(output_path):
            print(f"[VoiceEmbed] ERROR: Output file not created: {output_path}")
            print(f"[VoiceEmbed] FFMPEG stderr: {result.stderr}")
            return []

        # Read segment (just to log size)
        with open(output_path, "rb") as f:
            segment_data = f.read()
            
        print(f"[VoiceEmbed] Segment created: {len(segment_data)} bytes")
        
        # Upload segment to temporary storage for remote access
        # Both Modal and HF need a URL they can access
        bucket = storage.bucket()
        temp_blob_path = f"temp_audio_segments/{int(time.time())}_{start_sec}_{end_sec}.wav"
        temp_blob = bucket.blob(temp_blob_path)
        temp_blob.upload_from_filename(output_path)
        
        # Now it is safe to Clean up temp files
        if not is_local:
            try:
                os.unlink(input_path)
            except:
                pass
        try:
            os.unlink(output_path)
        except:
            pass
        
        # Get service account email for signing via IAM API
        # This avoids the need for a local private key file
        try:
            credentials, project_id = google.auth.default()
            
            # Ensure credentials are fresh
            request = google_requests.Request()
            credentials.refresh(request)
            
            service_account_email = credentials.service_account_email
            
            if not service_account_email:
                print("[VoiceEmbed] Warning: Could not determine service account email. Signing might fail.")
            
            # Explicitly create IAM signer
            signer = google.auth.iam.Signer(request, credentials, service_account_email)
                
            # Generate signed URL (expires in 15 minutes)
            # Passing signer explicitly to ensure IAM API is used
            signed_url = temp_blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=15),
                method="GET",
                service_account_email=service_account_email,
                signer=signer
            )
        except Exception as e:
            print(f"[VoiceEmbed] Signed URL generation failed: {e}")
            # Try fallback without service account email if IAM fails (though unlikely to work on Cloud Run)
            try:
                signed_url = temp_blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(minutes=15),
                    method="GET"
                )
            except:
                 return []
        
        print(f"[VoiceEmbed] Sending segment to {endpoint_url.split('//')[1].split('/')[0]} ({duration:.1f}s)")
        
        # Call endpoint with headers (supports both Modal and HF)
        headers = {"Content-Type": "application/json"}
        if hf_token:
            headers["Authorization"] = f"Bearer {hf_token}"
            
        payload = {"audioUrl": signed_url}
        
        response = requests.post(endpoint_url, json=payload, headers=headers, timeout=30)
        
        # Cleanup remote file
        try:
             temp_blob.delete()
        except:
             pass

        if response.status_code == 200:
            return response.json()
        else:
            print(f"[VoiceEmbed] Error from endpoint: {response.text}")
            return []
            
    except Exception as e:
        print(f"[VoiceEmbed] Extraction failed: {e}")
        import traceback
        traceback.print_exc()
        return []
