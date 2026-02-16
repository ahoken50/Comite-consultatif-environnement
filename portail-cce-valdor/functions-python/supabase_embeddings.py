"""
supabase_embeddings.py — Centralized Supabase embedding operations.

Supabase is the PRIMARY and SOLE storage for voice embeddings.
Firestore is used only for member metadata (displayName, role, etc.).
"""

import os
import json
from datetime import datetime
from typing import List, Optional, Dict, Any


def _get_supabase_client():
    """Lazy-initialize a Supabase client."""
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY not configured")
    return create_client(url, key)


def _ensure_speaker(supabase, speaker_name: str, member_id: str = "") -> Optional[str]:
    """Ensure speaker exists in the speakers table, return speaker_id."""
    try:
        res = supabase.table("speakers").select("id").eq("name", speaker_name).limit(1).execute()
        if res.data:
            return res.data[0]["id"]
        
        # Create new speaker
        from firebase_admin import firestore
        role = "member"
        if member_id:
            try:
                db = firestore.client()
                m_doc = db.collection("members").document(member_id).get()
                if m_doc.exists:
                    role = m_doc.to_dict().get("role", "member")
            except Exception:
                pass
        
        new_res = supabase.table("speakers").insert({
            "name": speaker_name,
            "role": role,
            "created_at": datetime.now().isoformat()
        }).execute()
        if new_res.data:
            speaker_id = new_res.data[0]["id"]
            print(f"[SupabaseEmb] Created speaker '{speaker_name}' (ID: {speaker_id})")
            return speaker_id
    except Exception as e:
        print(f"[SupabaseEmb] Error ensuring speaker: {e}")
    return None


def add_embedding(
    speaker_name: str,
    embedding_vec: List[float],
    member_id: str = "",
    sample_source: str = "ml_auto",
) -> bool:
    """
    Insert a SINGLE embedding vector for a speaker into Supabase.
    Does NOT delete existing embeddings — just appends.
    Caps total at 20 per speaker (removes oldest if over).
    """
    if not embedding_vec or len(embedding_vec) not in [512, 768]:
        print(f"[SupabaseEmb] Invalid dimension {len(embedding_vec) if embedding_vec else 0}")
        return False

    try:
        print(f"[SupabaseEmb] add_embedding called: speaker='{speaker_name}', dim={len(embedding_vec)}, source={sample_source}")
        supabase = _get_supabase_client()
        speaker_id = _ensure_speaker(supabase, speaker_name, member_id)

        supabase.table("speaker_embeddings").insert({
            "speaker_name": speaker_name,
            "speaker_id": speaker_id,
            "embedding": embedding_vec,
            "sample_source": sample_source,
            "created_at": datetime.now().isoformat(),
            "metadata": json.dumps({
                "firestore_member_id": member_id,
                "timestamp": datetime.now().isoformat()
            })
        }).execute()

        # Cap at 20: remove oldest if over
        _cap_embeddings(supabase, speaker_name, max_count=20)

        print(f"[SupabaseEmb] Added 1 embedding for '{speaker_name}' (source: {sample_source})")
        return True
    except Exception as e:
        print(f"[SupabaseEmb] Error adding embedding for {speaker_name}: {e}")
        return False


def add_embeddings(
    speaker_name: str,
    vectors: List[List[float]],
    member_id: str = "",
    sample_source: str = "ml_auto",
) -> int:
    """
    Replace ALL embeddings for a speaker with the given list.
    Deletes existing, then inserts new ones (capped at 20).
    Returns number of inserted vectors.
    """
    try:
        supabase = _get_supabase_client()
        speaker_id = _ensure_speaker(supabase, speaker_name, member_id)

        # Delete all existing
        existing = supabase.table("speaker_embeddings").select("id").eq("speaker_name", speaker_name).execute()
        if existing.data:
            for row in existing.data:
                supabase.table("speaker_embeddings").delete().eq("id", row["id"]).execute()
            print(f"[SupabaseEmb] Cleared {len(existing.data)} old embeddings for '{speaker_name}'")

        # Cap at 20 most recent
        if len(vectors) > 20:
            vectors = vectors[-20:]

        inserted = 0
        for vec in vectors:
            if len(vec) in [512, 768]:
                try:
                    supabase.table("speaker_embeddings").insert({
                        "speaker_name": speaker_name,
                        "speaker_id": speaker_id,
                        "embedding": vec,
                        "sample_source": sample_source,
                        "created_at": datetime.now().isoformat(),
                        "metadata": json.dumps({
                            "firestore_member_id": member_id,
                            "timestamp": datetime.now().isoformat()
                        })
                    }).execute()
                    inserted += 1
                except Exception as e:
                    print(f"[SupabaseEmb] Insert error: {e}")

        print(f"[SupabaseEmb] Inserted {inserted}/{len(vectors)} embeddings for '{speaker_name}'")
        return inserted
    except Exception as e:
        print(f"[SupabaseEmb] Error in add_embeddings for {speaker_name}: {e}")
        return 0


