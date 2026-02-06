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
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "torch==2.2.0",
        "torchaudio==2.2.0", 
        "numpy==1.26.4",
        "huggingface_hub>=0.20.0",  # Uses 'token' instead of 'use_auth_token'
        "pyannote.audio==3.3.1",    # Compatible with new huggingface_hub
        "requests",
        "fastapi[standard]",  # Required for web endpoints
    )
)

# Create a volume to cache the model (saves download time on cold starts)
model_cache = modal.Volume.from_name("pyannote-model-cache", create_if_missing=True)

@app.cls(
    image=image,
    gpu="T4",  # Use NVIDIA T4 GPU ($0.000164/sec = ~$0.59/hr)
    secrets=[modal.Secret.from_name("huggingface")],  # HF_TOKEN secret
    volumes={"/cache": model_cache},
    timeout=300,  # 5 minute timeout
)
class EmbeddingService:
    @modal.enter()
    def load_model(self):
        """Load the model once when the container starts."""
        from pyannote.audio import Model, Inference
        import torch
        
        # Use cached model if available
        cache_dir = "/cache/models"
        os.makedirs(cache_dir, exist_ok=True)
        os.environ["HF_HOME"] = cache_dir
        
        token = os.environ.get("HF_TOKEN")
        print(f"Loading pyannote/embedding model...")
        
        self.model = Model.from_pretrained(
            "pyannote/embedding", 
            token=token  # 'use_auth_token' is deprecated
        )
        self.inference = Inference(self.model, window="whole")
        print("Model loaded successfully!")

    @modal.method()
    def generate_embedding(self, audio_url: str) -> list:
        """
        Generate speaker embedding from audio URL.
        
        Args:
            audio_url: Public URL to an audio file (wav, mp3, etc.)
            
        Returns:
            List of floats representing the 512-dimensional embedding
        """
        import requests
        import tempfile
        
        print(f"Downloading audio from: {audio_url}")
        
        # Download the audio file
        response = requests.get(audio_url, stream=True, timeout=60)
        if not response.ok:
            raise Exception(f"Failed to download audio: {response.status_code}")
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            for chunk in response.iter_content(chunk_size=8192):
                tmp.write(chunk)
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
@app.function(image=image, gpu="T4", secrets=[modal.Secret.from_name("huggingface")])
@modal.fastapi_endpoint(method="POST")
def embed(data: dict) -> list:
    """
    Web endpoint for generating embeddings.
    
    Request body: {"url": "https://example.com/audio.wav"}
    Response: [0.123, -0.456, ...] (512 floats)
    """
    url = data.get("url") or data.get("inputs")
    if not url:
        return {"error": "Missing 'url' in request body"}
    
    service = EmbeddingService()
    return service.generate_embedding.remote(url)


# Local testing
if __name__ == "__main__":
    # For local testing
    with app.run():
        service = EmbeddingService()
        # Test with a sample audio URL
        result = service.generate_embedding.remote("https://example.com/test.wav")
        print(f"Result: {result[:5]}... ({len(result)} dimensions)")
