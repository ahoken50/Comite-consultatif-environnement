import os
import json
from typing import List, Dict, Optional

def match_speakers_with_pgvector(segment_embedding: List[float], match_threshold: float = 0.5, limit: int = 5) -> List[Dict]:
    """
    Find matching speakers using Supabase pgvector (RPC 'match_speakers').
    
    Args:
        segment_embedding: The embedding vector to search for (list of floats)
        match_threshold: Minimum similarity threshold (0.0 to 1.0)
        limit: Maximum number of matches to return
        
    Returns:
        List of matching speakers with similarity scores.
        Example: [{'id': '...', 'speaker_name': 'Jean', 'similarity': 0.85}]
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            print("[PGVector] SUPABASE_URL or SUPABASE_KEY not configured")
            return []
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Ensure embedding is a flat list of floats
        if not segment_embedding or not isinstance(segment_embedding, list):
            print("[PGVector] Invalid embedding format")
            return []
            
        # The RPC function expects 'query_embedding'
        rpc_params = {
            "query_embedding": segment_embedding,
            "match_threshold": match_threshold,
            "match_count": limit
        }
        
        # Call the PostgreSQL function
        response = supabase.rpc("match_speakers", rpc_params).execute()
        
        if response.data:
            print(f"[PGVector] Found {len(response.data)} matches (> {match_threshold})")
            return response.data
        else:
            print("[PGVector] No matches found")
            return []
            
    except Exception as e:
        print(f"[PGVector] Error executing match_speakers: {e}")
        # Fallback to empty list so we can degrade gracefully to other strategies
        return []
