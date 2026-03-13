import os
import sys

# Setup environment
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "functions-python/serviceAccountKey.json"
sys.path.append("functions-python")

from supabase_embeddings import supabase
from firebase_admin import credentials, firestore, initialize_app

names_to_clean = ["Michaël Ross", "Donald ratté", "Donald Ratté"]

print(f"Cleaning Supabase and Firestore for: {names_to_clean}")

# 1. Clean Supabase (Vector DB)
try:
    res = supabase.table("speaker_embeddings").delete().in_("speaker_name", names_to_clean).execute()
    print(f"✅ Supabase clean successful.")
except Exception as e:
    print(f"❌ Error cleaning Supabase: {e}")

# 2. Clean Firestore (Counters)
try:
    initialize_app()
    db = firestore.client()
    
    # We must do individual updates because 'in' limits to 10 and we don't know the exact case
    members_ref = db.collection("members").where("displayName", "in", names_to_clean).stream()
    
    count = 0
    for doc in members_ref:
        doc.reference.update({"voiceSampleCount": 0})
        count += 1
        print(f"  Reset counter for: {doc.to_dict().get('displayName')}")
        
    print(f"✅ Firestore clean successful. Resetted {count} members.")
    
except Exception as e:
    print(f"❌ Error cleaning Firestore: {e}")
