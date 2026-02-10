"""
Cloud Function pour vider la table Supabase speakers.

Usage unique pour nettoyer les embeddings obsolètes avant de recommencer
avec le nouveau système de synchronisation Firestore ↔ Supabase.

Déploiement:
    firebase deploy --only functions:clear_supabase_speakers

Appel:
    curl -X POST https://us-central1-comite-cce.cloudfunctions.net/clear_supabase_speakers
"""

import os
from firebase_functions import https_fn, options
import json


@https_fn.on_request(
    timeout_sec=60,
    memory=options.MemoryOption.MB_256,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "OPTIONS"])
)
def clear_supabase_speakers(req: https_fn.Request) -> https_fn.Response:
    """
    Vide complètement la table Supabase speakers.
    
    ATTENTION: Cette opération est IRRÉVERSIBLE.
    Tous les embeddings dans Supabase seront supprimés.
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            return https_fn.Response(
                json.dumps({"error": "SUPABASE_URL or SUPABASE_KEY not configured"}),
                status=500,
                content_type="application/json"
            )
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Récupérer tous les speakers
        all_speakers = supabase.table("speakers").select("id, name").execute()
        
        if not all_speakers.data:
            return https_fn.Response(
                json.dumps({
                    "success": True,
                    "message": "Table speakers déjà vide",
                    "deleted": 0
                }),
                status=200,
                content_type="application/json"
            )
        
        # Supprimer tous les speakers
        deleted_count = 0
        deleted_names = []
        
        for speaker in all_speakers.data:
            speaker_id = speaker["id"]
            speaker_name = speaker.get("name", "Unknown")
            
            supabase.table("speakers").delete().eq("id", speaker_id).execute()
            deleted_count += 1
            deleted_names.append(speaker_name)
            print(f"[ClearSupabase] Deleted speaker: {speaker_name} (id={speaker_id})")
        
        return https_fn.Response(
            json.dumps({
                "success": True,
                "message": f"Table speakers vidée avec succès",
                "deleted": deleted_count,
                "names": deleted_names
            }),
            status=200,
            content_type="application/json"
        )
        
    except Exception as e:
        print(f"[ClearSupabase] Error: {e}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )