"""
Diagnostic Tool: Check Phase 2 Migration Status

This script helps diagnose why Supabase might be empty after migration.
It checks Firestore, Supabase, and migration status.
"""

import os
import json
from firebase_admin import firestore, credentials, initialize_app, _apps
from supabase import create_client
from firebase_functions import https_fn, options


def check_firestore_embeddings():
    """Check if Firestore members have embeddings."""
    print("\n" + "=" * 80)
    print("CHECKING FIRESTORE EMBEDDINGS")
    print("=" * 80)
    
    try:
        if not _apps:
            cred = credentials.ApplicationDefault()
            initialize_app(cred)
        db = firestore.client()
        
        # Get all members
        members = list(db.collection("members").stream())
        print(f"✓ Total members in Firestore: {len(members)}")
        
        # Check for embeddings
        members_with_embeddings = []
        members_without_embeddings = []
        
        for doc in members:
            member = doc.to_dict()
            name = member.get("displayName") or member.get("name") or doc.id
            embedding = member.get("embedding")
            
            if embedding:
                members_with_embeddings.append({
                    "id": doc.id,
                    "name": name,
                    "has_embedding": True,
                    "embedding_type": type(embedding).__name__,
                    "is_list": isinstance(embedding, list),
                    "embedding_length": len(embedding) if isinstance(embedding, list) else None
                })
            else:
                members_without_embeddings.append({
                    "id": doc.id,
                    "name": name,
                    "has_embedding": False
                })
        
        print(f"\n✓ Members WITH embeddings: {len(members_with_embeddings)}")
        for m in members_with_embeddings:
            print(f"  - {m['name']}: {m['embedding_type']}, length={m['embedding_length']}")
        
        print(f"\n✗ Members WITHOUT embeddings: {len(members_without_embeddings)}")
        for m in members_without_embeddings:
            print(f"  - {m['name']}")
        
        return {
            "total_members": len(members),
            "with_embeddings": len(members_with_embeddings),
            "without_embeddings": len(members_without_embeddings),
            "details": members_with_embeddings
        }
        
    except Exception as e:
        print(f"✗ Error checking Firestore: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def check_supabase_status():
    """Check Supabase connection and speaker_embeddings table."""
    print("\n" + "=" * 80)
    print("CHECKING SUPABASE STATUS")
    print("=" * 80)
    
    try:
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("✗ SUPABASE_URL or SUPABASE_KEY not configured")
            return {"error": "Credentials not configured"}
        
        supabase = create_client(supabase_url, supabase_key)
        print("✓ Supabase connection successful")
        
        # Check if speaker_embeddings table exists
        try:
            result = supabase.table("speaker_embeddings").select("id", count="exact").execute()
            count = result.count if hasattr(result, 'count') else len(result.data)
            print(f"✓ speaker_embeddings table exists: {count} rows")
            
            if count > 0:
                # Show embeddings by speaker
                speaker_result = supabase.table("speaker_embeddings").select(
                    "speaker_name", count="exact"
                ).execute()
                
                print(f"\n✓ Embeddings by speaker:")
                for item in speaker_result.data:
                    print(f"  - {item['speaker_name']}")
                
                # Show recent insertions
                print(f"\n✓ Recent insertions:")
                recent = supabase.table("speaker_embeddings").select(
                    "speaker_name", "sample_source", "created_at"
                ).order("created_at", desc=True).limit(5).execute()
                
                for item in recent.data:
                    print(f"  - {item['speaker_name']} ({item['sample_source']}) at {item['created_at']}")
            
            return {
                "table_exists": True,
                "total_rows": count,
                "speakers": len(speaker_result.data) if count > 0 else 0
            }
            
        except Exception as e:
            print(f"✗ speaker_embeddings table does not exist or query failed: {e}")
            return {"table_exists": False, "error": str(e)}
        
    except Exception as e:
        print(f"✗ Error checking Supabase: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def check_migration_flag():
    """Check migration completion flag in Firestore."""
    print("\n" + "=" * 80)
    print("CHECKING MIGRATION FLAG")
    print("=" * 80)
    
    try:
        if not _apps:
            cred = credentials.ApplicationDefault()
            initialize_app(cred)
        db = firestore.client()
        
        config_doc = db.collection("system_config").document("migration_status")
        config = config_doc.get()
        
        if config.exists:
            data = config.to_dict()
            completed = data.get("phase2_migration_completed", False)
            timestamp = data.get("phase2_migration_timestamp")
            
            print(f"✓ Migration status document exists")
            print(f"  - Completed: {completed}")
            print(f"  - Timestamp: {timestamp}")
            print(f"  - Updated at: {data.get('updated_at')}")
            
            return {
                "exists": True,
                "completed": completed,
                "timestamp": timestamp
            }
        else:
            print("✗ Migration status document does not exist")
            return {"exists": False, "completed": False}
        
    except Exception as e:
        print(f"✗ Error checking migration flag: {e}")
        return {"error": str(e)}


def run_full_diagnosis():
    """Run complete diagnosis."""
    print("\n" + "=" * 80)
    print("PHASE 2 MIGRATION DIAGNOSTIC TOOL")
    print("=" * 80)
    
    results = {
        "timestamp": "",
        "firestore": None,
        "supabase": None,
        "migration_flag": None,
        "recommendations": []
    }
    
    # Check Firestore
    results["firestore"] = check_firestore_embeddings()
    
    # Check Supabase
    results["supabase"] = check_supabase_status()
    
    # Check migration flag
    results["migration_flag"] = check_migration_flag()
    
    # Generate recommendations
    print("\n" + "=" * 80)
    print("DIAGNOSIS SUMMARY & RECOMMENDATIONS")
    print("=" * 80)
    
    firestore_ok = results["firestore"].get("with_embeddings", 0) > 0
    supabase_ok = results["supabase"].get("table_exists", False) and results["supabase"].get("total_rows", 0) > 0
    flag_ok = results["migration_flag"].get("completed", False)
    
    if not firestore_ok:
        print("\n⚠ PROBLEM: Firestore has no embeddings!")
        results["recommendations"].append("Phase 1: Run batch enrollment to extract embeddings from storage")
    
    if firestore_ok and not supabase_ok:
        print("\n⚠ PROBLEM: Firestore has embeddings but Supabase is empty!")
        if not results["supabase"].get("table_exists"):
            print("  → speaker_embeddings table does not exist")
            results["recommendations"].append("Run supabase_phase2_migration.sql in Supabase SQL Editor")
        else:
            print("  → Table exists but is empty")
            results["recommendations"].append("Trigger migration: POST /trigger_manual_migration")
    
    if firestore_ok and supabase_ok and not flag_ok:
        print("\n⚠ WARNING: Migration completed but flag not set!")
        results["recommendations"].append("Set migration flag manually or run migration again")
    
    if firestore_ok and supabase_ok and flag_ok:
        print("\n✓ SUCCESS: Migration completed successfully!")
        print("  → Firestore has embeddings")
        print("  → Supabase has embeddings")
        print("  → Migration flag is set")
    
    results["recommendations"] = results["recommendations"] or ["System is healthy"]
    
    return results


@https_fn.on_request(
    timeout_sec=60,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def api_diagnose_migration(req: https_fn.Request) -> https_fn.Response:
    """Cloud Function to run migration diagnosis."""
    try:
        results = run_full_diagnosis()
        
        return https_fn.Response(
            json.dumps(results, indent=2),
            status=200,
            content_type="application/json"
        )
    except Exception as e:
        import traceback
        return https_fn.Response(
            json.dumps({
                "error": str(e),
                "traceback": traceback.format_exc()
            }),
            status=500,
            content_type="application/json"
        )


if __name__ == "__main__":
    results = run_full_diagnosis()
    print("\n" + "=" * 80)
    print("DIAGNOSTIC RESULTS (JSON)")
    print("=" * 80)
    print(json.dumps(results, indent=2))