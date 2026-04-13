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
    We also receive the transcript in the request body (json-v2 format).
    """
    try:
        # Get query params
        job_id = req.args.get("id", "unknown")
        status = req.args.get("status", "unknown")
        
        print(f"[Speechmatics Webhook] ðŸ“¨ Received callback for job {job_id}, status={status}")
        
        if status != "success":
            print(f"[Speechmatics Webhook] âš ï¸ Job {job_id} failed with status: {status}")
            # We don't know the meeting_id here without calling Speechmatics API
            # Just log and return OK to prevent retries
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
            # Try to parse as JSON anyway
            try:
                transcript_data = json.loads(req.get_data(as_text=True))
            except:
                transcript_data = {}
        
        # Log metadata for verification
        job_info = transcript_data.get("job", {})
        tracking = job_info.get("tracking", {})
        metadata = transcript_data.get("metadata", {})
        
        print(f"[Speechmatics Webhook] ðŸ“‹ Job Info: {json.dumps(job_info)}")
        print(f"[Speechmatics Webhook] ðŸ·ï¸ Tracking Metadata: {json.dumps(tracking)}")
        
        # Extract meeting_id from tracking.reference
        meeting_id = tracking.get("reference")
        
        if not meeting_id:
            # Fallback to metadata tracking
            tracking_alt = metadata.get("tracking", {})
            meeting_id = tracking_alt.get("reference")
            print(f"[Speechmatics Webhook] â„¹ï¸ Found meeting_id in fallback metadata: {meeting_id}")
        
        if not meeting_id:
            print(f"[Speechmatics Webhook] âŒ ERROR: No meeting_id found in tracking.reference for job {job_id}")
            print(f"[Speechmatics Webhook] Full data keys: {list(transcript_data.keys())}")
            return https_fn.Response(
                json.dumps({"error": "No meeting_id in tracking.reference"}),
                status=200,  # Return 200 to prevent retries
                content_type="application/json"
            )
        
        print(f"[Speechmatics Webhook] Processing transcript for meeting {meeting_id}")
        
        # Format the transcript using existing function
        formatted = format_speechmatics_output(transcript_data)
        full_transcription = formatted.get("text", "")
        
        print(f"[Speechmatics Webhook] Formatted transcript: {len(full_transcription)} characters")
        
        # Save to Firestore
        db = firestore.client()
        meeting_ref = db.collection("meetings").document(meeting_id)
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
        
        # Check if we have audioRecordings array with matching job
        updated_array = False
        if isinstance(audio_recordings, list) and len(audio_recordings) > 0:
            for i, rec in enumerate(audio_recordings):
                if rec.get("speechmaticsJobId") == job_id:
                    audio_recordings[i]["transcription"] = full_transcription
                    # Save original transcription (with S# labels) for reset/re-id
                    if "originalTranscription" not in audio_recordings[i]:
                        audio_recordings[i]["originalTranscription"] = full_transcription
                    
                    # Save segments for Reinforcement Learning (Active ID)
                    audio_recordings[i]["segments"] = formatted.get("segments", [])
                    
                    audio_recordings[i]["transcriptionStatus"] = "completed"
                    audio_recordings[i]["transcribedAt"] = datetime.now().isoformat()
                    audio_recordings[i]["transcriptionEngine"] = "speechmatics-webhook"
                    updated_array = True
                    print(f"[Speechmatics Webhook] Updated audioRecordings[{i}] for job {job_id}")
                    break
            
            if updated_array:
                meeting_ref.update({
                    "audioRecordings": audio_recordings,
                    "dateUpdated": datetime.now().isoformat()
                })
        
        # Always update legacy audioRecording field too (backward compatibility)
        meeting_ref.update({
            "audioRecording.transcription": full_transcription,
            "audioRecording.transcriptionStatus": "completed",
            "audioRecording.transcribedAt": datetime.now().isoformat(),
            "audioRecording.transcriptionEngine": "speechmatics-webhook",
            "audioRecording.speechmaticsJobId": job_id,
            "dateUpdated": datetime.now().isoformat()
        })
        
        print(f"[Speechmatics Webhook] SUCCESS! Transcript saved for meeting {meeting_id} (array={updated_array})")
        
        # =====================================================================
        # SPEAKER IDENTIFICATION - Multi-Strategy (runs after transcription)
        # =====================================================================
        speaker_mapping = {}
        warnings = {}
        unidentified = []
        try:
            print(f"[Speaker ID] Starting identification for meeting {meeting_id}")
            
            from speaker_identification import (
                fuse_scores,
                contextual_ai_strategy,
                linguistic_pattern_strategy,
                name_mention_strategy,
                auto_identification_strategy
            )
            
            # Get enrolled speakers
            enrolled_speakers = get_enrolled_speakers()
            
            if enrolled_speakers and len(enrolled_speakers) > 0:
                segments = formatted.get("segments", [])
                known_member_names = [s["name"] for s in enrolled_speakers]
                # speaker_mapping = {}  # mapped from above
                meeting_context = {"type": "Régulière"}
                
                # === NEW ROBUST IDENTIFICATION LOGIC ===
                
                # 1. Find audio URL for voice embedding
                audio_url = None
                if isinstance(audio_recordings, list):
                    for rec in audio_recordings:
                        if rec.get("speechmaticsJobId") == job_id:
                            audio_url = rec.get("downloadURL") or rec.get("url") or rec.get("fileUrl")
                            break
                            
                modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
                voice_available = bool(audio_url and modal_endpoint)
                print(f"[Speaker ID] Auto-ID starting. Voice available: {voice_available}, URL found: {bool(audio_url)}")

                # 2. Collect unique speakers and timestamps
                unique_speakers = {}
                speaker_timestamps = {}
                import re
                
                for segment in segments:
                    speaker_label = segment.get("speaker", "S0")
                    text = segment.get("text", "")
                    
                    if not re.match(r'^S\d+$', speaker_label):
                        continue
                        
                    if speaker_label not in unique_speakers:
                        unique_speakers[speaker_label] = []
                    unique_speakers[speaker_label].append(text)
                    
                    if speaker_label not in speaker_timestamps:
                        speaker_timestamps[speaker_label] = {
                            "start": segment.get("start", 0),
                            "end": segment.get("start", 0) + 30
                        }

                # 3. Identify each unique speaker
                for speaker_label, texts in unique_speakers.items():
                    combined_text = " ".join(texts[:5])
                    
                    # Voice Embedding Strategy
                    voice_scores = {}
                    if voice_available and speaker_label in speaker_timestamps:
                        ts = speaker_timestamps[speaker_label]
                        try:
                            # Use global function from main.py
                            segment_embedding = extract_audio_segment_embedding(audio_url, ts["start"], ts["end"])
                            if segment_embedding:
                                voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                        except Exception as e:
                            print(f"[Speaker ID] Voice embedding failed for {speaker_label}: {e}")

                            print(f"[Speaker ID] Voice embedding failed for {speaker_label}: {e}")

                    # Other Strategies
                    # Pass full enrolled_speakers list to AI for role-based inference
                    context_scores = contextual_ai_strategy(combined_text, meeting_context, enrolled_speakers)
                    linguistic_scores = linguistic_pattern_strategy(combined_text, enrolled_speakers)
                    mention_scores = name_mention_strategy(combined_text, None, known_member_names)
                    auto_id_scores = auto_identification_strategy(combined_text, known_member_names)
                    
                    # Fuse
                    identified_name, confidence = fuse_scores(
                        voice_scores, context_scores, linguistic_scores, mention_scores, auto_id_scores,
                        confidence_threshold=0.2
                    )
                    
                    if identified_name:
                        speaker_mapping[speaker_label] = identified_name
                        print(f"[Speaker ID] Identified {speaker_label} -> {identified_name} ({confidence:.2f})")
                
                # If we identified any speakers, update the transcript with names
                if speaker_mapping:
                    # Rebuild transcript with identified names
                    identified_parts = []
                    for seg in segments:
                        start = seg.get('start', 0)
                        m = int(start // 60)
                        s = int(start % 60)
                        timestamp = f"[{m:02d}:{s:02d}]"
                        
                        original = seg.get("speaker", "S0")
                        name = speaker_mapping.get(original, original)
                        identified_parts.append(f"{timestamp} [{name}] {seg.get('text', '')}")
                    
                    identified_transcription = "\n\n".join(identified_parts)
                    
                    # Save identified transcript
                    if updated_array and audio_recordings:
                        for i, rec in enumerate(audio_recordings):
                            if rec.get("speechmaticsJobId") == job_id:
                                audio_recordings[i]["transcription"] = identified_transcription
                                audio_recordings[i]["speakerMapping"] = speaker_mapping
                                break
                        meeting_ref.update({
                            "audioRecordings": audio_recordings,
                            "dateUpdated": datetime.now().isoformat()
                        })
                    
                    meeting_ref.update({
                        "audioRecording.transcription": identified_transcription,
                        "audioRecording.speakerMapping": speaker_mapping,
                        "dateUpdated": datetime.now().isoformat()
                    })
                    
                    print(f"[Speaker ID] Updated transcript with {len(speaker_mapping)} identified speakers")
                    full_transcription = identified_transcription
            else:
                print("[Speaker ID] No enrolled speakers, skipping identification")
                
        except Exception as id_err:
            print(f"[Speaker ID] Warning: Identification failed ({str(id_err)}), using original")
            import traceback
            traceback.print_exc()
        
        # Prepare Response
        return https_fn.Response(
            json.dumps({
                "success": True, 
                "meetingId": meeting_id, 
                "speakers": speaker_mapping,
                "warnings": warnings, # New field for UI
                "unidentifiedCount": len(unidentified)
            }),
            status=200,
            content_type="application/json"
        )
        
    except Exception as e:
        print(f"[Speechmatics Webhook] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        # Return 200 anyway to prevent Speechmatics retries (we logged the error)
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=200,
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
                original_count = len(known_member_names)
                known_member_names = [n for n in known_member_names if n in present_names]
                filtered_count = original_count - len(known_member_names)
                print(f"[Manual Speaker ID] PRE-FLIGHT: Filtered {filtered_count} absent members. {len(known_member_names)} present candidates remain.")
        
        # Find transcription and audio URL to process
        transcription_text = None
        audio_url = None
        audio_recordings = meeting_data.get("audioRecordings", [])
        target_index = -1
        
        if storage_path and audio_recordings:
            # Find specific recording
            for i, rec in enumerate(audio_recordings):
                if rec.get("storagePath") == storage_path:
                    # Prefer original transcription with S# labels for re-identification
                    transcription_text = rec.get("originalTranscription") or rec.get("transcription", "")
                    audio_url = rec.get("downloadURL") or rec.get("url")
                    target_index = i
                    break
        elif audio_recordings:
            # Use first recording with transcription
            for i, rec in enumerate(audio_recordings):
                if rec.get("transcription"):
                    # Prefer original transcription with S# labels for re-identification
                    transcription_text = rec.get("originalTranscription") or rec["transcription"]
                    audio_url = rec.get("downloadURL") or rec.get("url")
                    target_index = i
                    break
        
        # Fallback to legacy field
        if not transcription_text:
            transcription_text = meeting_data.get("audioRecording", {}).get("transcription", "")
        
        if not transcription_text:
            return {"success": False, "error": "No transcription found"}
            
        print(f"[Manual Speaker ID] Found transcription ({len(transcription_text)} chars)")
        print(f"[Manual Speaker ID] Target index: {target_index}")
        if target_index >= 0:
            rec = audio_recordings[target_index]
            print(f"[Manual Speaker ID] Recording data: keys={list(rec.keys())}")
            print(f"[Manual Speaker ID] storagePath: {rec.get('storagePath')}")
            print(f"[Manual Speaker ID] downloadURL: {rec.get('downloadURL') and 'SET'}")
            print(f"[Manual Speaker ID] fileUrl: {rec.get('fileUrl') and 'SET'}")
            print(f"[Manual Speaker ID] url: {rec.get('url') and 'SET'}")
            
            # Ensure we get the URL (try all possible fields)
            if not audio_url:
                audio_url = rec.get("fileUrl") or rec.get("url") or rec.get("downloadURL")
        
        if not audio_url:
            # Try legacy field
            legacy = meeting_data.get("audioRecording", {})
            audio_url = legacy.get("downloadURL") or legacy.get("fileUrl") or legacy.get("url")
            print(f"[Manual Speaker ID] Checked legacy audioRecording. found URL? {bool(audio_url)}")
        
        # Parse transcription into segments
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
            return {"success": False, "error": "Could not parse transcription segments"}
        
        print(f"[Manual Speaker ID] Processing {len(segments)} segments")
        
        print(f"[Manual Speaker ID] VERSION: 2026-02-06-OPTIMIZED-V2 (Longest Segment + Single Download)")
        
        # Collect unique speakers and their sample texts
        unique_speakers = {}  # {"S0": ["text1", "text2"], ...}
        
        for segment in segments:
            speaker_label = segment["speaker"]
            
            # Skip if already a name (not S0/S1 format)
            if not re.match(r'^S\d+$', speaker_label):
                continue
            
            if speaker_label not in unique_speakers:
                unique_speakers[speaker_label] = []
            unique_speakers[speaker_label].append(segment["text"])
        
        print(f"[Manual Speaker ID] Found {len(unique_speakers)} unique speakers")
        
        # Collect timestamps for each unique speaker
        speaker_timestamps = {}  # {"S0": {"start": 0, "end": 30}, ...}
        for segment in segments:
            label = segment["speaker"]
            label = segment["speaker"]
            if re.match(r'^S\d+$', label):
                # Calculate duration of this segment
                start = segment.get("start", 0)
                end = segment.get("end", start + 5) # Default to 5s if end missing
                duration = end - start
                
                # Check if this is the best sample so far for this speaker
                if label not in speaker_timestamps:
                    speaker_timestamps[label] = {"start": start, "end": end, "duration": duration}
                elif duration > speaker_timestamps[label]["duration"]:
                    # Found a longer sample
                    speaker_timestamps[label] = {"start": start, "end": end, "duration": duration}
        
        # Initialize speaker_stats before using it
        speaker_stats = {}  # {speaker_label: {"segments": 3, "total_time": 120, "avg_duration": 40}}
        
        # Calculate speaker time statistics (who spoke most, average duration)
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
        
        # Calculate averages and rank speakers by talk time
        for label, stats in speaker_stats.items():
            if stats["segments"] > 0:
                stats["avg_duration"] = stats["total_time"] / stats["segments"]
        
        # Sort by total time to identify "main speakers" vs "participants"
        sorted_speakers = sorted(speaker_stats.items(), key=lambda x: x[1]["total_time"], reverse=True)
        if sorted_speakers:
            print(f"[Manual Speaker ID] STATS: Top speaker {sorted_speakers[0][0]} ({sorted_speakers[0][1]['total_time']:.0f}s)")
        
        speaker_mapping = {}
        unidentified = []
        modal_endpoint = os.environ.get("MODAL_ENDPOINT_URL")
        voice_available = bool(audio_url and modal_endpoint)
        
        print(f"[Manual Speaker ID] Audio URL: {audio_url[:100] if audio_url else 'NOT FOUND'}")
        print(f"[Manual Speaker ID] MODAL_ENDPOINT_URL: {'SET' if modal_endpoint else 'NOT SET'}")
        print(f"[Manual Speaker ID] Voice embedding available: {voice_available}")
        
        warnings = {} # Collect AI feedback here
        confidence_scores = {}  # {speaker_label: {"score": 0.85, "method": "voice+context"}}
        profile_strength = {}  # {member_name: {"samples": 5, "quality": "robust", "variance": 0.15}}
        interruptions = []  # [{speaker: "S1", interrupted: "S2", time: 120, context: "..."}]
        
        # #6 INTERRUPTION DETECTION: Analyze segment transitions for quick speaker changes
        prev_segment = None
        for segment in segments:
            if prev_segment:
                prev_end = prev_segment.get("end", 0)
                curr_start = segment.get("start", 0)
                prev_speaker = prev_segment.get("speaker", "")
                curr_speaker = segment.get("speaker", "")
                
                # Quick transition (<0.5s) between different speakers = potential interruption
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
            print(f"[Manual Speaker ID] INTERRUPTIONS DETECTED: {len(interruptions)} speaker cut-offs")
            # Summarize interruptions for warnings
            interrupter_counts = {}
            for intr in interruptions:
                sp = intr["interrupter"]
                interrupter_counts[sp] = interrupter_counts.get(sp, 0) + 1
            top_interrupter = max(interrupter_counts.items(), key=lambda x: x[1]) if interrupter_counts else None
            if top_interrupter and top_interrupter[1] >= 3:
                warnings["_interruptions"] = f"⚡ {top_interrupter[0]} a interrompu {top_interrupter[1]} fois"
        
        
        # Build profile strength from enrolled speakers
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
        
        
        # OPTIMIZATION: Download audio ONCE if voice ID is available
        # This prevents downloading 100MB+ file for EVERY speaker segment (which caused timeouts)
        local_audio_path = None
        if voice_available and len(unique_speakers) > 0:
            try:
                import tempfile
                import shutil
                print(f"[Manual Speaker ID] Pre-downloading audio for optimization...")
                with requests.get(audio_url, stream=True, timeout=120) as r:
                    if r.ok:
                        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                            shutil.copyfileobj(r.raw, tmp)
                            local_audio_path = tmp.name
                            print(f"[Manual Speaker ID] Audio downloaded to {local_audio_path}")
            except Exception as e:
                print(f"[Manual Speaker ID] Pre-download failed, falling back to per-segment download: {e}")
        
        for speaker_label, texts in unique_speakers.items():
            combined_text = " ".join(texts[:3])  # Use first 3 segments max
            
            # Initialize scores dict
            voice_scores = {}
            
            # Try voice embedding if available (50% weight)
            if voice_available and speaker_label in speaker_timestamps:
                ts = speaker_timestamps[speaker_label]
                print(f"[Manual Speaker ID] Getting voice embedding for {speaker_label} ({ts['start']:.0f}s-{ts['end']:.0f}s)")
                # Use local path if downloaded, else fallback to URL
                source_audio = local_audio_path if local_audio_path else audio_url
                segment_embedding = extract_audio_segment_embedding(source_audio, ts["start"], ts["end"])
                if segment_embedding:
                    voice_scores = compare_embedding_with_speakers(segment_embedding, enrolled_speakers)
                    print(f"[Manual Speaker ID] Voice scores: {voice_scores}")
            
            # Fast pattern strategies
            linguistic_scores = linguistic_pattern_strategy(
                combined_text, enrolled_speakers
            )
            mention_scores = name_mention_strategy(
                combined_text, None, known_member_names
            )
            auto_id_scores = auto_identification_strategy(
                combined_text, known_member_names
            )
            
            # Fuse with proper weighting - ADJUSTED FOR ACCURACY
            best_score = 0
            best_name = None
            
            # Find the max voice score to see if we have a strong candidate
            max_voice_score = 0
            if voice_scores:
                max_voice_score = max(voice_scores.values())
            
            for name in known_member_names:
                if voice_scores:
                    # Voice carries 70% weight now to be decisive
                    v_score = voice_scores.get(name, 0)
                    
                    # Bonus: If this person is the clear winner in voice (top 1), give extra boost
                    # This helps break ties against "average" profiles like Michaël seems to be
                    voice_bonus = 0.05 if v_score == max_voice_score and v_score > 0.75 else 0
                    
                    score = (
                        (v_score + voice_bonus) * 0.70 +
                        linguistic_scores.get(name, 0) * 0.10 +
                        mention_scores.get(name, 0) * 0.10 +
                        auto_id_scores.get(name, 0) * 0.10
                    )
                else:
                    # Without voice, rely on patterns
                    score = (
                        linguistic_scores.get(name, 0) * 0.4 +
                        mention_scores.get(name, 0) * 0.3 +
                        auto_id_scores.get(name, 0) * 0.3
                    )
                
                if score > best_score:
                    best_score = score
                    best_name = name
            
            # ---------------------------------------------------------
            # ROBUST DECISION LOGIC (User Request)
            # ---------------------------------------------------------
            
            # Dynamic threshold: If voice was used, we expect higher confidence
            threshold = 0.60 if voice_scores else 0.15
            
            rejection_reason = None
            ai_warning = None
            
            if best_score >= threshold and best_name:
                 # 1. MARGIN CHECK (Top 2 Comparison)
                 if voice_scores:
                     sorted_voice = sorted(voice_scores.items(), key=lambda x: x[1], reverse=True)
                     if len(sorted_voice) >= 2:
                         winner = sorted_voice[0]
                         runner_up = sorted_voice[1]
                         margin = winner[1] - runner_up[1]
                         
                         context_support_winner = linguistic_scores.get(winner[0], 0) + auto_id_scores.get(winner[0], 0)
                         context_support_runner = linguistic_scores.get(runner_up[0], 0) + auto_id_scores.get(runner_up[0], 0)
                         
                         if margin < 0.05 and context_support_winner <= context_support_runner:
                             print(f"[Manual Speaker ID] AMBIGUITY: {winner[0]} vs {runner_up[0]} (Margin {margin:.3f}).")
                             best_name = None 
                             rejection_reason = "Ambiguïté (Scores trop proches)"
                             ai_warning = f"Ambiguïté entre {winner[0]} ({winner[1]:.2f}) et {runner_up[0]} ({runner_up[1]:.2f})"

                 # 2. GENDER / ROLE GUARD (Enhanced with First Name Inference)
                 if best_name:
                      # Common French first names for gender inference
                      FEMALE_NAMES = {
                          "patricia", "marguerite", "marie", "anne", "sophie", "nathalie", 
                          "isabelle", "valérie", "sylvie", "christine", "françoise", "catherine",
                          "nicole", "monique", "julie", "audrey", "caroline", "jacinthe",
                          "martine", "claire", "louise", "jeanne", "hélène", "madeleine",
                          "céline", "brigitte", "danielle", "michèle", "josée", "diane",
                          "linda", "chantal", "lucie", "manon", "karine", "stéphanie"
                      }
                      MALE_NAMES = {
                          "donald", "pierre", "jean", "michel", "jacques", "paul", "andré",
                          "robert", "françois", "alain", "claude", "yves", "louis", "daniel",
                          "richard", "gilles", "marc", "bernard", "serge", "martin", "denis",
                          "sébastien", "christian", "éric", "philippe", "patrick", "stéphane",
                          "marcel", "roger", "raymond", "normand", "guy", "luc", "benoit",
                          "olivier", "mathieu", "maxime", "simon", "alexandre", "michaël"
                      }
                      
                      # Extract first name from candidate (handle "Prénom Nom" format)
                      first_name = best_name.split()[0].lower().replace("mme", "").replace("m.", "").strip()
                      if len(first_name) < 2 and len(best_name.split()) > 1:
                          first_name = best_name.split()[1].lower()
                      
                      # Determine candidate gender from name
                      is_female_candidate = (
                          first_name in FEMALE_NAMES or
                          "Mme" in best_name or "Madame" in best_name or "Conseillère" in best_name
                      )
                      is_male_candidate = (
                          first_name in MALE_NAMES or
                          "M." in best_name or "Monsieur" in best_name or "Conseiller " in best_name
                      )
                      
                      # Text context cues
                      text_female_cues = ["madame", "mme", "présidente", "conseillère", "mairesse", "elle a dit", "elle propose"]
                      text_male_cues = ["monsieur", "m.", "président", "conseiller", "maire", "il a dit", "il propose"]
                      
                      found_female = any(cue in combined_text.lower() for cue in text_female_cues)
                      found_male = any(cue in combined_text.lower() for cue in text_male_cues)
                      
                      if is_male_candidate and found_female and not found_male:
                          print(f"[Manual Speaker ID] GENDER GUARD: Rejecting {best_name} (M/{first_name}) because text context implies Female.")
                          best_name = None
                          rejection_reason = "Incohérence de Genre (H vs F)"
                          ai_warning = f"Rejeté: {first_name} est Homme mais le contexte indique une Femme."
                      elif is_female_candidate and found_male and not found_female:
                          print(f"[Manual Speaker ID] GENDER GUARD: Rejecting {best_name} (F/{first_name}) because text context implies Male.")
                          best_name = None
                          rejection_reason = "Incohérence de Genre (F vs H)"
                          ai_warning = f"Rejeté: {first_name} est Femme mais le contexte indique un Homme."

            if best_score >= threshold and best_name:
                speaker_mapping[speaker_label] = best_name
                print(f"[Manual Speaker ID] {speaker_label} -> {best_name} (score: {best_score:.2f}, voice_max: {max_voice_score:.2f})")
                
                # Record confidence score and identification method
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
                
                # AUTO-LEARNING: If voice confidence is very high (>0.85), auto-reinforce in background
                # This helps build robust profiles without user intervention
                if max_voice_score > 0.85 and voice_available and speaker_label in speaker_timestamps:
                    try:
                        # Find member_id for this name
                        member_id = None
                        for sp in enrolled_speakers:
                            if sp.get("name") == best_name:
                                member_id = sp.get("id")
                                break
                        
                        if member_id:
                            ts = speaker_timestamps[speaker_label]
                            print(f"[Auto-Learn] HIGH CONFIDENCE ({max_voice_score:.2f}): Auto-reinforcing {best_name}")
                            
                            # Fire-and-forget: Extract embedding and save (simplified inline version)
                            try:
                                source = local_audio_path if local_audio_path else audio_url
                                auto_embedding = extract_audio_segment_embedding(source, ts["start"], ts["end"])
                                if auto_embedding:
                                    # Write directly to Supabase (primary store)
                                    from supabase_embeddings import add_embedding, is_duplicate as emb_is_dup, get_embedding_count
                                    if not emb_is_dup(best_name, auto_embedding, threshold=0.95):
                                        add_embedding(best_name, auto_embedding, member_id, sample_source="auto_learn")
                                        count = get_embedding_count(best_name)
                                        # Update Firestore metadata only
                                        db.collection("members").document(member_id).update({
                                            "voiceSampleCount": count,
                                            "lastVoiceUpdate": datetime.now().isoformat()
                                        })
                                        print(f"[Auto-Learn] SUCCESS: Added sample to {best_name} ({count} total)")
                                    else:
                                        print(f"[Auto-Learn] Skipping duplicate for {best_name}")
                            except Exception as ae:
                                print(f"[Auto-Learn] Failed for {best_name}: {ae}")
                    except Exception as e:
                        print(f"[Auto-Learn] Skipped: {e}")
            else:
                unidentified.append((speaker_label, combined_text))
                # Store warning for frontend
                if ai_warning:
                     warnings[speaker_label] = ai_warning
                     print(f"[Manual Speaker ID] Added warning for {speaker_label}: {ai_warning}")

        
        print(f"[Manual Speaker ID] Fast strategies identified {len(speaker_mapping)}/{len(unique_speakers)} speakers")
        print(f"[Manual Speaker ID] Unidentified speakers to process via GROQ: {len(unidentified)}")
        
        # For remaining unidentified, make GROQ batch calls
        groq_api_key = os.environ.get("GROQ_API_KEY")
        if not groq_api_key:
            print("[Manual Speaker ID] WARNING: GROQ_API_KEY not set! Cannot identify remaining speakers via AI.")
        
        if unidentified and groq_api_key:
            try:
                import json as json_lib
                
                # Process in batches of 10 to avoid token limits
                batch_size = 10
                for batch_start in range(0, len(unidentified), batch_size):
                    batch = unidentified[batch_start:batch_start + batch_size]
                    print(f"[Manual Speaker ID] Processing GROQ batch {batch_start // batch_size + 1} ({len(batch)} speakers)")
                    
                    batch_prompt = f"""Analyse ces segments de transcription d'une réunion CCE.
