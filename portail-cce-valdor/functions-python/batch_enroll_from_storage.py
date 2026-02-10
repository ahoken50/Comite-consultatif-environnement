"""
Batch Enrollment from Firebase Storage
======================================

Cloud Function pour extraire les embeddings de tous les fichiers audio
dans speaker_enrollments/ et les stocker dans Firestore + Supabase.

Usage:
    firebase deploy --only functions:batch_enroll_from_storage
    curl -X POST https://us-central1-comite-cce.cloudfunctions.net/batch_enroll_from_storage

Cette fonction est idempotente : elle ne retraite pas les membres qui ont déjà un embedding.
"""

import os
import json
from datetime import datetime
from firebase_functions import https_fn, options
from firebase_admin import storage, firestore


@https_fn.on_request(
    timeout_sec=540,  # 9 minutes
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "OPTIONS"])
)
def batch_enroll_from_storage(req: https_fn.Request) -> https_fn.Response:
    """
    Batch enrollment : extrait les embeddings de tous les fichiers audio
    dans speaker_enrollments/ et les stocke dans Firestore + Supabase.
    
    Retourne:
        {
            "success": true,
            "processed": 5,
            "skipped": 2,
            "failed": 1,
            "details": [...]
        }
    """
    try:
        from main import extract_audio_segment_embedding, sync_embedding_to_supabase
        
        db = firestore.client()
        bucket = storage.bucket()
        
        # Liste tous les fichiers dans speaker_enrollments/
        blobs = list(bucket.list_blobs(prefix="speaker_enrollments/"))
        
        print(f"[BatchEnroll] Found {len(blobs)} files in speaker_enrollments/")
        
        results = {
            "success": True,
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "details": []
        }
        
        for blob in blobs:
            # Skip directories
            if blob.name.endswith('/'):
                continue
            
            # Extract member name from path: speaker_enrollments/{name}/enrollment_*.wav
            parts = blob.name.split('/')
            if len(parts) < 3:
                continue
            
            member_name = parts[1]
            
            print(f"\n[BatchEnroll] Processing: {member_name}")
            
            # Check if member already has an embedding
            member_query = list(db.collection("members").where(
                "displayName", "==", member_name
            ).limit(1).stream())
            
            if not member_query:
                results["details"].append({
                    "name": member_name,
                    "status": "skipped",
                    "reason": "No Firestore member found"
                })
                results["skipped"] += 1
                print(f"[BatchEnroll] Skipped {member_name}: No Firestore member")
                continue
            
            member_doc = member_query[0]
            member = member_doc.to_dict()
            existing_embedding = member.get("embedding")
            
            if existing_embedding:
                # Parse to check if valid
                try:
                    if isinstance(existing_embedding, str):
                        parsed = json.loads(existing_embedding)
                        if parsed and isinstance(parsed, list) and len(parsed) > 0:
                            results["details"].append({
                                "name": member_name,
                                "status": "skipped",
                                "reason": "Already has embedding"
                            })
                            results["skipped"] += 1
                            print(f"[BatchEnroll] Skipped {member_name}: Already has embedding")
                            continue
                except (json.JSONDecodeError, ValueError):
                    pass
            
            # Generate signed URL for the audio file
            from datetime import timedelta
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(hours=1),
                method="GET"
            )
            
            # Extract embedding via Modal
            # Assume the audio file is the full enrollment, so we extract from 0 to end
            # We'll use a reasonable duration (e.g., 30 seconds max)
            try:
                # Download audio to get duration
                import tempfile
                import subprocess
                
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    blob.download_to_filename(tmp.name)
                    temp_path = tmp.name
                
                # Get audio duration with ffprobe
                cmd = [
                    "ffprobe", "-v", "error", "-show_entries",
                    "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
                    temp_path
                ]
                result = subprocess.run(cmd, capture_output=True, text=True)
                duration = float(result.stdout.strip()) if result.returncode == 0 else 30.0
                
                # Extract embedding from the full audio (max 30s)
                end_time = min(duration, 30.0)
                embedding = extract_audio_segment_embedding(signed_url, 0, end_time)
                
                # Cleanup temp file
                os.unlink(temp_path)
                
                if not embedding or len(embedding) == 0:
                    results["details"].append({
                        "name": member_name,
                        "status": "failed",
                        "reason": "Embedding extraction failed"
                    })
                    results["failed"] += 1
                    print(f"[BatchEnroll] Failed {member_name}: Embedding extraction failed")
                    continue
                
                # Store in Firestore
                member_doc.reference.update({
                    "embedding": json.dumps([embedding]),  # Wrap in list for multi-embedding format
                    "voiceSampleCount": 1,
                    "lastVoiceUpdate": datetime.now().isoformat(),
                    "lastUpdateSource": "batch_enrollment",
                })
                
                # Sync to Supabase
                sync_embedding_to_supabase(member_name, [embedding], member_doc.id)
                
                results["details"].append({
                    "name": member_name,
                    "status": "success",
                    "embedding_dims": len(embedding)
                })
                results["processed"] += 1
                print(f"[BatchEnroll] Success {member_name}: Embedding stored ({len(embedding)} dims)")
                
            except Exception as e:
                results["details"].append({
                    "name": member_name,
                    "status": "failed",
                    "reason": str(e)
                })
                results["failed"] += 1
                print(f"[BatchEnroll] Failed {member_name}: {e}")
                import traceback
                traceback.print_exc()
        
        return https_fn.Response(
            json.dumps(results, indent=2),
            status=200,
            content_type="application/json"
        )
        
    except Exception as e:
        print(f"[BatchEnroll] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )