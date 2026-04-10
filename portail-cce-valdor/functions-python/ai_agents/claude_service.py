import os
from datetime import datetime
from firebase_admin import firestore
from firebase_functions import https_fn, options
from core.config import get_anthropic_client


@https_fn.on_call(
    timeout_sec=540,  # 9 minutes timeout for generation
    memory=options.MemoryOption.GB_1
)
def generate_minutes_claude(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function to generate meeting minutes draft using Claude API.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    system_prompt = data.get("systemPrompt")
    user_message = data.get("userMessage")
    meeting_id = data.get("meetingId")

    if not system_prompt or not user_message:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: systemPrompt, userMessage"
        )
    
    # Check API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
         raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="ANTHROPIC_API_KEY is not configured on server."
        )

    print(f"[Claude] Generating minutes for meeting {meeting_id}...")

    # Inject Active Members List for Attendance Verification
    try:
        db = firestore.client()
        members_ref = db.collection("members").where("isActive", "==", True)
        members_docs = members_ref.stream()
        
        active_members_list = []
        for doc in members_docs:
            m_data = doc.to_dict()
            name = m_data.get("displayName", "Inconnu")
            role = m_data.get("role", "membre")
            active_members_list.append(f"- {name} ({role})")
        
        if active_members_list:
            members_context = "\n\n=== LISTE OFFICIELLE DES MEMBRES ACTIFS (POUR VÃ‰RIFICATION DES PRÃ‰SENCES) ===\n" + "\n".join(active_members_list)
            members_context += "\n\nINSTRUCTION: Utilisez cette liste pour identifier précisément les membres présents et absents. Comparez les locuteurs identifiés dans la transcription avec cette liste.\n"
            system_prompt += members_context
            print(f"[Claude] Injected {len(active_members_list)} active members into prompt context.")
            
    except Exception as e:
        print(f"[Claude] Warning: Failed to fetch active members: {e}")
        # Proceed even if members fetch fails

    try:
        # Singleton access
        client = get_anthropic_client()
        
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20000,
            thinking={
                "type": "enabled",
                "budget_tokens": 12000
            },
            temperature=1,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Handle extended thinking (multiple blocks)
        content_blocks = [block.text for block in message.content if block.type == "text"]
        content = "".join(content_blocks)
        
        # Save to Firestore directly if meetingId provided
        if meeting_id:
            try:
                db = firestore.client()
                meeting_ref = db.collection("meetings").document(meeting_id)
                
                draft_data = {
                    "content": content,
                    "generatedAt": datetime.now().isoformat(),
                    "status": "draft",
                    "version": 1,
                    "engine": "claude-3-5-sonnet"
                }
                
                meeting_ref.update({
                    "minutesDraft": draft_data, 
                    "dateUpdated": datetime.now().isoformat()
                })
                print(f"[Claude] Saved draft to Firestore for {meeting_id}")
            except Exception as e:
                print(f"[Claude] Warning: Failed to save to Firestore: {e}")
                # We still return the content
        
        return {
            "success": True,
            "content": content
        }

    except Exception as e:
        print(f"[Claude] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


@https_fn.on_call(
    timeout_sec=540,
    memory=options.MemoryOption.GB_1
)
def finalize_draft_claude(req: https_fn.CallableRequest) -> dict:
    """
    Cloud Function to finalize draft with user feedback using Claude.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    system_prompt = data.get("systemPrompt")
    user_message = data.get("userMessage")
    meeting_id = data.get("meetingId")
    user_feedback = data.get("userFeedback")

    if not system_prompt or not user_message:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: systemPrompt, userMessage"
        )
    
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
         raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="ANTHROPIC_API_KEY is not configured on server."
        )

    print(f"[Claude] Finalizing draft for meeting {meeting_id}...")

    try:
        # Singleton access
        client = get_anthropic_client()
        
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20000,
            thinking={
                "type": "enabled",
                "budget_tokens": 12000
            },
            temperature=1,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Handle extended thinking (multiple blocks)
        final_content_blocks = [block.text for block in message.content if block.type == "text"]
        final_content = "".join(final_content_blocks)
        
        # Update meeting
        if meeting_id:
            try:
                db = firestore.client()
                meeting_ref = db.collection("meetings").document(meeting_id)
                meeting_doc = meeting_ref.get()
                current_version = 0
                if meeting_doc.exists:
                    meeting_data_dict = meeting_doc.to_dict()
                    draft = meeting_data_dict.get("minutesDraft", {})
                    current_version = draft.get("version", 0)

                meeting_ref.update({
                    "minutesDraft.content": final_content,
                    "minutesDraft.status": "final",
                    "minutesDraft.finalizedAt": datetime.now().isoformat(),
                    "minutesDraft.userFeedback": user_feedback,
                    "minutesDraft.version": current_version + 1,
                    "dateUpdated": datetime.now().isoformat()
                })
                print(f"[Claude] Saved final draft to Firestore for {meeting_id}")
            except Exception as e:
                print(f"[Claude] Warning: Failed to save final draft: {e}")

        return {
            "success": True,
            "content": final_content
        }

    except Exception as e:
        print(f"[Claude] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )

@https_fn.on_call(
    timeout_sec=540,  # 9 minutes timeout to match client
    memory=options.MemoryOption.GB_2
)
def chat_claude(req: https_fn.CallableRequest) -> dict:
    """
    Generic Cloud Function to chat with Claude API (no side effects).
    Useful for sanitization, summarization, etc.
    """
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required."
        )

    data = req.data
    system_prompt = data.get("systemPrompt")
    user_message = data.get("userMessage")
    temperature = data.get("temperature", 0.5)

    if not system_prompt or not user_message:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Missing keys: systemPrompt, userMessage"
        )
    
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
         raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="ANTHROPIC_API_KEY is not configured on server."
        )

    print(f"[Claude] Generic chat request received...")

    try:
        # Singleton access
        client = get_anthropic_client()
        
        # Use Claude 4.5 Haiku as explicitly requested by user (same as generate_minutes)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20000,
            thinking={
                "type": "enabled",
                "budget_tokens": 12000
            },
            temperature=1, # Start at 1 for thinking models
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        
        # Handle multiple content blocks (ignore 'thinking', keep 'text')
        content_parts = []
        for block in message.content:
            if block.type == "text":
                content_parts.append(block.text)
        
        content = "\n".join(content_parts)
        
        return {
            "success": True,
            "content": content
        }

    except Exception as e:
        print(f"[Claude] Chat Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )
