"""
Force Sync: Firestore Embeddings → Supabase

This function syncs all existing embeddings from Firestore to Supabase
without re-extracting from audio files. Useful for manual sync.
"""

import os
import json
from datetime import datetime
from firebase_functions import https_fn, options
from firebase_admin import firestore


@https_fn.on_request(
    timeout_sec=180,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "OPTIONS"])
)
def force_sync_firestore_to_supabase(req: https_fn.Request) -> https_fn.Response:
    """
    Force sync all embeddings from Firestore to Supabase.
    
    This function reads all embeddings from Firestore members collection
    and syncs them to Supabase speaker_embeddings table.
    
    Usage:
        curl -X POST https://us-central1-comite-cce.cloudfunctions.net/force_sync_firestore_to_supabase
    
    Returns:
        {
            "success": true,
            "synced_members": 5,
            "total_embeddings": 12,
            "details": [...]
        }
    """
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed. Use POST."}),
            status=405,
            content_type="application/json"
        )
    
    try:
        # Import sync function
        from main import sync_embedding_to_supabase
        
        db = firestore.client()
        
        # Get all members with embeddings
        members = list(db.collection("members").stream())
        
        print(f"[ForceSync] Checking {len(members)} members...")
        
        results = {
            "success": True,
            "total_members": len(members),
            "synced_members": 0,
            "skipped_members": 0,
            "failed_members": 0,
            "total_embeddings": 0,
            "details": []
        }
        
        for doc in members:
            member = doc.to_dict()
            member_id = doc.id
            name = member.get("displayName") or member.get("name")
            embedding = member.get("embedding")
            
            if not name:
                continue
            
            # Parse embedding
            if isinstance(embedding, str):
                try:
                    embedding = json.loads(embedding)
                except (json.JSONDecodeError, ValueError):
                    results["skipped_members"] += 1
                    results["details"].append({
                        "name": name,
                        "status": "skipped",
                        "reason": "Invalid embedding JSON"
                    })
                    continue
            
            if not embedding or not isinstance(embedding, list):
                results["skipped_members"] += 1
                results["details"].append({
                    "name": name,
                    "status": "skipped",
                    "reason": "No embedding"
                })
                continue
            
            # Sync to Supabase
            try:
                sync_embedding_to_supabase(name, embedding, member_id)
                
                results["synced_members"] += 1
                if isinstance(embedding[0], list):
                    # Multi-embeddings
                    results["total_embeddings"] += len(embedding)
                    results["details"].append({
                        "name": name,
                        "status": "synced",
                        "embedding_count": len(embedding)
                    })
                else:
                    # Single embedding
                    results["total_embeddings"] += 1
                    results["details"].append({
                        "name": name,
                        "status": "synced",
                        "embedding_count": 1
                    })
                
                print(f"[ForceSync] ✓ {name}: Synced {len(embedding) if isinstance(embedding[0], list) else 1} embedding(s)")
                
            except Exception as e:
                results["failed_members"] += 1
                results["details"].append({
                    "name": name,
                    "status": "failed",
                    "error": str(e)
                })
                print(f"[ForceSync] ✗ {name}: {e}")
        
        # Print summary
        print("\n" + "=" * 80)
        print("FORCE SYNC SUMMARY")
        print("=" * 80)
        print(f"Total members:       {results['total_members']}")
        print(f"Synced members:      {results['synced_members']}")
        print(f"Skipped members:     {results['skipped_members']}")
        print(f"Failed members:      {results['failed_members']}")
        print(f"Total embeddings:    {results['total_embeddings']}")
        print("=" * 80)
        
        return https_fn.Response(
            json.dumps(results, indent=2),
            status=200 if results["failed_members"] == 0 else 207,
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