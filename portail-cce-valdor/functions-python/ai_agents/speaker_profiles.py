import os
import time
import json
import requests
from datetime import timedelta, datetime
from firebase_admin import firestore, storage
from core.firebase_init import db, bucket
from core.config import get_openai_client, get_anthropic_client
from ai_agents.transcription import format_timestamp, clean_hallucinations, build_context_prompt
from audio_utils import extract_audio_segment_embedding
from auto_migration import ensure_migration_completed

# =============================================================================
# SPEAKER IDENTIFICATION - Multi-Strategy System
# =============================================================================

def get_enrolled_speakers() -> list:
    """
    Fetch all enrolled speakers with their embeddings.
    
    PHASE 2 APPROACH: Primary source is Supabase speaker_embeddings table.
    Fallback to Firestore members only if Supabase is unavailable.
    
    AUTO-MIGRATION: If Supabase Phase 2 is not ready but credentials exist,
    automatically run migration on first call.
    """
    speakers = []
    speaker_names_seen = set()
    
    # === CHECK: Is Supabase Phase 2 ready? ===
    supabase_phase2_ready = False
    from supabase import create_client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    
    if supabase_url and supabase_key:
        supabase = create_client(supabase_url, supabase_key)
        try:
            # Test if speaker_embeddings table exists
            test_result = supabase.table("speaker_embeddings").select("id").limit(1).execute()
            supabase_phase2_ready = True
        except:
            # Phase 2 not deployed yet
            print("[Speakers Phase 2] Supabase Phase 2 tables not found")
            
            # Try auto-migration
            print("[Speakers Phase 2] Attempting auto-migration...")
            try:
                migration_success = ensure_migration_completed()
                if migration_success:
                    # Retry loading speakers after migration
                    print("[Speakers Phase 2] Auto-migration successful, reloading...")
                    supabase_phase2_ready = True
                else:
                    print("[Speakers Phase 2] Auto-migration failed, using fallback")
            except Exception as e:
                print(f"[Speakers Phase 2] Auto-migration error: {e}")
    
    # === SOURCE 1: Supabase speaker_embeddings (PRIMARY — Phase 2) ===
    if supabase_phase2_ready:
        try:
            # Récupérer tous les embeddings groupés par speaker
            result = supabase.table("speaker_embeddings").select(
                "speaker_name, speaker_id, embedding, sample_source, created_at"
            ).execute()
            
            if result.data:
                # Grouper les embeddings par speaker
                speaker_embeddings = {}
                for row in result.data:
                    name = row.get("speaker_name")
                    if not name:
                        continue
                    
                    embedding = row.get("embedding")
                    if embedding:
                        if name not in speaker_embeddings:
                            speaker_embeddings[name] = {
                                "embeddings": [],
                                "speaker_id": row.get("speaker_id"),
                                "sample_sources": set()
                            }
                        speaker_embeddings[name]["embeddings"].append(embedding)
                        speaker_embeddings[name]["sample_sources"].add(row.get("sample_source"))
                
                # Construire la liste des speakers
                for name, data in speaker_embeddings.items():
                    speakers.append({
                        "id": data.get("speaker_id", name),
                        "name": name,
                        "embedding": data["embeddings"],  # Liste de vecteurs
                        "source": "supabase",
                        "sampleCount": len(data["embeddings"]),
                        "sample_sources": list(data["sample_sources"])
                    })
                    speaker_names_seen.add(name)
                
                print(f"[Speakers Phase 2] Loaded {len(speakers)} speakers from Supabase speaker_embeddings")
                
                # Récupérer les rôles depuis la table speakers
                speakers_result = supabase.table("speakers").select("id, name, role").execute()
                if speakers_result.data:
                    role_map = {s["name"]: s.get("role", "Membre") for s in speakers_result.data}
                    for speaker in speakers:
                        speaker["role"] = role_map.get(speaker["name"], "Membre")
        
        except Exception as e:
            print(f"[Speakers Phase 2] Supabase error (will fallback to Firestore): {e}")
            import traceback
            traceback.print_exc()
    
    # === SOURCE 2: Firestore members (FALLBACK — only if Supabase unavailable) ===
    if not speakers:
        print(f"[Speakers Phase 2] Supabase unavailable, falling back to Firestore")
        try:
            import json as json_lib
            _db = firestore.client()
            members = list(_db.collection("members").stream())
            
            for doc in members:
                member = doc.to_dict()
                name = member.get("displayName") or member.get("name")
                embedding = member.get("embedding")
                
                if not name or not embedding:
                    continue
                
                # Parse string embedding (stored as JSON string in Firestore)
                if isinstance(embedding, str):
                    try:
                        embedding = json_lib.loads(embedding)
                    except (json.JSONDecodeError, ValueError):
                        continue
                
                if embedding and isinstance(embedding, list):
                    speakers.append({
                        "id": doc.id,
                        "name": name,
                        "embedding": embedding,
                        "role": member.get("role", "Membre"),
                        "source": "firestore",
                        "sampleCount": member.get("voiceSampleCount", 1)
                    })
                    speaker_names_seen.add(name)
                    
            print(f"[Speakers Phase 2] Loaded {len(speakers)} speakers from Firestore (fallback)")
            
        except Exception as e:
            print(f"[Speakers Phase 2] Firestore error (non-fatal): {e}")
    
    print(f"[Speakers Phase 2] Total: {len(speakers)} unique speakers loaded")
    return speakers


def get_meeting_attendees(meeting_id: str) -> list:
    """
    Fetch attendees for a specific meeting from Firestore.
    """
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting = meeting_ref.get()
        
        if meeting.exists:
            data = meeting.to_dict()
            return data.get("attendees", [])
        
        return []
        
    except Exception as e:
        print(f"[Meeting] Error fetching attendees: {e}")
        return []


def compare_embedding_with_speakers(segment_embedding: list, enrolled_speakers: list = None, limit: int = 10) -> dict:
    """
    Match a segment embedding with speakers using pgvector (Phase 2 - Primary).
    
    Uses Supabase's native vector similarity search via SQL function match_speakers().
    Falls back to local computation if Supabase is unavailable.
    
    Returns dict of {name: similarity_score} (0.0 to 1.0)
    """
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        
        if supabase_url and supabase_key:
            supabase = create_client(supabase_url, supabase_key)
            
            # Appeler la fonction SQL match_speakers via RPC
            result = supabase.rpc('match_speakers', {
                'target_embedding': segment_embedding,
                'limit_count': limit
            }).execute()
            
            if result.data:
                scores = {}
                for row in result.data:
                    name = row.get("speaker_name")
                    similarity = row.get("avg_similarity", 0.0)
                    if similarity is not None:
                        raw_sim = float(similarity)
                        # Uniform score mapping with 0.35 raw threshold guard
                        if raw_sim < 0.35:
                            scores[name] = 0.0
                        else:
                            scores[name] = (raw_sim + 1) / 2
                
                print(f"[PGVector] Matched {len(scores)} speakers via pgvector")
                return scores
        
    except Exception as e:
        print(f"[PGVector] Error using pgvector, falling back to local computation: {e}")
    
    # Fallback: calcul local avec les speakers fournis
    if enrolled_speakers:
        return compare_embedding_with_speakers_local(segment_embedding, enrolled_speakers)
    
    return {}


