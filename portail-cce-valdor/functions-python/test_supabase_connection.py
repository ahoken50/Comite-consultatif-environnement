"""
Test Supabase Connection and RPC
"""

import os
from supabase import create_client

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")

print(f"SUPABASE_URL: {supabase_url}")
print(f"SUPABASE_KEY: {supabase_key[:20]}...")

supabase = create_client(supabase_url, supabase_key)

# Test 1: Check if speaker_embeddings table exists
print("\n=== Test 1: Check speaker_embeddings table ===")
try:
    result = supabase.table("speaker_embeddings").select("id").limit(1).execute()
    print(f"✓ speaker_embeddings table accessible")
except Exception as e:
    print(f"✗ speaker_embeddings table error: {e}")

# Test 2: Check if speakers table exists
print("\n=== Test 2: Check speakers table ===")
try:
    result = supabase.table("speakers").select("id").limit(1).execute()
    print(f"✓ speakers table accessible")
    print(f"  Total speakers: {len(result.data)}")
except Exception as e:
    print(f"✗ speakers table error: {e}")

# Test 3: Check if insert_speaker_embedding function exists
print("\n=== Test 3: Check insert_speaker_embedding RPC function ===")
try:
    result = supabase.rpc("insert_speaker_embedding", {
        "p_speaker_name": "Test_Speaker",
        "p_embedding": [0.1] * 768,
        "p_sample_source": "test"
    }).execute()
    print(f"✓ RPC function works")
    print(f"  Result: {result.data}")
except Exception as e:
    print(f"✗ RPC function error: {e}")

# Test 4: Try direct insert (should fail without speaker_id)
print("\n=== Test 4: Direct insert (should fail) ===")
try:
    result = supabase.table("speaker_embeddings").insert({
        "speaker_name": "Test_Direct",
        "embedding": [0.1] * 768,
        "sample_source": "test"
    }).execute()
    print(f"✓ Direct insert works (unexpected!)")
    print(f"  Result: {result.data}")
except Exception as e:
    print(f"✗ Direct insert failed (expected): {e}")

print("\n=== Tests Complete ===")