"""
Migration Script: Firestore → Supabase speaker_embeddings (Phase 2)

This script migrates all existing embeddings from Firestore members to the new
Supabase speaker_embeddings table structure (multi-rows).

Run this AFTER deploying the SQL migration script (supabase_phase2_migration.sql).
"""

import os
import json
from datetime import datetime
from firebase_admin import firestore, credentials, initialize_app, _apps
from firebase_functions import https_fn, options


def migrate_firestore_to_supabase():
    """
    Migrate all embeddings from Firestore members to Supabase speaker_embeddings.
    """
    print("=" * 80)
    print("PHASE 2 MIGRATION: Firestore → Supabase speaker_embeddings")
    print("=" * 80)
    
    # Initialize Firebase
    try:
        if not _apps:
            cred = credentials.ApplicationDefault()
            initialize_app(cred)
        db = firestore.client()
        print("✓ Firebase initialized")
    except Exception as e:
        print(f"✗ Firebase initialization failed: {e}")
        return False
    
    # Initialize Supabase
    try:
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("✗ SUPABASE_URL or SUPABASE_KEY not configured")
            return False
        
        from supabase import create_client
        supabase = create_client(supabase_url, supabase_key)
        
        # Test speaker_embeddings table exists
        test_result = supabase.table("speaker_embeddings").select("id").limit(1).execute()
        print("✓ Supabase initialized with speaker_embeddings table")
    except Exception as e:
        print(f"✗ Supabase initialization failed: {e}")
        print("  Make sure you've run supabase_phase2_migration.sql first!")
        return False
    
    # Step 1: Clear existing speaker_embeddings data (fresh start)
    print("\n[Step 1] Clearing existing speaker_embeddings...")
    try:
        # Get all embeddings
        existing = supabase.table("speaker_embeddings").select("id").execute()
        if existing.data:
            for row in existing.data:
                supabase.table("speaker_embeddings").delete().eq("id", row["id"]).execute()
            print(f"✓ Cleared {len(existing.data)} existing embeddings")
        else:
            print("✓ No existing embeddings to clear")
    except Exception as e:
        print(f"✗ Failed to clear existing embeddings: {e}")
        return False
    
    # Step 2: Fetch all members from Firestore
    print("\n[Step 2] Fetching members from Firestore...")
    try:
        members = list(db.collection("members").stream())
        print(f"✓ Found {len(members)} members in Firestore")
    except Exception as e:
        print(f"✗ Failed to fetch Firestore members: {e}")
        return False
    
    # Step 2a: Pre-fetch Supabase speakers to link IDs (Optimization)
    print("\n[Step 2a] Fetching Supabase speakers for ID linking...")
    try:
        # Fetch all speakers (id, name)
        # Note: If > 1000 speakers, might need pagination, but likely okay for now
        sp_result = supabase.table("speakers").select("id, name").execute()
        
        speaker_map = {}
        for row in sp_result.data:
            # Create a normalized map: Lowercase trimmed name -> ID
            norm_name = row["name"].strip().lower()
            speaker_map[norm_name] = row["id"]
            
        print(f"✓ Cached {len(speaker_map)} speakers from Supabase")
    except Exception as e:
        print(f"⚠ Failed to cache speakers (will proceed without linking IDs): {e}")
        speaker_map = {}

    # Step 3: Migrate embeddings
    print("\n[Step 3] Migrating embeddings to Supabase speaker_embeddings...")
    
    migration_stats = {
        "total_members": len(members),
        "members_with_embeddings": 0,
        "total_embeddings_inserted": 0,
        "members_without_embeddings": 0,
        "failed_members": []
    }
    
    for doc in members:
        member = doc.to_dict()
        member_id = doc.id
        name = member.get("displayName") or member.get("name")
        embedding = member.get("embedding")
        
        if not name:
            print(f"  ⚠ Skipping member {member_id} (no name)")
            continue
        
        # Lookup speaker ID
        norm_name = name.strip().lower()
        speaker_id = speaker_map.get(norm_name)
        
        if not speaker_id:
            # CREATE SPEAKER if missing (since table was cleared)
            try:
                print(f"  + Creating speaker '{name}' in Supabase...")
                # Assuming 'role' is in member dict or default to 'member'
                role = member.get("role", "member")
                
                # Check if role is valid for Supabase enum if specific constraints exist
                # Otherwise just insert
                new_speaker = {
                    "name": name,
                    "role": role,
                    "created_at": datetime.now().isoformat()
                }
                
                res = supabase.table("speakers").insert(new_speaker).execute()
                if res.data:
                    speaker_id = res.data[0]["id"]
                    speaker_map[norm_name] = speaker_id
                    print(f"  ✓ Created speaker ID: {speaker_id}")
                else:
                    print(f"  ⚠ Failed to create speaker '{name}' (no data returned)")
            except Exception as e:
                print(f"  ✗ Error creating speaker '{name}': {e}")
        
        # Parse embedding
        if isinstance(embedding, str):
            try:
                embedding = json.loads(embedding)
            except (json.JSONDecodeError, ValueError):
                print(f"  ✗ {name}: Failed to parse embedding string")
                migration_stats["failed_members"].append(name)
                continue
        
        if not embedding or not isinstance(embedding, list):
            print(f"  ⚠ {name}: No embedding")
            migration_stats["members_without_embeddings"] += 1
            continue
        
        migration_stats["members_with_embeddings"] += 1
        
        # Insert embeddings (multi-rows)
        try:
            if isinstance(embedding[0], list) and isinstance(embedding[0][0], (int, float)):
                # List of vectors: insert each separately
                vectors = embedding
                for i, vec in enumerate(vectors):
                    if len(vec) in [512, 768]:
                        result = supabase.table("speaker_embeddings").insert({
                            "speaker_name": name,
                            "speaker_id": speaker_id,  # Linked ID
                            "embedding": vec,
                            "sample_source": "batch_import",
                            "created_at": datetime.now().isoformat(),
                            "metadata": json.dumps({
                                "firestore_member_id": member_id,
                                "vector_index": i,
                                "original_dim": len(vectors[i]),
                                "padded": False,
                                "migration_timestamp": datetime.now().isoformat()
                            })
                        }).execute()
                        migration_stats["total_embeddings_inserted"] += 1
                print(f"  ✓ {name}: Migrated {len(vectors)} embeddings (ID: {speaker_id})")
                
            elif isinstance(embedding[0], (int, float)):
                # Single vector
                vec = embedding
                if len(vec) in [512, 768]:
                    result = supabase.table("speaker_embeddings").insert({
                        "speaker_name": name,
                        "speaker_id": speaker_id,  # Linked ID
                        "embedding": vec,
                        "sample_source": "batch_import",
                        "created_at": datetime.now().isoformat(),
                        "metadata": json.dumps({
                            "firestore_member_id": member_id,
                            "original_dim": len(embedding),
                            "padded": False,
                            "migration_timestamp": datetime.now().isoformat()
                        })
                    }).execute()
                    migration_stats["total_embeddings_inserted"] += 1
                    print(f"  ✓ {name}: Migrated 1 embedding (ID: {speaker_id})")
                else:
                    print(f"  ⚠ {name}: Invalid embedding dimension {len(embedding)}")
            else:
                print(f"  ✗ {name}: Invalid embedding format")
                migration_stats["failed_members"].append(name)
                
        except Exception as e:
            print(f"  ✗ {name}: Migration failed - {e}")
            migration_stats["failed_members"].append(name)
    
    # Step 4: Verify migration
    print("\n[Step 4] Verifying migration...")
    try:
        result = supabase.table("speaker_embeddings").select("speaker_name", count="exact").execute()
        total_in_supabase = result.count if hasattr(result, 'count') else len(result.data)
        print(f"✓ Supabase speaker_embeddings: {total_in_supabase} rows")
        
        if total_in_supabase != migration_stats["total_embeddings_inserted"]:
            print(f"  ⚠ Warning: Expected {migration_stats['total_embeddings_inserted']}, got {total_in_supabase}")
    except Exception as e:
        print(f"✗ Verification failed: {e}")
    
    # Print summary
    print("\n" + "=" * 80)
    print("MIGRATION SUMMARY")
    print("=" * 80)
    print(f"Total members in Firestore:       {migration_stats['total_members']}")
    print(f"Members with embeddings:           {migration_stats['members_with_embeddings']}")
    print(f"Members without embeddings:        {migration_stats['members_without_embeddings']}")
    print(f"Total embeddings inserted:         {migration_stats['total_embeddings_inserted']}")
    print(f"Failed migrations:                 {len(migration_stats['failed_members'])}")
    
    if migration_stats['failed_members']:
        print(f"\nFailed members:")
        for name in migration_stats['failed_members']:
            print(f"  - {name}")
    
    print("\n" + "=" * 80)
    
    # Return success status
    success = (
        migration_stats['total_embeddings_inserted'] > 0 and
        len(migration_stats['failed_members']) == 0
    )
    
    if success:
        print("✓ Migration completed successfully!")
        print("\nNext steps:")
        print("  1. Verify embeddings in Supabase speaker_embeddings table")
        print("  2. Deploy updated Cloud Functions")
        print("  3. Test speaker identification with pgvector")
    else:
        print("✗ Migration completed with errors (see above)")
    
    return success


# Cloud Function wrapper
@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def run_migration_to_supabase_primary(req: https_fn.Request) -> https_fn.Response:
    """
    Cloud Function to trigger the Firestore → Supabase migration.
    
    Usage:
        curl -X POST https://us-central1-comite-cce.cloudfunctions.net/run_migration_to_supabase_primary
    """
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed. Use POST."}),
            status=405,
            content_type="application/json"
        )
    
    try:
        success = migrate_firestore_to_supabase()
        
        return https_fn.Response(
            json.dumps({
                "success": success,
                "message": "Migration completed" if success else "Migration failed (see logs)",
                "timestamp": datetime.now().isoformat()
            }),
            status=200 if success else 500,
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


# For local testing
if __name__ == "__main__":
    migrate_firestore_to_supabase()