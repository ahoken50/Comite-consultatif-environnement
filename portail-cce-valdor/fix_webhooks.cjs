const fs = require('fs');

const missingCode = `
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
`;

let content = fs.readFileSync('functions-python/ai_agents/webhooks.py', 'utf8');

// Append missing code
content = content + missingCode;

// Rename the function to match what main.py expects
content = content.replace('def check_transcription(req: https_fn.CallableRequest) -> dict:', 'def check_transcription_status(req: https_fn.CallableRequest) -> dict:');

fs.writeFileSync('functions-python/ai_agents/webhooks.py', content);
console.log("Fixed webhooks.py");
