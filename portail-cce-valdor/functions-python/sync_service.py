import os
import json
from datetime import datetime
from typing import List, Union, Optional

def sync_embedding_to_supabase(member_name: str, embedding_data: Union[List[float], List[List[float]], str], member_id: str = "", sample_source: str = "ml_auto") -> bool:
    """
    Synchronize a member's embedding to Supabase speaker_embeddings table (Phase 2).
    
    Called after any embedding update (apply_ai_suggestion, closed_feedback_loop,
    autonomous_ml_loop, active_learning) to keep Supabase in sync with Firestore.
    
    PHASE 2 STRATEGY: Store each embedding as a separate row in speaker_embeddings.
    The centroid is automatically maintained by the PostgreSQL function insert_speaker_embedding.
    
    Args:
        member_name: Display name of the member
        embedding_data: The embedding (list of floats or list of list of floats)
        member_id: Optional Firestore member ID for logging
        sample_source: Source of the embedding (enrollment, correction, ml_auto, batch_import)
    """
    try:
        from supabase import create_client
        from firebase_admin import firestore
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("[SupabaseSync Phase 2] SUPABASE_URL or SUPABASE_KEY not configured, skipping sync")
            return False
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Normalize embedding: Parse if string
        if isinstance(embedding_data, str):
            try:
                embedding_data = json.loads(embedding_data)
            except (json.JSONDecodeError, ValueError):
                print(f"[SupabaseSync Phase 2] Failed to parse embedding string for {member_name}")
                return False
        
        if not embedding_data or not isinstance(embedding_data, list):
            print(f"[SupabaseSync Phase 2] No valid embedding for {member_name}")
            return False
        
        # Vérifier si la table speaker_embeddings existe (Phase 2 déployée?)
        try:
            # Test d'accès à speaker_embeddings
            test_result = supabase.table("speaker_embeddings").select("id").limit(1).execute()
            speaker_embeddings_available = True
        except:
            speaker_embeddings_available = False
            print(f"[SupabaseSync Phase 2] speaker_embeddings table not available, using fallback")
        
        if not speaker_embeddings_available:
            # FALLBACK: Utiliser l'ancienne méthode (table speakers avec centroid)
            return sync_embedding_to_supabase_fallback(member_name, embedding_data, member_id)
        
        # Lookup speaker_id from speakers table to link the embedding
        speaker_id = None
        try:
            # Verify if speaker exists in 'speakers' table
            speaker_res = supabase.table("speakers").select("id").eq("name", member_name).limit(1).execute()
            if speaker_res.data:
                speaker_id = speaker_res.data[0]["id"]
            else:
                # PHASE 2 FIX: Auto-create speaker if missing (e.g. table cleared)
                try:
                    print(f"[SupabaseSync Phase 2] Speaker '{member_name}' not found. Creating...")
                    role = "member" # Default
                    
                    # Try to fetch role from Firestore if member_id is provided
                    # NOTE: We need a firestore client here. 
                    # To avoid creating too many clients, we try to use the global one if available or create new.
                    try:
                         db = firestore.client()
                         if member_id:
                            m_doc = db.collection("members").document(member_id).get()
                            if m_doc.exists:
                                role = m_doc.to_dict().get("role", "member")
                    except Exception as fb_err:
                        print(f"[SupabaseSync Phase 2] Failed to fetch role from Firestore: {fb_err}")
                    
                    new_speaker = {
                        "name": member_name,
                        "role": role,
                        "created_at": datetime.now().isoformat()
                    }
                    
                    sp_new = supabase.table("speakers").insert(new_speaker).execute()
                    if sp_new.data:
                        speaker_id = sp_new.data[0]["id"]
                        print(f"[SupabaseSync Phase 2] Created new speaker '{member_name}' (ID: {speaker_id})")
                    else:
                        print(f"[SupabaseSync Phase 2] Failed to create speaker '{member_name}'")
                except Exception as create_err:
                    print(f"[SupabaseSync Phase 2] Error creating speaker: {create_err}")
        except Exception as e:
            print(f"[SupabaseSync Phase 2] Error looking up speaker_id: {e}")

        # PHASE 2: Insérer dans speaker_embeddings (multi-rows)
        # Insertion avec speaker_id si trouvé (sinon NULL)
        # Si embedding_data est une liste de vecteurs, insérer chaque vecteur séparément
        if isinstance(embedding_data[0], list) and isinstance(embedding_data[0][0], (int, float)):
            # Liste de vecteurs: insérer chacun
            vectors = embedding_data
            inserted_count = 0
            for vec in vectors:
                # Accepter dimensions 512 ou 768 (Modal peut retourner 512)
                if len(vec) in [512, 768]:  # Dimensions acceptées
                    try:
                        result = supabase.table("speaker_embeddings").insert({
                            "speaker_name": member_name,
                            "speaker_id": speaker_id,  # Linked ID or NULL
                            "embedding": vec,
                            "sample_source": sample_source,
                            "created_at": datetime.now().isoformat(),
                            "metadata": json.dumps({
                                "firestore_member_id": member_id,
                                "migration_timestamp": datetime.now().isoformat()
                            })
                        }).execute()
                        inserted_count += 1
                    except Exception as e:
                        print(f"[SupabaseSync Phase 2] Error inserting for {member_name}: {e}")
                else:
                    print(f"[SupabaseSync Phase 2] Warning: Embedding dimension {len(vec)} not expected (512 or 768) for {member_name}")
            print(f"[SupabaseSync Phase 2] Inserted {inserted_count}/{len(vectors)} embeddings for {member_name} (ID: {speaker_id})")
            
        elif isinstance(embedding_data[0], (int, float)):
            # Vecteur unique
            if len(embedding_data) in [512, 768]:
                try:
                    result = supabase.table("speaker_embeddings").insert({
                        "speaker_name": member_name,
                        "speaker_id": speaker_id,  # Linked ID or NULL
                        "embedding": embedding_data,
                        "sample_source": sample_source,
                        "created_at": datetime.now().isoformat(),
                        "metadata": json.dumps({
                            "firestore_member_id": member_id,
                            "migration_timestamp": datetime.now().isoformat()
                        })
                    }).execute()
                    print(f"[SupabaseSync Phase 2] Inserted 1 embedding for {member_name} (ID: {speaker_id})")
                except Exception as e:
                    print(f"[SupabaseSync Phase 2] Error inserting for {member_name}: {e}")
                    # import traceback
                    # traceback.print_exc()
                    return False
            else:
                print(f"[SupabaseSync Phase 2] Warning: Embedding dimension {len(embedding_data)} not expected (512 or 768) for {member_name}")
                return False
        else:
            print(f"[SupabaseSync Phase 2] Invalid embedding format for {member_name}")
            return False
        
        # Nettoyer les anciens embeddings si trop nombreux (garder max 20 par speaker)
        try:
            # Compter les embeddings actuels
            count_result = supabase.table("speaker_embeddings").select("id", count="exact").eq("speaker_name", member_name).execute()
            count = count_result.count if hasattr(count_result, 'count') else len(count_result.data)
            
            if count > 20:
                # Récupérer tous les embeddings ordonnés par date
                all_result = supabase.table("speaker_embeddings").select("id").eq("speaker_name", member_name).order("created_at", desc=True).execute()
                ids_to_keep = [row["id"] for row in all_result.data[:20]]
                ids_to_delete = [row["id"] for row in all_result.data[20:]]
                
                for id_to_delete in ids_to_delete:
                    supabase.table("speaker_embeddings").delete().eq("id", id_to_delete).execute()
                
                print(f"[SupabaseSync Phase 2] Cleaned up {len(ids_to_delete)} old embeddings for {member_name}")
        except Exception as e:
            print(f"[SupabaseSync Phase 2] Cleanup error (non-fatal): {e}")
        
        return True
        
    except Exception as e:
        print(f"[SupabaseSync Phase 2] Error syncing {member_name}: {e}")
        import traceback
        traceback.print_exc()
        return False


def sync_embedding_to_supabase_fallback(member_name: str, embedding_data: Union[List[float], List[List[float]], str], member_id: str = "") -> bool:
    """
    FALLBACK VERSION: Sync to old Supabase speakers table (Phase 1).
    
    Used when speaker_embeddings table is not yet available.
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("[SupabaseSync Fallback] SUPABASE_URL or SUPABASE_KEY not configured")
            return False
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Normalize embedding: Compute centroid if multi-vector
        if isinstance(embedding_data, str):
            try:
                embedding_data = json.loads(embedding_data)
            except (json.JSONDecodeError, ValueError):
                return False
        
        if not embedding_data or not isinstance(embedding_data, list):
            return False
        
        # If it's a list of vectors, compute centroid
        embedding_for_supabase = []
        if isinstance(embedding_data[0], list):
            num_vectors = len(embedding_data)
            dim = len(embedding_data[0])
            centroid = [0.0] * dim
            for vec in embedding_data:
                if len(vec) == dim:
                    for i in range(dim):
                        centroid[i] += vec[i]
            centroid = [v / num_vectors for v in centroid]
            embedding_for_supabase = centroid
        else:
            embedding_for_supabase = embedding_data
        
        # Check if speaker exists
        existing = supabase.table("speakers").select("id, name").eq("name", member_name).execute()
        
        if existing.data and len(existing.data) > 0:
            speaker_id = existing.data[0]["id"]
            supabase.table("speakers").update({
                "embedding": embedding_for_supabase,
                "updated_at": datetime.now().isoformat(),
            }).eq("id", speaker_id).execute()
            print(f"[SupabaseSync Fallback] Updated speaker '{member_name}'")
        else:
            supabase.table("speakers").insert({
                "name": member_name,
                "embedding": embedding_for_supabase,
                "created_at": datetime.now().isoformat(),
            }).execute()
            print(f"[SupabaseSync Fallback] Inserted speaker '{member_name}'")
        
        return True
        
    except Exception as e:
        print(f"[SupabaseSync Fallback] Error: {e}")
        return False
