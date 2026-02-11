"""
Retry Enrollment: Process Failed WAV Files

This function retries embedding extraction for members without embeddings,
with improved audio handling and extended timeout.
"""

import os
import json
import tempfile
import subprocess
from datetime import datetime
from firebase_functions import https_fn, options
from firebase_admin import storage, firestore


@https_fn.on_request(
    timeout_sec=540,  # 9 minutes pour traiter tous les fichiers
    memory=options.MemoryOption.GB_1,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "OPTIONS"])
)
def retry_failed_enrollments(req: https_fn.Request) -> https_fn.Response:
    """
    Retry enrollment for members without embeddings.
    
    This function:
    1. Lists all files in speaker_enrollments/
    2. Identifies members without embeddings
    3. Downloads and converts audio if needed
    4. Extracts embeddings via Modal with extended timeout
    5. Syncs to Supabase
    
    Usage:
        curl -X POST https://us-central1-comite-cce.cloudfunctions.net/retry_failed_enrollments
    """
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed. Use POST."}),
            status=405,
            content_type="application/json"
        )
    
    try:
        from main import extract_audio_segment_embedding, sync_embedding_to_supabase
        
        db = firestore.client()
        bucket = storage.bucket()
        
        # Get all blobs in speaker_enrollments/
        blobs = list(bucket.list_blobs(prefix="speaker_enrollments/"))
        
        # Filter: only directories (member folders)
        member_folders = set()
        for blob in blobs:
            if blob.name.endswith('/'):
                parts = blob.name.split('/')
                if len(parts) >= 2:
                    member_folders.add(parts[1])
        
        print(f"[RetryEnroll] Found {len(member_folders)} member folders")
        
        # Get all members with embeddings in Firestore
        members_with_embeddings = set()
        members_data = {}
        
        members = list(db.collection("members").stream())
        for doc in members:
            member = doc.to_dict()
            name = member.get("displayName") or member.get("name")
            embedding = member.get("embedding")
            
            if name:
                members_data[name] = {
                    "id": doc.id,
                    "has_embedding": bool(embedding)
                }
                if embedding:
                    members_with_embeddings.add(name)
        
        # Find members without embeddings
        members_without_embeddings = [name for name in member_folders 
                                     if name not in members_with_embeddings]
        
        print(f"[RetryEnroll] Members without embeddings: {len(members_without_embeddings)}")
        
        results = {
            "success": True,
            "total_members": len(member_folders),
            "members_with_embeddings": len(members_with_embeddings),
            "members_without_embeddings": len(members_without_embeddings),
            "processed": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
            "details": []
        }
        
        # Process each member without embeddings
        for member_name in members_without_embeddings:
            print(f"\n[RetryEnroll] Processing: {member_name}")
            
            # Find audio files for this member
            member_files = [b for b in blobs 
                          if not b.name.endswith('/') and member_name in b.name]
            
            if not member_files:
                results["skipped"] += 1
                results["details"].append({
                    "name": member_name,
                    "status": "skipped",
                    "reason": "No audio files found"
                })
                continue
            
            # Try each file
            member_succeeded = False
            embeddings_list = []
            
            for blob in member_files[:3]:  # Max 3 files per member
                try:
                    print(f"[RetryEnroll]   Processing file: {blob.name}")
                    
                    # Download file
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        blob.download_to_filename(tmp.name)
                        input_path = tmp.name
                    
                    # Check format with ffprobe
                    probe_cmd = [
                        "ffprobe", "-v", "error", "-show_entries",
                        "format=duration,format_name,codec_name",
                        "-of", "default=noprint_wrappers=1:nokey=1",
                        input_path
                    ]
                    result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
                    
                    if result.returncode != 0:
                        print(f"[RetryEnroll]     ffprobe failed: {result.stderr}")
                        os.unlink(input_path)
                        continue
                    
                    # Get duration
                    duration_str = result.stdout.split('\n')[0].strip()
                    try:
                        duration = float(duration_str)
                    except ValueError:
                        duration = 30.0
                    
                    # Extract embedding (max 30s)
                    end_time = min(duration, 30.0)
                    embedding = extract_audio_segment_embedding(input_path, 0, end_time)
                    
                    # Cleanup
                    os.unlink(input_path)
                    
                    if embedding and len(embedding) > 0:
                        embeddings_list.append(embedding)
                        print(f"[RetryEnroll]     ✓ Extracted embedding ({len(embedding)} dims)")
                    else:
                        print(f"[RetryEnroll]     ✗ Extraction failed")
                    
                except Exception as e:
                    print(f"[RetryEnroll]     ✗ Error: {e}")
                    if os.path.exists(input_path):
                        os.unlink(input_path)
                    continue
            
            # If we got embeddings, save them
            if embeddings_list:
                try:
                    member_id = members_data.get(member_name, {}).get("id")
                    
                    if not member_id:
                        print(f"[RetryEnroll]   No Firestore member found for {member_name}")
                        continue
                    
                    # Save to Firestore
                    db.collection("members").document(member_id).update({
                        "embedding": json.dumps(embeddings_list),
                        "voiceSampleCount": len(embeddings_list),
                        "lastVoiceUpdate": datetime.now().isoformat(),
                        "lastUpdateSource": "retry_enrollment"
                    })
                    
                    # Sync to Supabase
                    sync_embedding_to_supabase(member_name, embeddings_list, member_id)
                    
                    member_succeeded = True
                    results["succeeded"] += 1
                    
                    results["details"].append({
                        "name": member_name,
                        "status": "succeeded",
                        "embedding_count": len(embeddings_list),
                        "files_processed": len(member_files[:3])
                    })
                    
                    print(f"[RetryEnroll] ✓ {member_name}: {len(embeddings_list)} embeddings saved")
                    
                except Exception as e:
                    print(f"[RetryEnroll] ✗ Save failed: {e}")
                    results["failed"] += 1
                    results["details"].append({
                        "name": member_name,
                        "status": "failed",
                        "reason": str(e)
                    })
            else:
                results["failed"] += 1
                results["details"].append({
                    "name": member_name,
                    "status": "failed",
                    "reason": "No embeddings extracted"
                })
            
            results["processed"] += 1
        
        # Print summary
        print("\n" + "=" * 80)
        print("RETRY ENROLLMENT SUMMARY")
        print("=" * 80)
        print(f"Total members:           {results['total_members']}")
        print(f"Members with embeddings: {results['members_with_embeddings']}")
        print(f"Members processed:       {results['processed']}")
        print(f"Succeeded:               {results['succeeded']}")
        print(f"Failed:                  {results['failed']}")
        print(f"Skipped:                 {results['skipped']}")
        print("=" * 80)
        
        return https_fn.Response(
            json.dumps(results, indent=2),
            status=200 if results["failed"] == 0 else 207,
            content_type="application/json"
        )
        
    except Exception as e:
        import traceback
        return https_fn.Response(
            json.dumps({
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }),
            status=500,
            content_type="application/json"
        )