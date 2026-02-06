# Use official PyTorch image with CUDA support
FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-runtime

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies BEFORE pyannote to pin versions
RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    torch==2.1.2 \
    torchaudio==2.1.2

# Install pyannote.audio with specific version known to work with torch 2.1.x
RUN pip install --no-cache-dir \
    pyannote.audio==3.1.1 \
    requests

# Copy handler code
COPY handler.py .

# Expose port for HF Endpoint
EXPOSE 8080

# Install uvicorn and starlette for the server
RUN pip install --no-cache-dir uvicorn starlette httpx

# Create the entry point script that HF Endpoints expects
RUN echo 'from starlette.applications import Starlette\n\
from starlette.responses import JSONResponse\n\
from starlette.routing import Route\n\
import json\n\
from handler import EndpointHandler\n\
\n\
handler = EndpointHandler()\n\
\n\
async def predict(request):\n\
    body = await request.json()\n\
    result = handler(body)\n\
    return JSONResponse(result)\n\
\n\
async def health(request):\n\
    return JSONResponse({"status": "ok"})\n\
\n\
app = Starlette(routes=[\n\
    Route("/", predict, methods=["POST"]),\n\
    Route("/health", health, methods=["GET"]),\n\
])\n' > /app/main.py

# Run the server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
