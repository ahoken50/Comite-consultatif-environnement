import os
import time
import json
import requests
from datetime import timedelta, datetime
from firebase_admin import firestore, storage
from firebase_functions import https_fn, options
from core.firebase_init import db, bucket
from core.config import get_openai_client, get_anthropic_client
from ai_agents.transcription import format_speechmatics_output, format_timestamp, clean_hallucinations, build_context_prompt, submit_speechmatics_job
from ai_agents.speaker_profiles import get_enrolled_speakers, compare_embedding_with_speakers
from audio_utils import extract_audio_segment_embedding


# SPEAKER IDENTIFICATION HELPER
# =============================================================================

def run_speaker_identification(
    transcription_text: str,
    audio_url: str,
    enrolled_speakers: list,
    known_member_names: list,
    meeting_context: dict,
    attendees: list,
    db,
    meeting_id: str
) -> dict:
    """
    Core speaker identification logic. Reusable by both speechmatics_webhook and identify_speakers.
    """
    speaker_mapping = {}
    warnings = {}
    unidentified = []
    confidence_scores = {}
    profile_strength = {}
    speaker_stats = {}
    sorted_speakers = []
    
    # 1. Parse transcription into segments
    # Format: [MM:SS] [Speaker] Text
    import re
    lines = transcription_text.split("\n\n")
    segments = []
    
    for line in lines:
        match = re.match(r'\[(\d+:\d+)\]\s*\[([^\]]+)\]\s*(.*)', line, re.DOTALL)
        if match:
            timestamp, speaker, text = match.groups()
            mins, secs = map(int, timestamp.split(":"))
            segments.append({
                "start": mins * 60 + secs,
                "speaker": speaker,
                "text": text.strip()
            })
            
    if not segments:
        return {
            "success": False,
            "error": "Could not parse transcription segments",
            "identified_transcription": transcription_text,
            "speaker_mapping": {},
            "warnings": {},
            "analytics": {}
        }
        
    print(f"[Speaker ID Helper] Processing {len(segments)} segments")
    
    # Collect unique speakers and their sample texts
    unique_speakers = {}
    for segment in segments:
        speaker_label = segment["speaker"]
        if not re.match(r'^S\d+$', speaker_label):
            continue
        if speaker_label not in unique_speakers:
            unique_speakers[speaker_label] = []
        unique_speakers[speaker_label].append(segment["text"])
        
    # Collect timestamps for each unique speaker
    speaker_timestamps = {}
    for segment in segments:
        label = segment["speaker"]
        if re.match(r'^S\d+$', label):
            start = segment.get("start", 0)
            end = segment.get("end", start + 5)
            duration = end - start
            if label not in speaker_timestamps:
                speaker_timestamps[label] = {"start": start, "end": end, "duration": duration}
            elif duration > speaker_timestamps[label]["duration"]:
                speaker_timestamps[label] = {"start": start, "end": end, "duration": duration}
                
    # Calculate speaker time statistics
    for segment in segments:
        label = segment.get("speaker", "")
        if re.match(r'^S\d+$', label):
            start = segment.get("start", 0)
            end = segment.get("end", start + 5)
            duration = end - start
            if label not in speaker_stats:
                speaker_stats[label] = {"segments": 0, "total_time": 0, "texts": []}
            speaker_stats[label]["segments"] += 1
            speaker_stats[label]["total_time"] += duration
            speaker_stats[label]["texts"].append(segment.get("text", "")[:100])
            
    for label, stats in speaker_stats.items():
        if stats["segments"] > 0:
            stats["avg_duration"] = stats["total_time"] / stats["segments"]
            
    sorted_speakers = sorted(speaker_stats.items(), key=lambda x: x[1]["total_time"], reverse=True)
    
    modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
    voice_available = bool(audio_url and modal_endpoint)
    
    # Interruptions detection
    interruptions = []
    prev_segment = None
    for segment in segments:
        if prev_segment:
            prev_end = prev_segment.get("end", 0)
            curr_start = segment.get("start", 0)
            prev_speaker = prev_segment.get("speaker", "")
            curr_speaker = segment.get("speaker", "")
            gap = curr_start - prev_end
            if prev_speaker != curr_speaker and gap < 0.5:
                interruptions.append({
                    "interrupter": curr_speaker,
                    "interrupted": prev_speaker,
                    "time": round(curr_start, 1),
                    "gap": round(gap, 2),
                    "context": segment.get("text", "")[:80]
                })
        prev_segment = segment
        
    if interruptions:
        interrupter_counts = {}
        for intr in interruptions:
            sp = intr["interrupter"]
            interrupter_counts[sp] = interrupter_counts.get(sp, 0) + 1
        top_interrupter = max(interrupter_counts.items(), key=lambda x: x[1]) if interrupter_counts else None
        if top_interrupter and top_interrupter[1] >= 3:
            warnings["_interruptions"] = f"⚡ {top_interrupter[0]} a interrompu {top_interrupter[1]} fois"
            
    # Build profile strength
    for sp in enrolled_speakers:
        name = sp.get("name")
        sample_count = sp.get("voiceSampleCount", 0)
        if sample_count >= 10:
            quality = "robuste"
        elif sample_count >= 5:
            quality = "acceptable"
        elif sample_count >= 1:
            quality = "faible"
        else:
            quality = "inexistant"
        profile_strength[name] = {"samples": sample_count, "quality": quality}
        
    # Pre-download audio if voice ID is available
    local_audio_path = None
    if voice_available and len(unique_speakers) > 0:
        try:
            import tempfile
            import shutil
            print(f"[Speaker ID Helper] Pre-downloading audio for optimization...")
            with requests.get(audio_url, stream=True, timeout=120) as r:
                if r.ok:
                    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                        shutil.copyfileobj(r.raw, tmp)
                        local_audio_path = tmp.name
                        print(f"[Speaker ID Helper] Audio downloaded to {local_audio_path}")
        except Exception as e:
            print(f"[Speaker ID Helper] Pre-download failed, falling back to per-segment download: {e}")
            
    from speaker_identification import (
        fuse_scores,
        contextual_ai_strategy,
        linguistic_pattern_strategy,
        name_mention_strategy,
        auto_identification_strategy
    )
    
    # Identify unique speakers
    for speaker_label, texts in unique_speakers.items():
        combined_text = " ".join(texts[:5])
        voice_scores = {}
        
        if voice_available and speaker_label in speaker_timestamps:
            ts = speaker_timestamps[speaker_label]
            source_audio = local_audio_path if local_audio_path else audio_url
            try:
                segment_embedding = extract_audio_segment_embedding(source_audio, ts["start"], ts["end"])
                if segment_embedding:
                    voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
            except Exception as e:
                print(f"[Speaker ID Helper] Voice embedding failed for {speaker_label}: {e}")
                
        context_scores = contextual_ai_strategy(combined_text, meeting_context, enrolled_speakers)
        linguistic_scores = linguistic_pattern_strategy(combined_text, enrolled_speakers)
        mention_scores = name_mention_strategy(combined_text, None, known_member_names)
        auto_id_scores = auto_identification_strategy(combined_text, known_member_names)
        
        # Fuse
        max_voice_score = max(voice_scores.values()) if voice_scores else 0
        best_score = 0
        best_name = None
        
        for name in known_member_names:
            if voice_scores:
                v_score = voice_scores.get(name, 0)
                voice_bonus = 0.05 if v_score == max_voice_score and v_score > 0.75 else 0
                score = (
                    (v_score + voice_bonus) * 0.70 +
                    linguistic_scores.get(name, 0) * 0.10 +
                    mention_scores.get(name, 0) * 0.10 +
                    context_scores.get(name, 0) * 0.10
                )
            else:
                score = (
                    linguistic_scores.get(name, 0) * 0.4 +
                    mention_scores.get(name, 0) * 0.3 +
                    auto_id_scores.get(name, 0) * 0.3
                )
            if score > best_score:
                best_score = score
                best_name = name
                
        threshold = 0.60 if voice_scores else 0.15
        rejection_reason = None
        ai_warning = None
        
        if best_score >= threshold and best_name:
             if voice_scores:
                 sorted_voice = sorted(voice_scores.items(), key=lambda x: x[1], reverse=True)
                 if len(sorted_voice) >= 2:
                     winner = sorted_voice[0]
                     runner_up = sorted_voice[1]
                     margin = winner[1] - runner_up[1]
                     context_support_winner = linguistic_scores.get(winner[0], 0) + auto_id_scores.get(winner[0], 0)
                     context_support_runner = linguistic_scores.get(runner_up[0], 0) + auto_id_scores.get(runner_up[0], 0)
                     if margin < 0.05 and context_support_winner <= context_support_runner:
                         best_name = None
                         rejection_reason = "Ambiguïté (Scores trop proches)"
                         ai_warning = f"Ambiguïté entre {winner[0]} ({winner[1]:.2f}) et {runner_up[0]} ({runner_up[1]:.2f})"
             
             if best_name:
                 # Gender Guard
                 FEMALE_NAMES = {"patricia", "marguerite", "marie", "anne", "sophie", "nathalie", "isabelle", "valérie", "sylvie", "christine", "françoise", "catherine", "nicole", "monique", "julie", "audrey", "caroline", "jacinthe", "martine", "claire", "louise", "jeanne", "hélène", "madeleine", "céline", "brigitte", "danielle", "michèle", "josée", "diane", "linda", "chantal", "lucie", "manon", "karine", "stéphanie"}
                 MALE_NAMES = {"donald", "pierre", "jean", "michel", "jacques", "paul", "andré", "robert", "françois", "alain", "claude", "yves", "louis", "daniel", "richard", "gilles", "marc", "bernard", "serge", "martin", "denis", "sébastien", "christian", "éric", "philippe", "patrick", "stéphane", "marcel", "roger", "raymond", "normand", "guy", "luc", "benoit", "olivier", "mathieu", "maxime", "simon", "alexandre", "michaël"}
                 
                 first_name = best_name.split()[0].lower().replace("mme", "").replace("m.", "").strip()
                 if len(first_name) < 2 and len(best_name.split()) > 1:
                     first_name = best_name.split()[1].lower()
                     
                 is_female_candidate = first_name in FEMALE_NAMES or "Mme" in best_name or "Madame" in best_name or "Conseillère" in best_name
                 is_male_candidate = first_name in MALE_NAMES or "M." in best_name or "Monsieur" in best_name or "Conseiller" in best_name
                 
                 text_female_cues = ["madame", "mme", "présidente", "conseillère", "mairesse", "elle a dit", "elle propose"]
                 text_male_cues = ["monsieur", "m.", "président", "conseiller", "maire", "il a dit", "il propose"]
                 
                 found_female = any(cue in combined_text.lower() for cue in text_female_cues)
                 found_male = any(cue in combined_text.lower() for cue in text_male_cues)
                 
                 if is_male_candidate and found_female and not found_male:
                     best_name = None
                     rejection_reason = "Incohérence de Genre (H vs F)"
                     ai_warning = f"Rejeté: {first_name} est Homme mais le contexte indique une Femme."
                 elif is_female_candidate and found_male and not found_female:
                     best_name = None
                     rejection_reason = "Incohérence de Genre (F vs H)"
                     ai_warning = f"Rejeté: {first_name} est Femme mais le contexte indique un Homme."
                     
        if best_score >= threshold and best_name:
            speaker_mapping[speaker_label] = best_name
            method = "voice+context" if voice_scores else "context_only"
            if max_voice_score > 0.85:
                method = "voice_high"
            elif max_voice_score > 0.70:
                method = "voice_confident"
            elif max_voice_score > 0.50:
                method = "voice_uncertain"
                
            confidence_scores[speaker_label] = {
                "score": round(best_score, 3),
                "voice_score": round(max_voice_score, 3) if voice_scores else 0,
                "method": method,
                "identified_as": best_name,
                "profile_quality": profile_strength.get(best_name, {}).get("quality", "inconnu")
            }
            
            # Auto-learning
            if max_voice_score > 0.85 and voice_available and speaker_label in speaker_timestamps:
                try:
                    member_id = None
                    for sp in enrolled_speakers:
                        if sp.get("name") == best_name:
                            member_id = sp.get("id")
                            break
                    if member_id:
                        ts = speaker_timestamps[speaker_label]
                        try:
                            source = local_audio_path if local_audio_path else audio_url
                            auto_embedding = extract_audio_segment_embedding(source, ts["start"], ts["end"])
                            if auto_embedding:
                                from supabase_embeddings import add_embedding, is_duplicate as emb_is_dup, get_embedding_count
                                if not emb_is_dup(best_name, auto_embedding, threshold=0.95):
                                    add_embedding(best_name, auto_embedding, member_id, sample_source="auto_learn")
                                    count = get_embedding_count(best_name)
                                    db.collection("members").document(member_id).update({
                                        "voiceSampleCount": count,
                                        "lastVoiceUpdate": datetime.now().isoformat()
                                    })
                        except Exception as ae:
                            print(f"[Auto-Learn] Failed for {best_name}: {ae}")
                except Exception as e:
                    print(f"[Auto-Learn] Skipped: {e}")
        else:
            unidentified.append((speaker_label, combined_text))
            if ai_warning:
                warnings[speaker_label] = ai_warning
                
    # Remaining unidentified via GROQ
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if unidentified and groq_api_key:
        try:
            import json as json_lib
            batch_size = 10
            for batch_start in range(0, len(unidentified), batch_size):
                batch = unidentified[batch_start:batch_start + batch_size]
                batch_prompt = f"Analyse ces segments de transcription d'une réunion CCE.\nMembres présents: {', '.join(known_member_names)}\n\nPour chaque intervenant, identifie qui parle basé sur le contenu, le style de parole, et les indices contextuels:\n"
                for label, text in batch:
                    batch_prompt += f"\n{label}: \"{text[:300]}...\""
                batch_prompt += "\n\nRetourne un JSON simple avec le mapping: {\"S0\": \"Nom Complet\", \"S1\": \"Autre Nom\"}\nSi tu ne peux pas identifier un intervenant, ne l'inclus pas dans le JSON.\nUNIQUEMENT le JSON, sans explication."
                
                response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_api_key}", "Content-Type": "application/json"},
                    json={"model": "llama-3.1-8b-instant", "messages": [{"role": "user", "content": batch_prompt}], "temperature": 0.3, "max_tokens": 500},
                    timeout=30
                )
                if response.ok:
                    content = response.json()["choices"][0]["message"]["content"]
                    if "```json" in content:
                        content = content.split("```json")[1].split("```")[0]
                    elif "```" in content:
                        content = content.split("```")[1].split("```")[0]
                    groq_mapping = json_lib.loads(content.strip())
                    for label, name in groq_mapping.items():
                        if name in known_member_names and label not in speaker_mapping:
                            speaker_mapping[label] = name
        except Exception as groq_err:
            print(f"[Speaker ID Helper] GROQ batch failed: {groq_err}")
            
    # Cleanup audio path
    if local_audio_path and os.path.exists(local_audio_path):
        os.unlink(local_audio_path)
        
    # Rebuild identified transcription
    identified_parts = []
    for seg in segments:
        m = int(seg["start"] // 60)
        s = int(seg["start"] % 60)
        timestamp = f"[{m:02d}:{s:02d}]"
        original = seg["speaker"]
        name = speaker_mapping.get(original, original)
        identified_parts.append(f"{timestamp} [{name}] {seg['text']}")
        
    identified_transcription = "\n\n".join(identified_parts)
    
    # Missing attendees warnings
    if attendees:
        identified_names = set(speaker_mapping.values())
        present_attendees = [a.get("name") or a.get("displayName") for a in attendees if a.get("status", "").lower() in ["present", "présent", ""]]
        missing_speakers = [n for n in present_attendees if n and n not in identified_names]
        if missing_speakers:
            warnings["_missing"] = f"Membres présents non détectés: {', '.join(missing_speakers)}"
            
    clean_stats = {}
    for label, stats in speaker_stats.items():
        clean_stats[label] = {
            "segments": stats["segments"],
            "total_time": round(stats["total_time"], 1),
            "avg_duration": round(stats.get("avg_duration", 0), 1)
        }
        
    auto_learned_count = sum(1 for c in confidence_scores.values() if c.get("method") == "voice_high")
    
    return {
        "success": True,
        "identified_transcription": identified_transcription,
        "speaker_mapping": speaker_mapping,
        "warnings": warnings,
        "analytics": {
            "confidence": confidence_scores,
            "speakerStats": clean_stats,
            "profileStrength": profile_strength,
            "topSpeaker": sorted_speakers[0][0] if sorted_speakers else None,
            "totalSpeakers": len(unique_speakers),
            "autoLearnedCount": auto_learned_count
        }
    }


# SPEECHMATICS WEBHOOK (Receives completed transcripts)
# =============================================================================

@https_fn.on_request(
    timeout_sec=3600,
    memory=options.MemoryOption.GB_2,
    cors=options.CorsOptions(cors_origins="*", cors_methods=["POST", "GET"])
)
def speechmatics_webhook(req: https_fn.Request) -> https_fn.Response:
    """
    HTTP webhook endpoint that receives completed transcripts from Speechmatics.
    Speechmatics POSTs the transcript here when the job is done.
    
    Query params from Speechmatics:
    - id: The Speechmatics job ID
    - status: success, error, fetch_error, trim_error
    
    The meeting_id is in the job's tracking.reference field.
    We also receive the transcript in the request body (js    try:
        # Get query params
        job_id = req.args.get("id", "unknown")
        status = req.args.get("status", "unknown")
        
        print(f"[Speechmatics Webhook] 📬 Received callback for job {job_id}, status={status}")
        
        if status != "success":
            print(f"[Speechmatics Webhook] ⚠️ Job {job_id} failed with status: {status}")
            return https_fn.Response(
                json.dumps({"received": True, "status": status}),
                status=200,
                content_type="application/json"
            )
        
        # Parse the transcript from request body (json-v2 format)
        content_type = req.content_type or ""
        if "application/json" in content_type:
            transcript_data = req.get_json(silent=True) or {}
        else:
            try:
                transcript_data = json.loads(req.get_data(as_text=True))
            except:
                transcript_data = {}
        
        # Log metadata for verification
        job_info = transcript_data.get("job", {})
        tracking = job_info.get("tracking", {})
        metadata = transcript_data.get("metadata", {})
        
        print(f"[Speechmatics Webhook] 📋 Job Info: {json.dumps(job_info)}")
        print(f"[Speechmatics Webhook] 🏷️ Tracking Metadata: {json.dumps(tracking)}")
        
        # Extract meeting_id from tracking.reference
        meeting_id = tracking.get("reference")
        if not meeting_id:
            tracking_alt = metadata.get("tracking", {})
            meeting_id = tracking_alt.get("reference")
            print(f"[Speechmatics Webhook] ℹ️ Found meeting_id in fallback metadata: {meeting_id}")
        
        if not meeting_id:
            print(f"[Speechmatics Webhook] ❌ ERROR: No meeting_id found in tracking.reference for job {job_id}")
            return https_fn.Response(
                json.dumps({"error": "No meeting_id in tracking.reference"}),
                status=200,
                content_type="application/json"
            )
        
        print(f"[Speechmatics Webhook] Processing transcript for meeting {meeting_id}")
        
        # Format the transcript using existing function
        formatted = format_speechmatics_output(transcript_data)
        full_transcription = formatted.get("text", "")
        
        print(f"[Speechmatics Webhook] Formatted transcript: {len(full_transcription)} characters")
        
        # Get Meeting Doc
        db_client = firestore.client()
        meeting_ref = db_client.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            print(f"[Speechmatics Webhook] ERROR: Meeting {meeting_id} not found")
            return https_fn.Response(
                json.dumps({"error": "Meeting not found"}),
                status=200,
                content_type="application/json"
            )
        
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        
        # Get Present Candidates for Speaker Identification
        enrolled_speakers = get_enrolled_speakers()
        known_member_names = []
        attendees = meeting_data.get("attendees", [])
        
        if enrolled_speakers:
            known_member_names = [s["name"] for s in enrolled_speakers]
            if attendees:
                present_names = set()
                for att in attendees:
                    att_status = att.get("status", "").lower()
                    if att_status in ["present", "présent", ""]:
                        name = att.get("name") or att.get("displayName")
                        if name:
                            present_names.add(name)
                if present_names:
                    known_member_names = [n for n in known_member_names if n in present_names]
        
        # Find audio URL for this specific recording
        audio_url = None
        if isinstance(audio_recordings, list):
            for rec in audio_recordings:
                if rec.get("speechmaticsJobId") == job_id:
                    audio_url = rec.get("fileUrl") or rec.get("url") or rec.get("downloadURL")
                    break
        
        # Run Speaker ID in-memory
        speaker_mapping = {}
        warnings = {}
        unidentified_count = 0
        identified_transcription = full_transcription
        
        if enrolled_speakers and len(enrolled_speakers) > 0 and audio_url:
            try:
                meeting_context = {"type": "Régulière"}
                id_result = run_speaker_identification(
                    transcription_text=full_transcription,
                    audio_url=audio_url,
                    enrolled_speakers=enrolled_speakers,
                    known_member_names=known_member_names,
                    meeting_context=meeting_context,
                    attendees=attendees,
                    db=db_client,
                    meeting_id=meeting_id
                )
                if id_result.get("success"):
                    identified_transcription = id_result["identified_transcription"]
                    speaker_mapping = id_result["speaker_mapping"]
                    warnings = id_result["warnings"]
                    unidentified_count = id_result.get("analytics", {}).get("totalSpeakers", 0) - len(speaker_mapping)
            except Exception as id_err:
                print(f"[Speechmatics Webhook] Speaker ID failed (non-fatal): {id_err}")
                import traceback
                traceback.print_exc()
        
        # Update specific recording inside audioRecordings array in memory
        updated_array = False
        if isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for i, rec in enumerate(audio_recordings):
                if rec.get("speechmaticsJobId") == job_id:
                    audio_recordings[i]["transcription"] = identified_transcription
                    if "originalTranscription" not in audio_recordings[i]:
                        audio_recordings[i]["originalTranscription"] = full_transcription
                    audio_recordings[i]["segments"] = formatted.get("segments", [])
                    audio_recordings[i]["transcriptionStatus"] = "completed"
                    audio_recordings[i]["transcribedAt"] = datetime.now().isoformat()
                    audio_recordings[i]["transcriptionEngine"] = "speechmatics-webhook"
                    if speaker_mapping:
                        audio_recordings[i]["speakerMapping"] = speaker_mapping
                    updated_array = True
                    print(f"[Speechmatics Webhook] Updated audioRecordings[{i}] for job {job_id} in memory")
                    break
        
        # Build merged transcription of all completed recordings
        merged_parts = []
        all_completed = True
        
        if isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for idx, rec in enumerate(audio_recordings):
                rec_status = rec.get("transcriptionStatus")
                rec_trans = rec.get("transcription")
                if rec_status == "completed" and rec_trans:
                    part_name = rec.get("fileName", f"Partie {idx+1}")
                    merged_parts.append(f"=== {part_name} ===\n\n{rec_trans}")
                elif rec_status in ["pending", "processing"]:
                    all_completed = False
        else:
            merged_parts.append(identified_transcription)
            
        merged_transcription = "\n\n--- TRANSCRIPTION SUIVANTE ---\n\n".join(merged_parts)
        
        # Perform single atomic update to Firestore
        update_data = {
            "audioRecording.transcription": merged_transcription,
            "audioRecording.transcriptionStatus": "completed" if all_completed else "processing",
            "audioRecording.transcribedAt": datetime.now().isoformat(),
            "audioRecording.transcriptionEngine": "speechmatics-webhook",
            "audioRecording.speechmaticsJobId": job_id,
            "dateUpdated": datetime.now().isoformat()
        }
        
        # Merge speaker mappings from all recordings for legacy compatibility
        merged_speaker_mapping = {}
        if isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for rec in audio_recordings:
                mapping = rec.get("speakerMapping")
                if isinstance(mapping, dict):
                    merged_speaker_mapping.update(mapping)
        else:
            merged_speaker_mapping = speaker_mapping
            
        if merged_speaker_mapping:
            update_data["audioRecording.speakerMapping"] = merged_speaker_mapping
            
        if updated_array:
            update_data["audioRecordings"] = audio_recordings
            
        meeting_ref.update(update_data)
        print(f"[Speechmatics Webhook] SUCCESS! Atomically saved merged transcription for meeting {meeting_id}")
        
        return https_fn.Response(
            json.dumps({
                "success": True, 
                "meetingId": meeting_id, 
                "speakers": speaker_mapping,
                "warnings": warnings,
                "unidentifiedCount": unidentified_count
            }),
            status=200,
            content_type="application/json"
        )
        
    except Exception as e:
        print(f"[Speechmatics Webhook] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=200,
            content_type="application/json"
        )    status=200,
            content_type="application/json"
        )


# =============================================================================
# MANUAL SPEAKER IDENTIFICATION (Callable)
# =============================================================================

@https_fn.on_call(timeout_sec=3600, memory=options.MemoryOption.GB_2)
def identify_speakers(req: https_fn.CallableRequest) -> dict:
    """
    Manually trigger speaker identification on an existing transcription.
    Called from the UI when user wants to re-identify speakers.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    storage_path = data.get("storagePath")  # Optional: specific recording
    
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId."
        )
    
    print(f"[Manual Speaker ID] Starting for meeting {meeting_id}")
    
    try:
        from speaker_identification import (
            fuse_scores,
            contextual_ai_strategy,
            linguistic_pattern_strategy,
            name_mention_strategy,
            auto_identification_strategy
        )
        
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.NOT_FOUND,
                message="Meeting not found."
            )
        
        meeting_data = meeting_doc.to_dict()
        
        # Get enrolled speakers
        enrolled_speakers = get_enrolled_speakers()
        if not enrolled_speakers:
            return {"success": False, "error": "No enrolled speakers found"}
        
        known_member_names = [s["name"] for s in enrolled_speakers]
        meeting_context = {"type": "Régulière"}
        
        # PRE-FLIGHT: Filter out absent/excused attendees
        attendees = meeting_data.get("attendees", [])
        if attendees:
            present_names = set()
            for att in attendees:
                status = att.get("status", "").lower()
                if status in ["present", "présent", ""]:  # Include if no status or present
                    name = att.get("name") or att.get("displayName")
                    if name:
                        present_names.add(name)
            
            if present_names:
                # Keep only enrolled speakers who are present at this meeting
                known_member_names = [n for n in known_member_names if n in present_names]
        
        audio_recordings = meeting_data.get("audioRecordings", [])
        any_updated = False
        
        # Loop through recordings
        for idx, rec in enumerate(audio_recordings):
            # If storage_path is specified, filter by it
            if storage_path and rec.get("storagePath") != storage_path:
                continue
                
            trans_text = rec.get("originalTranscription") or rec.get("transcription")
            if not trans_text:
                continue
                
            rec_audio_url = rec.get("fileUrl") or rec.get("url") or rec.get("downloadURL")
            if not rec_audio_url:
                continue
                
            print(f"[Manual Speaker ID] Processing recording {idx}: {rec.get('fileName')}")
            
            id_result = run_speaker_identification(
                transcription_text=trans_text,
                audio_url=rec_audio_url,
                enrolled_speakers=enrolled_speakers,
                known_member_names=known_member_names,
                meeting_context=meeting_context,
                attendees=attendees,
                db=db,
                meeting_id=meeting_id
            )
            
            if id_result.get("success"):
                audio_recordings[idx]["transcription"] = id_result["identified_transcription"]
                audio_recordings[idx]["speakerMapping"] = id_result["speaker_mapping"]
                # Save first time as original transcription if not already saved
                if not rec.get("originalTranscription"):
                    audio_recordings[idx]["originalTranscription"] = trans_text
                any_updated = True
                
        # Fallback to legacy single recording if no array is updated and no array exists
        legacy_updated = False
        legacy_result = {}
        if not audio_recordings or len(audio_recordings) == 0:
            legacy = meeting_data.get("audioRecording", {})
            trans_text = legacy.get("originalTranscription") or legacy.get("transcription")
            rec_audio_url = legacy.get("fileUrl") or legacy.get("url") or legacy.get("downloadURL")
            if trans_text and rec_audio_url:
                id_result = run_speaker_identification(
                    transcription_text=trans_text,
                    audio_url=rec_audio_url,
                    enrolled_speakers=enrolled_speakers,
                    known_member_names=known_member_names,
                    meeting_context=meeting_context,
                    attendees=attendees,
                    db=db,
                    meeting_id=meeting_id
                )
                if id_result.get("success"):
                    legacy_result = id_result
                    legacy_updated = True
                    any_updated = True
        
        if not any_updated:
            return {"success": False, "error": "Aucun segment audio avec transcription n'a pu être traité."}
            
        # 2. Rebuild merged transcription and consolidated mappings
        merged_parts = []
        all_completed = True
        consolidated_mapping = {}
        consolidated_warnings = {}
        consolidated_analytics = {
            "confidence": {},
            "speakerStats": {},
            "profileStrength": {},
            "topSpeaker": None,
            "totalSpeakers": 0,
            "autoLearnedCount": 0
        }
        
        if audio_recordings:
            for idx, rec in enumerate(audio_recordings):
                status = rec.get("transcriptionStatus")
                trans = rec.get("transcription")
                if status == "completed" and trans:
                    part_name = rec.get("fileName", f"Partie {idx+1}")
                    merged_parts.append(f"=== {part_name} ===\n\n{trans}")
                    
                    # Accumulate mapping
                    mapping = rec.get("speakerMapping")
                    if isinstance(mapping, dict):
                        consolidated_mapping.update(mapping)
                elif status in ["pending", "processing"]:
                    all_completed = False
            merged_transcription = "\n\n--- TRANSCRIPTION SUIVANTE ---\n\n".join(merged_parts)
        else:
            # Legacy fallback
            if legacy_updated:
                merged_transcription = legacy_result["identified_transcription"]
                consolidated_mapping = legacy_result["speaker_mapping"]
                consolidated_warnings = legacy_result["warnings"]
                consolidated_analytics = legacy_result["analytics"]
            else:
                legacy = meeting_data.get("audioRecording", {})
                merged_transcription = legacy.get("transcription", "")
                consolidated_mapping = legacy.get("speakerMapping", {})
                
        # Create Firestore updates
        update_data = {
            "audioRecording.transcription": merged_transcription,
            "audioRecording.transcriptionStatus": "completed" if all_completed else "processing",
            "dateUpdated": datetime.now().isoformat()
        }
        
        if consolidated_mapping:
            update_data["audioRecording.speakerMapping"] = consolidated_mapping
            
        if audio_recordings:
            update_data["audioRecordings"] = audio_recordings
                
        meeting_ref.update(update_data)
        print(f"[Manual Speaker ID] SUCCESS! Identified speakers and updated Firestore.")
        
        return {
            "success": True,
            "identifiedCount": len(consolidated_mapping),
            "mapping": consolidated_mapping,
            "speakers": consolidated_mapping,
            "warnings": consolidated_warnings,
            "analytics": consolidated_analytics
        }
        
    except Exception as e:
        print(f"[Manual Speaker ID] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# =============================================================================
# ASYNC TRANSCRIPTION ENDPOINTS (No timeout limit)
# =============================================================================

@https_fn.on_call(
    timeout_sec=120,  # 2 minutes - just submits job
    memory=options.MemoryOption.MB_512
)
def submit_transcription(req: https_fn.CallableRequest) -> dict:
    """
    Submit a transcription job to Speechmatics.
    Returns immediately with job_id - does NOT wait for completion.
    Supports both legacy audioRecording and new audioRecordings[] array.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    download_url = data.get("downloadUrl")
    storage_path = data.get("storagePath")  # Used to identify recording in array
    
    if not meeting_id or not download_url:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId or downloadUrl."
        )
    
    print(f"[Async Transcription] Submitting job for meeting {meeting_id}")
    if storage_path:
        print(f"[Async Transcription] Storage path: {storage_path}")
    
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.NOT_FOUND,
                message="Meeting not found."
            )
        
        # Submit to Speechmatics
        job_id = submit_speechmatics_job(download_url, meeting_id, language_code="fr")
        
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        
        # If we have audioRecordings array and a storagePath, update the specific entry
        if storage_path and isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            # Find the recording by storagePath
            updated = False
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    audio_recordings[i]["speechmaticsJobId"] = job_id
                    audio_recordings[i]["transcriptionStatus"] = "processing"
                    audio_recordings[i]["transcriptionStartedAt"] = datetime.now().isoformat()
                    updated = True
                    print(f"[Async Transcription] Updated audioRecordings[{i}] with job {job_id}")
                    break
            
            if updated:
                meeting_ref.update({
                    "audioRecordings": audio_recordings,
                    "dateUpdated": datetime.now().isoformat()
                })
            else:
                print(f"[Async Transcription] Warning: Could not find recording with storagePath {storage_path}")
                # Fall back to legacy field
                meeting_ref.update({
                    "audioRecording.speechmaticsJobId": job_id,
                    "audioRecording.transcriptionStatus": "processing",
                    "audioRecording.transcriptionStartedAt": datetime.now().isoformat(),
                    "dateUpdated": datetime.now().isoformat()
                })
        else:
            # Legacy: update audioRecording (singular)
            meeting_ref.update({
                "audioRecording.speechmaticsJobId": job_id,
                "audioRecording.transcriptionStatus": "processing",
                "audioRecording.transcriptionStartedAt": datetime.now().isoformat(),
                "dateUpdated": datetime.now().isoformat()
            })
        
        print(f"[Async Transcription] Job {job_id} submitted for meeting {meeting_id}")
        
        return {
            "success": True,
            "jobId": job_id,
            "storagePath": storage_path,
            "message": "Transcription submitted. Check back in a few minutes."
        }
        
    except Exception as e:
        print(f"[Async Transcription] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


@https_fn.on_call(
    timeout_sec=180,  # 3 minutes - checks status and retrieves result
    memory=options.MemoryOption.GB_1
)
def check_transcription_status(req: https_fn.CallableRequest) -> dict:
    """
    Check the status of a transcription job.
    If complete, saves the result to Firestore using a transaction
    to prevent race conditions when multiple jobs complete simultaneously.
    Supports both legacy audioRecording and new audioRecordings[] array.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )
    
    data = req.data
    meeting_id = data.get("meetingId")
    storage_path = data.get("storagePath")  # Used to identify recording in array
    
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing meetingId."
        )
    
    print(f"[Check Transcription] Checking meeting {meeting_id}, storagePath: {storage_path}")
    
    try:
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
        meeting_doc = meeting_ref.get()
        
        if not meeting_doc.exists:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.NOT_FOUND,
                message="Meeting not found."
            )
        
        meeting_data = meeting_doc.to_dict()
        audio_recordings = meeting_data.get("audioRecordings", [])
        
        # Try to find the specific recording in the array first
        job_id = None
        current_status = None
        recording_index = -1
        
        if storage_path and isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    job_id = rec.get("speechmaticsJobId")
                    current_status = rec.get("transcriptionStatus")
                    recording_index = i
                    print(f"[Check Transcription] Found recording at index {i}, job_id: {job_id}, status: {current_status}")
                    break
        
        # Fall back to legacy audioRecording field
        if job_id is None:
            audio_recording = meeting_data.get("audioRecording", {})
            job_id = audio_recording.get("speechmaticsJobId")
            current_status = audio_recording.get("transcriptionStatus")
            print(f"[Check Transcription] Using legacy audioRecording, job_id: {job_id}, status: {current_status}")
        
        if not job_id:
            return {
                "status": "not_started",
                "message": "No transcription job found. Please submit first."
            }
        
        # Check Speechmatics
        from ai_agents.transcription import check_speechmatics_job
        result = check_speechmatics_job(job_id)
        
        if result["status"] == "completed":
            # Save result to Firestore
            full_transcription = result["result"].get("text", "")
            
            # Fetch present candidates for Speaker Identification
            enrolled_speakers = get_enrolled_speakers()
            known_member_names = []
            attendees = meeting_data.get("attendees", [])
            
            if enrolled_speakers:
                known_member_names = [s["name"] for s in enrolled_speakers]
                if attendees:
                    present_names = set()
                    for att in attendees:
                        att_status = att.get("status", "").lower()
                        if att_status in ["present", "présent", ""]:
                            name = att.get("name") or att.get("displayName")
                            if name:
                                present_names.add(name)
                    if present_names:
                        known_member_names = [n for n in known_member_names if n in present_names]
            
            # Find audio URL for this specific recording
            audio_url = None
            if recording_index >= 0:
                rec = audio_recordings[recording_index]
                audio_url = rec.get("fileUrl") or rec.get("url") or rec.get("downloadURL")
            else:
                legacy = meeting_data.get("audioRecording", {})
                audio_url = legacy.get("fileUrl") or legacy.get("url") or legacy.get("downloadURL")
            
            # Run Speaker ID in-memory
            speaker_mapping = {}
            warnings = {}
            identified_transcription = full_transcription
            
            if enrolled_speakers and len(enrolled_speakers) > 0 and audio_url:
                try:
                    meeting_context = {"type": "Régulière"}
                    id_result = run_speaker_identification(
                        transcription_text=full_transcription,
                        audio_url=audio_url,
                        enrolled_speakers=enrolled_speakers,
                        known_member_names=known_member_names,
                        meeting_context=meeting_context,
                        attendees=attendees,
                        db=db,
                        meeting_id=meeting_id
                    )
                    if id_result.get("success"):
                        identified_transcription = id_result["identified_transcription"]
                        speaker_mapping = id_result["speaker_mapping"]
                        warnings = id_result["warnings"]
                except Exception as id_err:
                    print(f"[Check Transcription] Speaker ID failed (non-fatal): {id_err}")
                    import traceback
                    traceback.print_exc()
            
            # Update the correct location
            if recording_index >= 0:
                # Use transaction to safely update the array and rebuild the merged transcription
                @firestore.transactional
                def update_in_transaction(transaction, doc_ref, rec_index, transcription_text, orig_transcription, mapping_data, segments_data):
                    snapshot = doc_ref.get(transaction=transaction)
                    if not snapshot.exists:
                        return False
                    
                    data = snapshot.to_dict()
                    recordings = data.get("audioRecordings", [])
                    
                    if rec_index < len(recordings):
                        recordings[rec_index]["transcription"] = transcription_text
                        if "originalTranscription" not in recordings[rec_index]:
                            recordings[rec_index]["originalTranscription"] = orig_transcription
                        recordings[rec_index]["segments"] = segments_data
                        recordings[rec_index]["transcriptionStatus"] = "completed"
                        recordings[rec_index]["transcribedAt"] = datetime.now().isoformat()
                        recordings[rec_index]["transcriptionEngine"] = "speechmatics-async"
                        if mapping_data:
                            recordings[rec_index]["speakerMapping"] = mapping_data
                        
                        # Rebuild merged transcription of all completed recordings
                        merged_parts = []
                        all_completed = True
                        for idx, rec in enumerate(recordings):
                            rec_status = rec.get("transcriptionStatus")
                            rec_trans = rec.get("transcription")
                            if rec_status == "completed" and rec_trans:
                                part_name = rec.get("fileName", f"Partie {idx+1}")
                                merged_parts.append(f"=== {part_name} ===\n\n{rec_trans}")
                            elif rec_status in ["pending", "processing"]:
                                all_completed = False
                                
                        merged_transcription = "\n\n--- TRANSCRIPTION SUIVANTE ---\n\n".join(merged_parts)
                        
                        update_dict = {
                            "audioRecordings": recordings,
                            "audioRecording.transcription": merged_transcription,
                            "audioRecording.transcriptionStatus": "completed" if all_completed else "processing",
                            "audioRecording.transcribedAt": datetime.now().isoformat(),
                            "audioRecording.transcriptionEngine": "speechmatics-async",
                            "dateUpdated": datetime.now().isoformat()
                        }
                        
                        # Merge speaker mappings for legacy compatibility
                        merged_speaker_mapping = {}
                        for rec in recordings:
                            m = rec.get("speakerMapping")
                            if isinstance(m, dict):
                                merged_speaker_mapping.update(m)
                                
                        if merged_speaker_mapping:
                            update_dict["audioRecording.speakerMapping"] = merged_speaker_mapping
                            
                        transaction.update(doc_ref, update_dict)
                        return True
                    return False
                
                transaction = db.transaction()
                success = update_in_transaction(
                    transaction,
                    meeting_ref,
                    recording_index,
                    identified_transcription,
                    full_transcription,
                    speaker_mapping,
                    result["result"].get("segments", [])
                )
                
                if success:
                    print(f"[Check Transcription] Transaction updated audioRecordings[{recording_index}] and merged transcriptions")
                else:
                    print(f"[Check Transcription] Transaction failed for index {recording_index}")
            else:
                # Legacy: update audioRecording (singular) - no transaction needed
                legacy = meeting_data.get("audioRecording", {})
                update_dict = {
                    "audioRecording.transcription": identified_transcription,
                    "audioRecording.transcriptionStatus": "completed",
                    "audioRecording.transcribedAt": datetime.now().isoformat(),
                    "audioRecording.transcriptionEngine": "speechmatics-async",
                    "dateUpdated": datetime.now().isoformat()
                }
                if "originalTranscription" not in legacy:
                    update_dict["audioRecording.originalTranscription"] = full_transcription
                if speaker_mapping:
                    update_dict["audioRecording.speakerMapping"] = speaker_mapping
                meeting_ref.update(update_dict)
            
            print(f"[Async Transcription] Job {job_id} completed! {len(identified_transcription)} chars saved.")
            return {
                "status": "completed",
                "message": f"Transcription completed. {len(identified_transcription)} characters."
            }
        
        elif result["status"] == "failed":
            # Update failure status (also use transaction for array)
            if recording_index >= 0:
                @firestore.transactional
                def update_failure_in_transaction(transaction, doc_ref, rec_index, error_msg):
                    snapshot = doc_ref.get(transaction=transaction)
                    if not snapshot.exists:
                        return
                    
                    data = snapshot.to_dict()
                    recordings = data.get("audioRecordings", [])
                    
                    if rec_index < len(recordings):
                        recordings[rec_index]["transcriptionStatus"] = "failed"
                        recordings[rec_index]["transcriptionError"] = error_msg
                        
                        transaction.update(doc_ref, {
                            "audioRecordings": recordings,
                            "dateUpdated": datetime.now().isoformat()
                        })
                
                transaction = db.transaction()
                update_failure_in_transaction(transaction, meeting_ref, recording_index, result.get("error", "Unknown error"))
            else:
                meeting_ref.update({
                    "audioRecording.transcriptionStatus": "failed",
                    "audioRecording.transcriptionError": result.get("error", "Unknown error"),
                    "dateUpdated": datetime.now().isoformat()
                })
            return {
                "status": "failed",
                "error": result.get("error", "Unknown error")
            }
        
        else:
            return {
                "status": "processing",
                "message": "Transcription still in progress. Check again in a few minutes."
            }
        
    except Exception as e:
        print(f"[Async Transcription] Check error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )
