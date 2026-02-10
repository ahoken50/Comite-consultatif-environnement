"""
Auto-Migration System: Phase 2 Migration Automation

This module provides automatic migration capabilities that run seamlessly
when Cloud Functions are called, without manual intervention.
"""

import os
import json
from datetime import datetime
from firebase_admin import firestore
from supabase import create_client


MIGRATION_FLAG_KEY = "phase2_migration_completed"
MIGRATION_TIMESTAMP_KEY = "phase2_migration_timestamp"


def is_migration_completed() -> bool:
    """
    Check if Phase 2 migration has already been completed.
    
    Returns True if migration is done, False otherwise.
    """
    try:
        # Check Firestore for migration flag
        db = firestore.client()
        config_doc = db.collection("system_config").document("migration_status")
        config = config_doc.get()
        
        if config.exists:
            data = config.to_dict()
            completed = data.get(MIGRATION_FLAG_KEY, False)
            timestamp = data.get(MIGRATION_TIMESTAMP_KEY)
            
            if completed:
                print(f"[AutoMigration] Migration already completed on {timestamp}")
                return True
        
        return False
        
    except Exception as e:
        print(f"[AutoMigration] Error checking migration status: {e}")
        return False


def mark_migration_completed():
    """
    Mark Phase 2 migration as completed in Firestore.
    """
    try:
        db = firestore.client()
        config_doc = db.collection("system_config").document("migration_status")
        
        config_doc.set({
            MIGRATION_FLAG_KEY: True,
            MIGRATION_TIMESTAMP_KEY: datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }, merge=True)
        
        print(f"[AutoMigration] Migration marked as completed")
        return True
        
    except Exception as e:
        print(f"[AutoMigration] Error marking migration completed: {e}")
        return False


def ensure_migration_completed():
    """
    Ensure Phase 2 migration is completed. If not, run it automatically.
    
    This function can be called at the start of any Cloud Function that
    depends on Phase 2 infrastructure.
    
    Returns True if migration is complete, False if it failed.
    """
    # Check if already done
    if is_migration_completed():
        return True
    
    print("[AutoMigration] Migration not completed yet, starting...")
    
    # Import the migration function
    try:
        from migrate_to_supabase_primary import migrate_firestore_to_supabase
        
        # Run migration
        success = migrate_firestore_to_supabase()
        
        if success:
            # Mark as completed
            mark_migration_completed()
            print("[AutoMigration] Automatic migration completed successfully")
            return True
        else:
            print("[AutoMigration] Automatic migration failed")
            return False
            
    except Exception as e:
        print(f"[AutoMigration] Error running automatic migration: {e}")
        import traceback
        traceback.print_exc()
        return False


def is_supabase_phase2_ready() -> bool:
    """
    Check if Supabase Phase 2 tables are ready.
    
    Returns True if speaker_embeddings table exists, False otherwise.
    """
    try:
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("[AutoMigration] Supabase credentials not configured")
            return False
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Try to query speaker_embeddings table
        test_result = supabase.table("speaker_embeddings").select("id").limit(1).execute()
        
        print("[AutoMigration] Supabase Phase 2 tables are ready")
        return True
        
    except Exception as e:
        print(f"[AutoMigration] Supabase Phase 2 not ready: {e}")
        return False


def get_migration_status() -> dict:
    """
    Get the current status of Phase 2 migration.
    
    Returns a dict with status information:
    - migration_completed: bool
    - migration_timestamp: str or None
    - supabase_ready: bool
    - firestore_migration_flag: bool
    """
    status = {
        "migration_completed": False,
        "migration_timestamp": None,
        "supabase_ready": False,
        "firestore_migration_flag": False
    }
    
    # Check Firestore flag
    try:
        db = firestore.client()
        config_doc = db.collection("system_config").document("migration_status")
        config = config_doc.get()
        
        if config.exists:
            data = config.to_dict()
            status["firestore_migration_flag"] = data.get(MIGRATION_FLAG_KEY, False)
            status["migration_timestamp"] = data.get(MIGRATION_TIMESTAMP_KEY)
            status["migration_completed"] = status["firestore_migration_flag"]
    except:
        pass
    
    # Check Supabase readiness
    status["supabase_ready"] = is_supabase_phase2_ready()
    
    return status


# Decorator for automatic migration
def auto_migrate(func):
    """
    Decorator that ensures Phase 2 migration is completed before running the function.
    
    Usage:
        @auto_migrate
        @https_fn.on_request(...)
        def my_function(req):
            # Function logic here
            pass
    """
    def wrapper(*args, **kwargs):
        # Ensure migration is complete
        if not ensure_migration_completed():
            print("[AutoMigration] Warning: Migration not completed, function may not work correctly")
        
        # Call the original function
        return func(*args, **kwargs)
    
    return wrapper