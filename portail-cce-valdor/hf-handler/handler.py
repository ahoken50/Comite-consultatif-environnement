# Force Rebuild 002 - Docker Compatible
from typing import Dict, List, Any, Union
import os
import requests
import tempfile

class EndpointHandler:
    def __init__(self, path="."):
        # Load the model
        from pyannote.audio import Model, Inference
        
        token = os.environ.get("HF_TOKEN")
        if not token:
            print("WARNING: HF_TOKEN not set. Model loading might fail.")
            
        print("Loading Pyannote Embedding Model...")
        self.model = Model.from_pretrained("pyannote/embedding", use_auth_token=token)
        self.inference = Inference(self.model, window="whole")
        print("Model loaded successfully.")

    def __call__(self, data: Dict[str, Any]) -> Union[List[float], Dict[str, str]]:
        """
        Args:
            data: includes the input data (URL string under "inputs" key)
        Returns:
            A list of floats representing the embedding, or an error dict.
        """
        # Get the input (expecting a URL string being passed as "inputs")
        inputs = data.get("inputs", data)
        
        if not isinstance(inputs, str):
            return {"error": "Input must be a URL string pointing to an audio file."}
        
        # Download the audio file
        try:
            print(f"Downloading audio from: {inputs}")
            response = requests.get(inputs, stream=True, timeout=60)
            if not response.ok:
                return {"error": f"Failed to download audio: {response.status_code}"}
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                for chunk in response.iter_content(chunk_size=8192):
                    tmp.write(chunk)
                tmp_path = tmp.name
                
            # Run inference
            print(f"Processing audio at {tmp_path}")
            embedding = self.inference(tmp_path)
            
            # Cleanup
            os.remove(tmp_path)
            
            # Return list of floats
            return embedding.tolist()
            
        except Exception as e:
            if 'tmp_path' in locals() and os.path.exists(tmp_path):
                os.remove(tmp_path)
            return {"error": str(e)}
