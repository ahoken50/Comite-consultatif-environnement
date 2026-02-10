"""
Migration Status and Control Endpoint

Provides a REST API to check migration status and trigger migration manually.
"""

from firebase_functions import https_fn, options
import json
from datetime import datetime


@https_fn.on_request(
    timeout_sec=60,
    memory=options.MemoryOption.MB_128,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def api_get_migration_status(req: https_fn.Request) -> https_fn.Response:
    """
    Get the current status of Phase 2 migration (REST API endpoint).
    
    Usage:
        curl https://us-central1-comite-cce.cloudfunctions.net/api_get_migration_status
    
    Returns:
        {
            "migration_completed": bool,
            "migration_timestamp": str|null,
            "supabase_ready": bool,
            "firestore_migration_flag": bool
        }
    """
    if req.method != "GET":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed. Use GET."}),
            status=405,
            content_type="application/json"
        )
    
    try:
        from auto_migration import get_migration_status
        status = get_migration_status()
        
        return https_fn.Response(
            json.dumps({
                "success": True,
                "status": status,
                "timestamp": datetime.now().isoformat()
            }),
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


@https_fn.on_request(
    timeout_sec=300,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["GET", "POST", "OPTIONS"])
)
def trigger_manual_migration(req: https_fn.Request) -> https_fn.Response:
    """
    Manually trigger Phase 2 migration.
    
    Usage:
        curl -X POST https://us-central1-comite-cce.cloudfunctions.net/trigger_manual_migration
    
    Returns:
        {
            "success": bool,
            "message": str,
            "migration_stats": {...}
        }
    """
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed. Use POST."}),
            status=405,
            content_type="application/json"
        )
    
    try:
        # Check if already completed
        from auto_migration import is_migration_completed
        if is_migration_completed():
            return https_fn.Response(
                json.dumps({
                    "success": True,
                    "message": "Migration already completed",
                    "timestamp": datetime.now().isoformat()
                }),
                status=200,
                content_type="application/json"
            )
        
        # Run migration
        from auto_migration import ensure_migration_completed
        success = ensure_migration_completed()
        
        if success:
            # Get stats
            from supabase import create_client
            import os
            supabase = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY"))
            count_result = supabase.table("speaker_embeddings").select("speaker_name", count="exact").execute()
            total_embeddings = count_result.count if hasattr(count_result, 'count') else len(count_result.data)
            
            return https_fn.Response(
                json.dumps({
                    "success": True,
                    "message": "Migration completed successfully",
                    "migration_stats": {
                        "total_embeddings": total_embeddings
                    },
                    "timestamp": datetime.now().isoformat()
                }),
                status=200,
                content_type="application/json"
            )
        else:
            return https_fn.Response(
                json.dumps({
                    "success": False,
                    "message": "Migration failed. Check logs for details.",
                    "timestamp": datetime.now().isoformat()
                }),
                status=500,
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


@https_fn.on_request(
    timeout_sec=60,
    memory=options.MemoryOption.MB_128,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "OPTIONS"])
)
def reset_migration_flag(req: https_fn.Request) -> https_fn.Response:
    """
    Reset the migration flag (for testing or re-running migration).
    
    ⚠️ WARNING: This will allow migration to run again.
    
    Usage:
        curl -X POST https://us-central1-comite-cce.cloudfunctions.net/reset_migration_flag
    """
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed. Use POST."}),
            status=405,
            content_type="application/json"
        )
    
    try:
        from firebase_admin import firestore
        from auto_migration import MIGRATION_FLAG_KEY, MIGRATION_TIMESTAMP_KEY
        
        db = firestore.client()
        config_doc = db.collection("system_config").document("migration_status")
        
        config_doc.set({
            MIGRATION_FLAG_KEY: False,
            MIGRATION_TIMESTAMP_KEY: None,
            "updated_at": datetime.now().isoformat()
        }, merge=True)
        
        return https_fn.Response(
            json.dumps({
                "success": True,
                "message": "Migration flag reset. Migration can now run again.",
                "timestamp": datetime.now().isoformat()
            }),
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