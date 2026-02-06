"""
Modal.com deployment for Pyannote Speaker Embedding API.

This creates a serverless GPU endpoint that:
1. Receives an audio file URL
2. Generates a speaker embedding using pyannote/embedding
3. Returns the embedding vector

Usage:
    modal deploy modal_app.py

Test:
    curl -X POST https://YOUR-MODAL-URL.modal.run/embed \
        -H "Content-Type: application/json" \
        -d '{"url": "https://example.com/audio.wav"}'
"""

import modal
import os

# Create the Modal app
app = modal.App("pyannote-embeddings")

# Define the container image with all dependencies


image = (
    modal.Image.debian_slim()
    # Install system dependencies (git for pip install git+..., ffmpeg for audio processing)
    .apt_install("git", "ffmpeg")
    # Install Python dependencies
    .pip_install(
        "pyannote.audio",
        "torch",
        "torchaudio",
        "numpy",
        "requests",
        "scipy",
        "huggingface_hub", # Keep huggingface_hub for token handling
        "fastapi[standard]" # Keep fastapi for web endpoints
    )
)


@app.cls(
    image=image,
    gpu="T4",  # Use NVIDIA T4 GPU ($0.000164/sec = ~$0.59/hr)
    secrets=[modal.Secret.from_name("huggingface")],  # HF_TOKEN secret
    timeout=900,  # 15 minute timeout to handle everything
)
class EmbeddingService:
    model: "Model" = None

    @modal.enter()
    def load_model(self):
        """Load the model once when the container starts."""
        import os
        from pyannote.audio import Model
        from huggingface_hub import login
        
        print(f"Loading pyannote/embedding model (Runtime)...")
        
        # Try multiple variable names
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HUGGING_FACE_TOKEN")
        
        if token:
            print(f"Found HF token (ends with ...{token[-4:] if len(token) > 4 else '???'})")
            print(f"Logging in to Hugging Face...")
            login(token=token)
            
            # Use specific token directly to be sure
            self.model = Model.from_pretrained(
                "pyannote/embedding", 
                use_auth_token=token
            )
            self.inference = Inference(self.model, window="whole")
            print("Model loaded successfully!")
        else:
            print("CRITICAL ERROR: No HuggingFace token found in environment secrets!")
            print(f"Available environment keys: {list(os.environ.keys())}")
            raise ValueError("You must configure the 'huggingface' secret in Modal with 'HF_TOKEN' or 'HUGGINGFACE_TOKEN'.")


    @modal.method()
    def generate_embedding(self, audio_url: str = None, audio_base64: str = None) -> list:
        """
        Generate speaker embedding from audio URL or Base64 string.
        """
        import requests
        import tempfile
        import base64
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            if audio_url:
                print(f"Downloading audio from: {audio_url}")
                response = requests.get(audio_url, stream=True, timeout=60)
                if not response.ok:
                    raise Exception(f"Failed to download audio: {response.status_code}")
                for chunk in response.iter_content(chunk_size=8192):
                    tmp.write(chunk)
            elif audio_base64:
                print(f"Decoding base64 audio segment...")
                try:
                    audio_bytes = base64.b64decode(audio_base64)
                    tmp.write(audio_bytes)
                except Exception as e:
                    raise Exception(f"Failed to decode base64: {e}")
            else:
                raise Exception("No audio source provided (url or audio_base64)")
            
            tmp_path = tmp.name
        
        try:
            # Generate embedding
            print(f"Generating embedding...")
            embedding = self.inference(tmp_path)
            result = embedding.tolist()
            print(f"Embedding generated: {len(result)} dimensions")
            return result
        finally:
            # Cleanup
            if os.path.exists(tmp_path):
                os.remove(tmp_path)


# HTTP endpoint for external calls (from Cloud Functions)
@app.function(image=image, gpu="T4", secrets=[modal.Secret.from_name("huggingface")], timeout=900)
@modal.fastapi_endpoint(method="POST")
def embed(data: dict) -> list:
    """
    Web endpoint for generating embeddings.
    
    Request body: 
    - {"url": "https://example.com/audio.wav"}
    - OR {"audio_base64": "..."}
    
    Response: [0.123, -0.456, ...] (512 floats)
    """
    url = data.get("url") or data.get("inputs")
    audio_base64 = data.get("audio_base64")
    
    if not url and not audio_base64:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Missing 'url' or 'audio_base64' in request body")
    
    service = EmbeddingService()
    # Call with named arguments to match signature
    return service.generate_embedding.remote(audio_url=url, audio_base64=audio_base64)


# Local testing
if __name__ == "__main__":
    # For local testing
    with app.run():
        service = EmbeddingService()
        # Test with a sample audio URL
        result = service.generate_embedding.remote("https://example.com/test.wav")
        print(f"Result: {result[:5]}... ({len(result)} dimensions)")
