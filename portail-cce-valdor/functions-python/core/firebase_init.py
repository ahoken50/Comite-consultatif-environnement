import os
from firebase_admin import initialize_app, firestore, storage

# Initialize Firebase
db = None
bucket = None

# Skip global init during deploy/spec-discovery to prevent metadata server timeout
if "ADMIN_PORT" not in os.environ:
    try:
        initialize_app()
        db = firestore.client()
        bucket = storage.bucket()
        print("[System] Firebase initialized successfully.")
    except Exception as e:
        print(f"[System] Warning: Global init skipped: {e}")
else:
    print("[System] Deploy/Build mode: skipping global Firebase initialization.")

