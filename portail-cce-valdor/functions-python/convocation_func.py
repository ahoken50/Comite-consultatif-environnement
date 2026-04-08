
import time
import random
import resend
from firebase_functions import https_fn
from typing import Any

@https_fn.on_call()
def send_convocation(req: https_fn.CallableRequest) -> Any:
    """
    Sends convocation emails with RSVP tokens.
    Includes rate limiting and exponential backoff.
    """
    try:
        data = req.data
        meeting_id = data.get("meetingId")
        meeting_data = data.get("meeting", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        
        if not meeting_id or not recipients:
            return {"success": False, "error": "Missing parameters"}

        print(f"Sending convocation for meeting {meeting_id} to {len(recipients)} recipients")

        # Base URL for the application
        base_url = "https://portail-cce-valdor.web.app"
        
        email_results = []
        
        # Configure Resend only if not already configured by environment
        # (Assuming main.py might handle global config, but safe to redo if needed or just rely on env)
        # resend.api_key = os.environ.get("RESEND_API_KEY") 
        
        # Calculate strict local time to prevent frontend caching issues or timezone oddities
        raw_date = meeting_data.get('date', '')
        extracted_time = meeting_data.get('formattedTime', 'Non spécifiée')
        try:
            if raw_date and "T" in raw_date:
                import datetime
                from zoneinfo import ZoneInfo
                cleaned_date = raw_date.replace("Z", "+00:00")
                dt = datetime.datetime.fromisoformat(cleaned_date)
                if dt.tzinfo is None:
                    extracted_time = dt.strftime("%Hh%M")
                else:
                    local_dt = dt.astimezone(ZoneInfo("America/Montreal"))
                    extracted_time = local_dt.strftime("%Hh%M")
        except Exception as e:
            print(f"Timezone fallback processing failed: {str(e)}")

        for i, recipient in enumerate(recipients):
            # Rate limiting: wait 0.6 seconds between emails (approx 1.6 req/s) to stay under 2 req/s safe limit
            if i > 0:
                time.sleep(0.6)

            token = recipient.get("token")
            if not token:
                print(f"Skipping recipient {recipient.get('email')} - No token")
                continue
                
            # Generate RSVP links
            rsvp_link = f"{base_url}/rsvp/{meeting_id}/{token}"
            confirm_link = f"{rsvp_link}?response=confirmed"
            decline_link = f"{rsvp_link}?response=declined"
            
            # Email Content
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #1e4e3d; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0;">Avis de convocation</h2>
                        <p style="margin: 5px 0 0;">Comité Consultatif en Environnement</p>
                    </div>
                    
                    <div style="padding: 30px 20px;">
                        <p>Bonjour {recipient.get('name')},</p>
                        
                        <p>Vous êtes convoqué(e) à la prochaine assemblée du CCE.</p>
                        
                        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>📅 Date :</strong> {meeting_data.get('formattedDate', meeting_data.get('date'))}</p>
                            <p style="margin: 5px 0;"><strong>🕐 Heure :</strong> {extracted_time}</p>
                            <p style="margin: 5px 0;"><strong>📍 Lieu :</strong> {meeting_data.get('location', 'Hôtel de Ville')}</p>
                        </div>
                        
                        <p>L'ordre du jour est joint à ce courriel.</p>
                        
                        <div style="text-align: center; margin: 30px 0;">
                            <p style="font-weight: bold; margin-bottom: 15px;">Veuillez confirmer votre présence :</p>
                            
                            <a href="{confirm_link}" style="display: inline-block; background-color: #2e7d32; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 0 10px; font-weight: bold;">
                                ✅ Je serai présent(e)
                            </a>
                            
                            <a href="{decline_link}" style="display: inline-block; background-color: #c62828; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 0 10px; font-weight: bold;">
                                ❌ Je serai absent(e)
                            </a>
                        </div>
                        
                        <p style="font-size: 14px; text-align: center; margin-top: 20px;">
                            <a href="{rsvp_link}" style="color: #666;">Voir les détails de la réunion</a>
                        </p>
                    </div>
                    
                    <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666;">
                        <p>Envoyé par {sender.get('name')}</p>
                        <p>Ville de Val-d'Or</p>
                    </div>
                </div>
            </body>
            </html>
            """
            
            # Retry logic with exponential backoff
            max_retries = 3
            sent = False
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    r = resend.Emails.send({
                        "from": "Comité CCE <onboarding@resend.dev>",
                        "to": [recipient.get("email")],
                        "subject": f"Convocation CCE - {meeting_data.get('formattedDate', meeting_data.get('date'))}",
                        "html": html_content,
                        "reply_to": sender.get("email"),
                        "attachments": [{"content": data.get("agendaPdf"), "filename": "Ordre_du_jour.pdf"}] if data.get("agendaPdf") else []
                    })
                    email_results.append({"email": recipient.get("email"), "id": r.get("id"), "status": "sent"})
                    sent = True
                    break
                except Exception as e:
                    last_error = str(e)
                    # Check for rate limit error (429)
                    if "429" in str(e) or "Too Many Requests" in str(e):
                        if attempt < max_retries - 1:
                            # Exponential backoff: 2s, 4s... + jitter
                            sleep_time = (2 ** (attempt + 1)) + random.uniform(0, 1)
                            print(f"Rate limited for {recipient.get('email')}. Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                            time.sleep(sleep_time)
                            continue
                    
                    print(f"Error sending to {recipient.get('email')}: {str(e)}")
                    # If other error or retries exhausted
                    break
            
            if not sent:
                email_results.append({"email": recipient.get("email"), "error": last_error, "status": "error"})

        return {"success": True, "results": email_results}

    except Exception as e:
        print(f"Error in send_convocation: {str(e)}")
        return {"success": False, "error": str(e)}
