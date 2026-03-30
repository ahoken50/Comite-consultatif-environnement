import os
from firebase_admin import initialize_app, firestore, storage

# Initialize Firebase
try:
    initialize_app()
    db = firestore.client()
    bucket = storage.bucket()
    print("[System] Firebase initialized successfully.")
except Exception as e:
    print(f"[System] Warning: Global init skipped (Deploy/Build mode?): {e}")
    db = None
    bucket = None
