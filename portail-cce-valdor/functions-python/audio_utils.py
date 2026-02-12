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
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start_sec),
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
        
        # Upload segment to temporary storage for remote access
        bucket = storage.bucket()
        temp_blob_path = f"temp_audio_segments/{int(time.time())}_{start_sec}_{end_sec}.wav"
        temp_blob = bucket.blob(temp_blob_path)
        temp_blob.upload_from_string(segment_data, content_type="audio/wav")
        
        # Generate signed URL (expires in 15 minutes)
        try:
            signed_url = temp_blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=15),
                method="GET"
            )
        except TypeError as e:
            print(f"[VoiceEmbed] Signed URL generation failed: {e}")
            # Fallback for older libraries or different signatures
            try:
                signed_url = temp_blob.generate_signed_url(
                    expiration=timedelta(minutes=15),
                    method="GET"
                )
                print("[VoiceEmbed] Fallback to v2 signing succeeded")
            except Exception as e2:
                print(f"[VoiceEmbed] Fallback signing failed: {e2}")
                raise e
        
        print(f"[VoiceEmbed] Sending segment to {endpoint_url.split('//')[1].split('/')[0]} ({duration:.1f}s)")
        
        # Call endpoint with headers (supports both Modal and HF)
        headers = {"Content-Type": "application/json"}
        if hf_token:
            headers["Authorization"] = f"Bearer {hf_token}"
        
        # Modal uses "url", HF uses "inputs" - send both for compatibility
        payload = {"url": signed_url, "inputs": signed_url}
        
        modal_response = requests.post(
            endpoint_url,
            headers=headers,
            json=payload,
            timeout=600  # Increased to 10m to handle cold start
        )
        
        if not modal_response.ok:
            print(f"[VoiceEmbed] Endpoint Error: {modal_response.status_code} - {modal_response.text}")
            return []
            
        return modal_response.json()

    except Exception as e:
        print(f"[VoiceEmbed] Error: {e}")
        import traceback
        traceback.print_exc()
        return []
