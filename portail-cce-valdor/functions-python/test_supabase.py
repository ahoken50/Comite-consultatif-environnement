import os
from dotenv import load_dotenv
from collections import Counter

# Load environment variables
load_dotenv(".env")

from supabase_embeddings import _get_supabase_client

try:
    print("Testing SUPABASE URL:", os.environ.get("SUPABASE_URL"))
    
    supabase = _get_supabase_client()
    print("\nFetching all embeddings...")
    # Fetch all records, just the speaker_name column
    # Since there might be more than 1000, we might need pagination if it's large, but let's try 1000 first.
    res = supabase.table("speaker_embeddings").select("speaker_name").limit(2000).execute()
    
    if res.data:
        counts = Counter([row['speaker_name'] for row in res.data])
        print(f"Total embeddings found: {len(res.data)}")
        print("\nEmbeddings per speaker:")
        for name, count in sorted(counts.items(), key=lambda x: x[1], reverse=True):
            print(f"- {name}: {count} vectors")
    else:
        print("No embeddings found in the database.")
        
except Exception as e:
    print(f"\nError connecting to Supabase: {e}")