Membres présents: {', '.join(known_member_names)}

Pour chaque intervenant, identifie qui parle basé sur le contenu, le style de parole, et les indices contextuels:
"""
                    for label, text in batch:
                        batch_prompt += f"\n{label}: \"{text[:300]}...\""
                    
                    batch_prompt += """

Retourne un JSON simple avec le mapping: {"S0": "Nom Complet", "S1": "Autre Nom"}
Si tu ne peux pas identifier un intervenant, ne l'inclus pas dans le JSON.
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
                            "max_tokens": 500
                        },
                        timeout=30
                    )
                    
                    if response.ok:
                        result = response.json()
                        content = result["choices"][0]["message"]["content"]
                        # Extract JSON from response (may have markdown code blocks)
                        if "```json" in content:
                            content = content.split("```json")[1].split("```")[0]
                        elif "```" in content:
                            content = content.split("```")[1].split("```")[0]
                        groq_mapping = json_lib.loads(content.strip())
                        
                        for label, name in groq_mapping.items():
                            if name in known_member_names and label not in speaker_mapping:
                                speaker_mapping[label] = name
                                print(f"[Manual Speaker ID] {label} -> {name} (GROQ batch)")
                    else:
                        print(f"[Manual Speaker ID] GROQ request failed: {response.status_code} - {response.text[:200]}")
            except Exception as groq_err:
                print(f"[Manual Speaker ID] GROQ batch failed: {groq_err}")
        
        if not speaker_mapping:
            if local_audio_path and os.path.exists(local_audio_path):
                os.unlink(local_audio_path)
            return {"success": True, "message": "No speakers could be identified", "mapping": {}}
        
        # Rebuild transcript with identified names
        identified_parts = []
        for seg in segments:
            m = int(seg["start"] // 60)
            s = int(seg["start"] % 60)
            timestamp = f"[{m:02d}:{s:02d}]"
            original = seg["speaker"]
            name = speaker_mapping.get(original, original)
            identified_parts.append(f"{timestamp} [{name}] {seg['text']}")
        
        identified_transcription = "\n\n".join(identified_parts)
        
        # Save
        if target_index >= 0 and audio_recordings:
            audio_recordings[target_index]["transcription"] = identified_transcription
            audio_recordings[target_index]["speakerMapping"] = speaker_mapping
            meeting_ref.update({
                "audioRecordings": audio_recordings,
                "dateUpdated": datetime.now().isoformat()
            })
        
        meeting_ref.update({
            "audioRecording.transcription": identified_transcription,
            "audioRecording.speakerMapping": speaker_mapping,
            "dateUpdated": datetime.now().isoformat()
        })
        
        print(f"[Manual Speaker ID] SUCCESS! Identified {len(speaker_mapping)} speakers")
        
        if local_audio_path and os.path.exists(local_audio_path):
            os.unlink(local_audio_path)
        
        # Check for missing attendees (present members not assigned to any speaker)
        identified_names = set(speaker_mapping.values())
        if attendees:
            present_attendees = [a.get("name") or a.get("displayName") for a in attendees 
                                 if a.get("status", "").lower() in ["present", "présent", ""]]
            missing_speakers = [n for n in present_attendees if n and n not in identified_names]
            
            if missing_speakers:
                warnings["_missing"] = f"Membres présents non détectés: {', '.join(missing_speakers)}"
                print(f"[Manual Speaker ID] MISSING ATTENDEES: {missing_speakers}")
        
        # Clean speaker_stats for JSON (remove texts array to reduce size)
        clean_stats = {}
        for label, stats in speaker_stats.items():
            clean_stats[label] = {
                "segments": stats["segments"],
                "total_time": round(stats["total_time"], 1),
                "avg_duration": round(stats.get("avg_duration", 0), 1)
            }
        
        return {
            "success": True,
            "identifiedCount": len(speaker_mapping),
            "mapping": speaker_mapping,
            "speakers": speaker_mapping,  # Alias for frontend compatibility
            "warnings": warnings,
            # Advanced ML Analytics
            "analytics": {
                "confidence": confidence_scores,
                "speakerStats": clean_stats,
                "profileStrength": profile_strength,
                "topSpeaker": sorted_speakers[0][0] if sorted_speakers else None,
                "totalSpeakers": len(unique_speakers),
                "autoLearnedCount": sum(1 for c in confidence_scores.values() if c.get("method") == "voice_high")
            }
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
            # Save result to Firestore using a transaction to prevent race conditions
            full_transcription = result["result"].get("text", "")
            
            # Update the correct location
            if recording_index >= 0:
                # Use transaction to safely update the array
                @firestore.transactional
                def update_in_transaction(transaction, doc_ref, rec_index, transcription_text):
                    snapshot = doc_ref.get(transaction=transaction)
                    if not snapshot.exists:
                        return False
                    
                    data = snapshot.to_dict()
                    recordings = data.get("audioRecordings", [])
                    
                    if rec_index < len(recordings):
                        recordings[rec_index]["transcription"] = transcription_text
                        recordings[rec_index]["transcriptionStatus"] = "completed"
                        recordings[rec_index]["transcribedAt"] = datetime.now().isoformat()
                        recordings[rec_index]["transcriptionEngine"] = "speechmatics-async"
                        
                        transaction.update(doc_ref, {
                            "audioRecordings": recordings,
                            "dateUpdated": datetime.now().isoformat()
                        })
                        return True
                    return False
                
                transaction = db.transaction()
                success = update_in_transaction(transaction, meeting_ref, recording_index, full_transcription)
                
                if success:
                    print(f"[Check Transcription] Transaction updated audioRecordings[{recording_index}] with {len(full_transcription)} chars")
                else:
                    print(f"[Check Transcription] Transaction failed for index {recording_index}")
            else:
                # Legacy: update audioRecording (singular) - no transaction needed
                meeting_ref.update({
                    "audioRecording.transcription": full_transcription,
                    "audioRecording.transcriptionStatus": "completed",
                    "audioRecording.transcribedAt": datetime.now().isoformat(),
                    "audioRecording.transcriptionEngine": "speechmatics-async",
                    "dateUpdated": datetime.now().isoformat()
                })
            
            print(f"[Async Transcription] Job {job_id} completed! {len(full_transcription)} chars saved.")
            return {
                "status": "completed",
                "message": f"Transcription completed. {len(full_transcription)} characters."
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