def compare_embedding_with_speakers_local(segment_embedding: list, enrolled_speakers: list) -> dict:
    """
    LOCAL VERSION: Compare a segment embedding with speakers (fallback when pgvector unavailable).
    
    FAIR SCORING: Uses top-3 average per speaker instead of global k-NN.
    This prevents speakers with more samples from being systematically favored.
    
    Returns dict of {name: similarity_score} (0.0 to 1.0)
    """
    from speaker_identification import cosine_similarity
    import json as json_lib

    # 1. Compute similarities PER SPEAKER (fair comparison)
    # {name: [list of similarity scores]}
    speaker_similarities = {}
    
    for speaker in enrolled_speakers:
        stored_embedding = speaker.get("embedding")
        name = speaker.get("name", "Unknown")
        
        # Parse string embedding
        if isinstance(stored_embedding, str):
            try:
                stored_embedding = json_lib.loads(stored_embedding)
            except (json_lib.JSONDecodeError, ValueError):
                continue
                 
        if not stored_embedding:
            continue
            
        vectors = []
        # Handle Multi-Vector or Single Vector
        if isinstance(stored_embedding, list) and len(stored_embedding) > 0 and isinstance(stored_embedding[0], list):
            vectors = stored_embedding
        elif isinstance(stored_embedding, list) and len(stored_embedding) == len(segment_embedding):
            vectors = [stored_embedding]
            
        sims = []
        for vec in vectors:
            if len(vec) == len(segment_embedding):
                sim = cosine_similarity(segment_embedding, vec)
                sims.append(sim)
        
        if sims:
            speaker_similarities[name] = sorted(sims, reverse=True)
    
    if not speaker_similarities:
        return {}
    
    # 2. FAIR SCORING: For each speaker, take the average of their top-3 best matches
    # This ensures a speaker with 12 samples isn't favored over one with 3
    final_scores = {}
    
    for name, sims in speaker_similarities.items():
        # Take top-3 (or fewer if less available)
        top_n = sims[:3]
        
        # Weighted average: best match counts more (50% best, 30% second, 20% third)
        if len(top_n) == 1:
            avg_sim = top_n[0]
        elif len(top_n) == 2:
            avg_sim = top_n[0] * 0.6 + top_n[1] * 0.4
        else:
            avg_sim = top_n[0] * 0.5 + top_n[1] * 0.3 + top_n[2] * 0.2
        
        # Normalize cosine similarity (-1..1) to score (0..1) with a strict 0.35 threshold guard
        if avg_sim < 0.35:
            score = 0.0
        else:
            score = (avg_sim + 1) / 2
        
        # Consistency bonus: if multiple vectors agree, boost confidence
        if len(top_n) >= 3 and all(s > 0.5 for s in top_n):
            score += 0.05  # Small bonus for consistent multi-vector match
            
        # Diversity bonus: if speaker has many samples AND they all score well
        if len(sims) >= 5 and len(top_n) >= 3 and top_n[2] > 0.4:
            score += 0.03  # Robust profile bonus
        
        final_scores[name] = min(score, 1.0)  # Cap at 1.0
    
    # 3. Log comparison for debugging
    sorted_scores = sorted(final_scores.items(), key=lambda x: x[1], reverse=True)
    if sorted_scores:
        top = sorted_scores[0]
        runner = sorted_scores[1] if len(sorted_scores) > 1 else ("N/A", 0)
        margin = top[1] - runner[1]
        print(f"[VoiceEmbed] Top: {top[0]}={top[1]:.3f}, Runner: {runner[0]}={runner[1]:.3f}, Margin: {margin:.3f}")
                 
    return final_scores


async def identify_speakers_in_transcript(
    formatted_output: dict,
    meeting_id: str,
    audio_url: str = None
) -> dict:
    """
    Apply multi-strategy speaker identification to a formatted transcript.
    
    Uses 5 strategies with optimized performance:
    1. Voice Embedding (50%) - Compare with enrolled speakers via Modal
    2. Contextual AI (25%) - GROQ batch analysis
    3. Linguistic Patterns (10%) - Role-based keywords
    4. Name Mentions (10%) - "Merci Michaël" detection
    5. Auto-Identification (5%) - "Je suis X" detection
    
    Returns the same structure but with speaker labels replaced by names.
    """
    import re
    from speaker_identification import (
        linguistic_pattern_strategy,
        name_mention_strategy,
        auto_identification_strategy,
        contextual_ai_strategy,
        fuse_scores
    )
    
    # Get enrolled speakers with embeddings
    enrolled_speakers = get_enrolled_speakers()
    if not enrolled_speakers:
        print("[Identify] No enrolled speakers found, keeping original labels")
        return formatted_output
    
    known_member_names = [s["name"] for s in enrolled_speakers]
    segments = formatted_output.get("segments", [])
    
    if not segments:
        return formatted_output
    
    # Collect unique speakers and their data
    unique_speakers = {}  # {"S0": {"texts": [...], "start": 0, "end": 0}, ...}
    
    # SMART SEGMENTATION: Find the best segment for each speaker
    # Instead of taking the first one + 30s, we look for the LONGEST segment 
    # available for that speaker to ensure high quality audio.
    
    for segment in segments:
        speaker_label = segment.get("speaker", "S0")
        
        # Skip if not S0/S1 format
        if not re.match(r'^S\d+$', speaker_label):
            continue
            
        start = segment.get("start", 0)
        end = segment.get("end", 0)
        duration = end - start
        
        if speaker_label not in unique_speakers:
            unique_speakers[speaker_label] = {
                "texts": [],
                "start": start,
                "end": end,
                "longest_duration": duration
            }
        else:
             # Update best segment if this one is longer (better for embedding)
             if duration > unique_speakers[speaker_label]["longest_duration"]:
                 unique_speakers[speaker_label]["start"] = start
                 unique_speakers[speaker_label]["end"] = end
                 unique_speakers[speaker_label]["longest_duration"] = duration
                 
        unique_speakers[speaker_label]["texts"].append(segment.get("text", ""))
    
    print(f"[Identify] Found {len(unique_speakers)} unique speakers to identify")
    
    # 2. PRE-FLIGHT PROFILE VALIDATION
    # Filter enrolled speakers to ONLY those present in the meeting (if meeting_id context available)
    # And validation strength.
    
    if meeting_id:
        try:
            attendees = get_meeting_attendees(meeting_id)
            if attendees:
                # Exclude absent members (isPresent: false) and guests to avoid false matching candidates
                present_names = [a.get("name") for a in attendees if a.get("role") != "Invité" and a.get("isPresent", True) is not False]
                
                # Filter enrolled list to only present members
                # This prevents "Michael Ross" false positives if he isn't there!
                filtered_enrolled = []
                for spk in enrolled_speakers:
                    if spk["name"] in present_names:
                        # Check strength
                        sample_count = len(spk.get("embedding", [])) if isinstance(spk.get("embedding"), list) else 1
                        if sample_count < 3:
                            print(f"[Identify] WARNING: Weak profile for present member {spk['name']} ({sample_count} samples)")
                        else:
                            print(f"[Identify] Strong profile confirmed for {spk['name']} ({sample_count} samples)")
                        filtered_enrolled.append(spk)
                
                if filtered_enrolled:
                    print(f"[Identify] Filtered candidates to {len(filtered_enrolled)} present members (excluding invités/absent)")
                    enrolled_speakers = filtered_enrolled
                else:
                    print("[Identify] Warning: No present members found in enrolled list. Falling back to full list.")
                    
        except Exception as e:
            print(f"[Identify] Error filtering by attendees: {e}")
    
    # Check if voice embedding is available
    voice_available = bool(audio_url and os.environ.get("MODAL_ENDPOINT_URL"))
    print(f"[Identify] Voice embedding available: {voice_available}")
    
    # Run identification
    speaker_mapping = {}
    unidentified = []
    
    # Dictionnaire du nombre d'échantillons par speaker pour le seuil adaptatif
    speaker_profile_counts = {spk["name"]: spk.get("sampleCount", 0) for spk in enrolled_speakers}
    
    for speaker_label, data in unique_speakers.items():
        combined_text = " ".join(data["texts"][:3])  # First 3 segments
        
        # Initialize scores
        voice_scores = {}
        
        # Try voice embedding if available (70% weight in fuse_scores)
        if voice_available:
            print(f"[Identify] Getting voice embedding for {speaker_label} ({data['start']:.0f}s-{data['end']:.0f}s)")
            segment_embedding = extract_audio_segment_embedding(audio_url, data["start"], data["end"])
            if segment_embedding:
                voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                print(f"[Identify] Voice scores for {speaker_label}: {voice_scores}")
        
        # Build meeting context for AI analysis
        meeting_context = {
            "type": "Régulière",
            "meeting_id": meeting_id
        }
        
        # Fast pattern strategies
        linguistic_scores = linguistic_pattern_strategy(combined_text, enrolled_speakers)
        
        # Recherche du locuteur précédent chronologique dans les segments
        chronological_prev_label = None
        for seg in segments:
            if seg.get("end", 0) <= data["start"]:
                chronological_prev_label = seg.get("speaker")
        
        chronological_prev_name = speaker_mapping.get(chronological_prev_label) if chronological_prev_label else None
        
        # Utiliser le locuteur précédent pour la détection de mentions nominatives ("Merci Michaël")
        mention_scores = name_mention_strategy(combined_text, chronological_prev_name, known_member_names)
        auto_id_scores = auto_identification_strategy(combined_text, known_member_names)
        
        # Contextual AI strategy (GROQ) - 15% weight
        # Only call if we have enrolled speakers with roles
        context_scores = {}
        if enrolled_speakers:
            # BUGFIX: Passing enrolled_speakers (dicts with roles) instead of known_member_names (strings)
            context_scores = contextual_ai_strategy(combined_text, meeting_context, enrolled_speakers)
            if context_scores:
                print(f"[Identify] Context AI scores for {speaker_label}: {context_scores}")
        
        # Use centralized fuse_scores function with dynamic weights and chronological memory
        best_name, best_score = fuse_scores(
            voice_scores=voice_scores,
            context_scores=context_scores,
            linguistic_scores=linguistic_scores,
            mention_scores=mention_scores,
            auto_id_scores=auto_id_scores,
            previous_speaker=chronological_prev_name,
            speaker_profile_counts=speaker_profile_counts,
            confidence_threshold=0.35 if voice_scores else 0.45
        )
        
        # Threshold already applied in fuse_scores, but we need to check for None
        
        # ---------------------------------------------------------
        # ROBUST DECISION LOGIC (User Request)
        # "Compare with 2 or 3 profiles... don't tag female as male"
        # ---------------------------------------------------------
        
        final_decision = None
        rejection_reason = None
        
        # fuse_scores returns None if below threshold, so we just check best_name
        if best_name:
            # 1. MARGIN CHECK (Top 2 Comparison)
            # If strictly voice based, check if the runner-up is too close.
            if voice_scores:
                sorted_voice = sorted(voice_scores.items(), key=lambda x: x[1], reverse=True)
                if len(sorted_voice) >= 2:
                    winner = sorted_voice[0]
                    runner_up = sorted_voice[1]
                    margin = winner[1] - runner_up[1]
                    
                    # If margin is slim (< 0.05), it's risky.
                    # However, if Context supports the winner, we proceed.
                    # Incorporate all contextual and linguistic strategies to resolve narrow voice margins
                    context_support_winner = (
                        context_scores.get(winner[0], 0) +
                        linguistic_scores.get(winner[0], 0) +
                        mention_scores.get(winner[0], 0) +
                        auto_id_scores.get(winner[0], 0)
                    )
                    context_support_runner = (
                        context_scores.get(runner_up[0], 0) +
                        linguistic_scores.get(runner_up[0], 0) +
                        mention_scores.get(runner_up[0], 0) +
                        auto_id_scores.get(runner_up[0], 0)
                    )
                    
                    if margin < 0.05 and context_support_winner <= context_support_runner:
                        # Ambiguous: Voice is close, and context doesn't clarify.
                        print(f"[Identify] AMBIGUITY: {winner[0]} vs {runner_up[0]} (Margin {margin:.3f}). Skipping.")
                        best_name = None 
                        rejection_reason = "Ambiguous Voice Match"

            # 2. GENDER / ROLE GUARD
            # If we picked someone, ensure it doesn't contradict linguistic gender cues.
            if best_name:
                # Heuristic: Check titles in name
                is_female_candidate = "Mme" in best_name or "Madame" in best_name or "Conseillère" in best_name
                is_male_candidate = "M." in best_name or "Monsieur" in best_name or "Conseiller " in best_name
                
                # Check linguistic cues in text (Context)
                text_female_cues = ["madame", "mme", "présidente", "conseillère", "mairesse"]
                text_male_cues = ["monsieur", "m.", "président", "conseiller", "maire"]
                
                found_female = any(cue in combined_text.lower() for cue in text_female_cues)
                found_male = any(cue in combined_text.lower() for cue in text_male_cues)
                
                if is_male_candidate and found_female and not found_male:
                    print(f"[Identify] GENDER GUARD: Rejecting {best_name} (Male) because text implies Female.")
                    best_name = None
                    rejection_reason = "Gender Mismatch (M->F)"
                elif is_female_candidate and found_male and not found_female:
                    print(f"[Identify] GENDER GUARD: Rejecting {best_name} (Female) because text implies Male.")
                    best_name = None
                    rejection_reason = "Gender Mismatch (F->M)"

        if best_name:
            final_decision = best_name
            speaker_mapping[speaker_label] = best_name
            print(f"[Identify] {speaker_label} -> {best_name} (score: {best_score:.2f}, voice: {bool(voice_scores)})")
            
            # Auto-Learning logic (Restored)
            voice_conf = voice_scores.get(best_name, 0)
            if voice_available and segment_embedding:
                # BUGFIX: Increased voice_conf strictness from 0.55 to 0.70 to prevent profile pollution
                if 0.70 <= voice_conf <= 0.85 and best_score > 0.65:
                    try:
                        print(f"[AutoLearn] Autonomous Reinforcement triggered for {best_name}!")
                        # Write directly to Supabase (primary store)
                        from supabase_embeddings import add_embedding, is_duplicate as emb_is_dup
                        member_ref = db.collection("members").where("displayName", "==", best_name).limit(1).get()
                        member_id_for_learn = member_ref[0].id if member_ref else ""
                        if not emb_is_dup(best_name, segment_embedding, threshold=0.95):
                            add_embedding(best_name, segment_embedding, member_id_for_learn, sample_source="auto_learn")
                            from supabase_embeddings import get_embedding_count
                            count = get_embedding_count(best_name)
                            # Update Firestore metadata only
                            if member_ref:
                                member_ref[0].reference.update({
                                    "lastVoiceUpdate": datetime.now().isoformat(),
                                    "voiceSampleCount": count
                                })
                            print(f"[AutoLearn] Successfully learned new sample for {best_name} ({count} total)")
                        else:
                            print(f"[AutoLearn] Skipping duplicate for {best_name}")
                    except Exception as e:
                        print(f"[AutoLearn] Failed to auto-learn: {e}")
        else:
            unidentified.append((speaker_label, combined_text))
            if rejection_reason:
                print(f"[Identify] Unidentified {speaker_label}: {rejection_reason}")
    
    # For remaining unidentified, make ONE batch GROQ call
    if unidentified and len(unidentified) <= 5:
        try:
            import json as json_lib
            groq_api_key = os.environ.get("GROQ_API_KEY")
            if groq_api_key:
                batch_prompt = f"""Analyse ces segments de transcription d'une réunion CCE.
Membres présents: {', '.join(known_member_names)}

Pour chaque intervenant, identifie qui parle:
"""
                for label, text in unidentified:
                    batch_prompt += f"\n{label}: \"{text[:200]}...\""
                
                batch_prompt += """

Retourne un JSON simple avec le mapping: {"S0": "Nom Complet", "S1": "Autre Nom"}
UNIQUEMENT le JSON, sans explication."""
                
                response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {groq_api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [{"role": "user", "content": batch_prompt}],
                        "temperature": 0.3,
                        "max_tokens": 200
                    },
                    timeout=30
                )
                
                if response.ok:
                    result = response.json()
                    content = result["choices"][0]["message"]["content"]
                    groq_mapping = json_lib.loads(content)
                    
                    for label, name in groq_mapping.items():
                        if name in known_member_names and label not in speaker_mapping:
                            speaker_mapping[label] = name
                            print(f"[Identify] {label} -> {name} (GROQ batch)")
        except Exception as groq_err:
            print(f"[Identify] GROQ batch failed: {groq_err}")
    
    print(f"[Identify] Identified {len(speaker_mapping)} speakers")
    
    # Apply mapping to segments
    identified_segments = []
    for segment in segments:
        new_segment = segment.copy()
        original_speaker = segment.get("speaker", "S0")
        new_segment["speaker"] = speaker_mapping.get(original_speaker, original_speaker)
        new_segment["original_speaker"] = original_speaker
        identified_segments.append(new_segment)
    
    # Rebuild text with identified names
    full_text_parts = []
    for seg in identified_segments:
        start_seconds = seg['start']
        m = int(start_seconds // 60)
        s = int(start_seconds % 60)
        timestamp = f"[{m:02d}:{s:02d}]"
        
        speaker_label = f"[{seg['speaker']}]"
        full_text_parts.append(f"{timestamp} {speaker_label} {seg['text']}")
    
    return {
        "text": "\n\n".join(full_text_parts),
        "segments": identified_segments,
        "duration_seconds": formatted_output.get("duration_seconds", 0),
        "speaker_mapping": speaker_mapping
    }