def get_embeddings(speaker_name: str) -> List[List[float]]:
    """
    Retrieve all embedding vectors for a speaker from Supabase.
    Returns list of vectors (list of lists of floats).
    """
    try:
        supabase = _get_supabase_client()
        res = supabase.table("speaker_embeddings").select("embedding").eq(
            "speaker_name", speaker_name
        ).order("created_at", desc=False).execute()

        vectors = []
        for row in res.data:
            emb = row.get("embedding")
            if isinstance(emb, str):
                emb = json.loads(emb)
            if isinstance(emb, list) and len(emb) > 0:
                vectors.append(emb)
        return vectors
    except Exception as e:
        print(f"[SupabaseEmb] Error getting embeddings for {speaker_name}: {e}")
        return []


def get_embedding_count(speaker_name: str) -> int:
    """Get the number of embeddings for a speaker."""
    try:
        supabase = _get_supabase_client()
        res = supabase.table("speaker_embeddings").select("id", count="exact").eq(
            "speaker_name", speaker_name
        ).execute()
        return res.count if hasattr(res, 'count') and res.count else len(res.data)
    except Exception:
        return 0


def remove_similar_embeddings(
    speaker_name: str,
    target_vec: List[float],
    threshold: float = 0.92,
) -> int:
    """
    Remove embeddings for a speaker that are too similar to target_vec.
    Used to remove wrong embeddings during corrections.
    Returns number removed.
    """
    try:
        from speaker_identification import cosine_similarity
        supabase = _get_supabase_client()

        res = supabase.table("speaker_embeddings").select("id, embedding").eq(
            "speaker_name", speaker_name
        ).execute()

        removed = 0
        for row in res.data:
            emb = row.get("embedding")
            if isinstance(emb, str):
                emb = json.loads(emb)
            if isinstance(emb, list) and len(emb) == len(target_vec):
                sim = cosine_similarity(emb, target_vec)
                if sim > threshold:
                    supabase.table("speaker_embeddings").delete().eq("id", row["id"]).execute()
                    removed += 1
                    print(f"[SupabaseEmb] Removed similar embedding (sim={sim:.3f}) for '{speaker_name}'")

        return removed
    except Exception as e:
        print(f"[SupabaseEmb] Error removing similar embeddings: {e}")
        return 0


def is_duplicate(speaker_name: str, new_vec: List[float], threshold: float = 0.95) -> bool:
    """Check if new_vec is too similar to any existing embedding for this speaker."""
    try:
        from speaker_identification import cosine_similarity
        existing = get_embeddings(speaker_name)
        for vec in existing:
            if len(vec) == len(new_vec):
                sim = cosine_similarity(vec, new_vec)
                if sim > threshold:
                    return True
        return False
    except Exception:
        return False


def update_with_correction(
    speaker_name: str,
    correct_vec: List[float],
    member_id: str = "",
    wrong_speaker_name: str = "",
    wrong_vec: Optional[List[float]] = None,
    correction_weight: int = 2,
) -> Dict[str, Any]:
    """
    Full correction flow:
    1. Remove wrong embeddings from wrong speaker (if provided)
    2. Check for duplicates
    3. Add correct embedding with weight (multiple copies)
    4. Cap at 20

    Returns dict with success status and metadata.
    """
    result = {"success": False, "newSampleCount": 0, "removedWrong": False}

    if not correct_vec:
        result["message"] = "No embedding provided"
        return result

    try:
        print(f"[SupabaseEmb] update_with_correction called: speaker='{speaker_name}', dim={len(correct_vec)}, wrong='{wrong_speaker_name}', weight={correction_weight}")
        # Step 1: Remove wrong embedding from wrong speaker
        removed = 0
        if wrong_vec and wrong_speaker_name:
            removed = remove_similar_embeddings(wrong_speaker_name, wrong_vec, threshold=0.92)
            result["removedWrong"] = removed > 0

        # Step 2: Check for duplicates
        if is_duplicate(speaker_name, correct_vec, threshold=0.95):
            count = get_embedding_count(speaker_name)
            result["success"] = True
            result["newSampleCount"] = count
            result["message"] = f"Duplicate embedding — profile unchanged ({count} samples)"
            return result

        # Step 3: Add correct embedding with weight
        for _ in range(correction_weight):
            add_embedding(speaker_name, correct_vec, member_id, sample_source="correction")

        count = get_embedding_count(speaker_name)
        result["success"] = True
        result["newSampleCount"] = count
        result["message"] = f"Profile updated ({count} samples, {removed} wrong removed)"

        print(f"[SupabaseEmb] Correction applied for '{speaker_name}': +{correction_weight} embeddings, -{removed} wrong")
        return result

    except Exception as e:
        print(f"[SupabaseEmb] Correction error: {e}")
        result["message"] = str(e)
        return result


def _cap_embeddings(supabase, speaker_name: str, max_count: int = 20):
    """Remove oldest embeddings if over the cap."""
    try:
        all_res = supabase.table("speaker_embeddings").select("id").eq(
            "speaker_name", speaker_name
        ).order("created_at", desc=True).execute()

        if len(all_res.data) > max_count:
            to_delete = all_res.data[max_count:]
            for row in to_delete:
                supabase.table("speaker_embeddings").delete().eq("id", row["id"]).execute()
            print(f"[SupabaseEmb] Capped: removed {len(to_delete)} oldest for '{speaker_name}'")
    except Exception as e:
        print(f"[SupabaseEmb] Cap error: {e}")
