"""
Enrollment Diagnostic Tool

Checks why embedding extraction fails for specific files.
"""

import os
import json
import tempfile
import subprocess
from firebase_functions import https_fn, options
from firebase_admin import storage, firestore


@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.MB_512,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def diagnose_enrollment_issues(req: https_fn.Request) -> https_fn.Response:
    """
    Diagnose why enrollment fails.
    
    Returns detailed information about:
    - Files in speaker_enrollments/
    - Which members have embeddings
    - Why extraction fails for specific files
    """
    try:
        db = firestore.client()
        bucket = storage.bucket()
        
        # Get all blobs
        blobs = list(bucket.list_blobs(prefix="speaker_enrollments/"))
        print(f"[Diagnosis] Found {len(blobs)} files in speaker_enrollments/")
        
        # Group by member
        files_by_member = {}
        for blob in blobs:
            if blob.name.endswith('/'):
                continue
            
            parts = blob.name.split('/')
            if len(parts) < 3:
                continue
            
            member_name = parts[1]
            if member_name not in files_by_member:
                files_by_member[member_name] = []
            files_by_member[member_name].append({
                "name": blob.name,
                "size_bytes": blob.size,
                "content_type": blob.content_type,
                "time_created": blob.time_created.isoformat() if blob.time_created else None
            })
        
        # Check which members have embeddings in Firestore
        members_with_embeddings = []
        members_without_embeddings = []
        
        for member_name in files_by_member.keys():
            member_query = list(db.collection("members")
                               .where("displayName", "==", member_name)
                               .limit(1)
                               .stream())
            
            if member_query:
                member = member_query[0].to_dict()
                embedding = member.get("embedding")
                
                if embedding:
                    members_with_embeddings.append({
                        "name": member_name,
                        "file_count": len(files_by_member[member_name]),
                        "has_embedding": True
                    })
                else:
                    members_without_embeddings.append({
                        "name": member_name,
                        "file_count": len(files_by_member[member_name]),
                        "has_embedding": False
                    })
            else:
                members_without_embeddings.append({
                    "name": member_name,
                    "file_count": len(files_by_member[member_name]),
                    "has_embedding": False,
                    "note": "No Firestore member found"
                })
        
        # Try to diagnose one failed file (if any)
        diagnosed_files = []
        
        # Pick a file from a member without embedding
        for member in members_without_embeddings[:3]:  # Diagnose up to 3
            member_name = member["name"]
            if member_name in files_by_member and len(files_by_member[member_name]) > 0:
                file_info = files_by_member[member_name][0]
                blob = bucket.blob(file_info["name"])
                
                try:
                    # Download and check file
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        blob.download_to_filename(tmp.name)
                        temp_path = tmp.name
                    
                    # Check with ffprobe
                    cmd = [
                        "ffprobe", "-v", "error", "-show_entries",
                        "format=duration,format_name,format_bit_rate",
                        "-of", "json",
                        temp_path
                    ]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                    
                    diagnosis = {
                        "file": file_info["name"],
                        "member": member_name,
                        "downloaded": True,
                        "ffprobe_success": result.returncode == 0
                    }
                    
                    if result.returncode == 0:
                        try:
                            probe_data = json.loads(result.stdout)
                            format_info = probe_data.get("format", {})
                            diagnosis["format"] = {
                                "duration": format_info.get("duration"),
                                "format_name": format_info.get("format_name"),
                                "bit_rate": format_info.get("bit_rate")
                            }
                        except json.JSONDecodeError:
                            diagnosis["format_error"] = "Failed to parse ffprobe output"
                    else:
                        diagnosis["ffprobe_error"] = result.stderr
                    
                    # Clean up
                    os.unlink(temp_path)
                    
                    diagnosed_files.append(diagnosis)
                    
                except Exception as e:
                    diagnosed_files.append({
                        "file": file_info["name"],
                        "member": member_name,
                        "error": str(e),
                        "type": type(e).__name__
                    })
        
        return https_fn.Response(
            json.dumps({
                "success": True,
                "summary": {
                    "total_files": len(blobs),
                    "unique_members": len(files_by_member),
                    "members_with_embeddings": len(members_with_embeddings),
                    "members_without_embeddings": len(members_without_embeddings)
                },
                "members_with_embeddings": members_with_embeddings,
                "members_without_embeddings": members_without_embeddings,
                "diagnosed_files": diagnosed_files,
                "timestamp": ""
            }, indent=2),
            status=200,
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