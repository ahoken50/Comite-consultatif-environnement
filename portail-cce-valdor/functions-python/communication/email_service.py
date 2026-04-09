import os
import time
import uuid
import resend
from datetime import datetime, timedelta
from typing import Any
from firebase_admin import firestore
from firebase_functions import https_fn, options
from core.firebase_init import db
from pdf.pdf_convocation import generate_avis_pdf

def configure_resend():
    resend.api_key = os.environ.get('RESEND_API_KEY', '')

@https_fn.on_call(
    memory=options.MemoryOption.GB_1,
    timeout_sec=300,
    region="us-central1"
)
def send_convocation(req: https_fn.CallableRequest):
    """
    Cloud Function to send convocation emails to CCE members.
    Uses Resend API for email delivery.
    """
    # Verify authentication
    if not req.auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentification requise"
        )

    try:
        import resend
        import random
        
        # Singleton configuration
        configure_resend()
        
        # Extract data
        data = req.data
        meeting_id = data.get("meetingId")
        convocation_id = data.get("convocationId")
        meeting = data.get("meeting", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        agenda_pdf_base64 = data.get("agendaPdf")
        
        if not meeting_id or not recipients:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message="meetingId et recipients requis"
            )
        
        # Format meeting date with proper timezone (handles DST automatically)
        from zoneinfo import ZoneInfo
        utc_date = datetime.fromisoformat(meeting.get("date", "").replace("Z", "+00:00"))
        eastern_tz = ZoneInfo("America/Montreal")
        local_date = utc_date.astimezone(eastern_tz)
        
        days = {
            0: "lundi", 1: "mardi", 2: "mercredi", 3: "jeudi", 
            4: "vendredi", 5: "samedi", 6: "dimanche"
        }
        months = {
            1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
            7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre"
        }
        
        day_str = days[local_date.weekday()]
        month_str = months[local_date.month]
        
        formatted_date = f"{day_str} {local_date.day} {month_str} {local_date.year}"
        formatted_time = local_date.strftime("%H h %M")
        
        # Prepare Attachments
        attachments = []
        if agenda_pdf_base64:
            attachments.append({
                "content": agenda_pdf_base64,
                "filename": f"Ordre_du_jour_{local_date.strftime('%Y-%m-%d')}.pdf",
            })

        # App URL for RSVP links
        app_url = os.environ.get("APP_URL", "https://comite-cce.web.app")
        
        # Generate email HTML with logos
        def generate_email_html(recipient_name: str, token: str) -> str:
            rsvp_url = f"{app_url}/rsvp/{meeting_id}/{token}"
            
            return f"""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Georgia, 'Times New Roman', serif; background-color: #f9fbfa; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header with logos -->
        <div style="background-color: #1e4e3d; padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-family: Arial, sans-serif;">
                COMITÉ CONSULTATIF EN ENVIRONNEMENT
            </h1>
            <p style="color: #c5a065; margin: 10px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">
                Ville de Val-d'Or
            </p>
        </div>
        
        <!-- Content -->
        <div style="padding: 30px;">
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Bonjour <strong>{recipient_name}</strong>,
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Vous êtes convoqué(e) à la prochaine assemblée du Comité consultatif en environnement de la Ville de Val-d'Or.
            </p>
            
            <!-- Meeting details box -->
            <div style="background-color: #f9fbfa; border-left: 4px solid #c5a065; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 10px 0; font-size: 16px;">
                    <strong style="color: #1e4e3d;">📅 Date :</strong> {formatted_date}
                </p>
                <p style="margin: 0 0 10px 0; font-size: 16px;">
                    <strong style="color: #1e4e3d;">🕐 Heure :</strong> {formatted_time}
                </p>
                <p style="margin: 0; font-size: 16px;">
                    <strong style="color: #1e4e3d;">📍 Lieu :</strong> {meeting.get("location", "Ville de Val-d'Or")}
                </p>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                📎 L'ordre du jour est joint à ce courriel.
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6; margin-top: 25px;">
                <strong>Veuillez confirmer votre présence :</strong>
            </p>
            
            <!-- RSVP buttons -->
            <div style="text-align: center; margin: 30px 0;">
                <a href="{rsvp_url}?response=confirmed" 
                   style="display: inline-block; background-color: #4caf50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 5px; font-size: 16px;">
                    ✓ Je serai présent(e)
                </a>
                <a href="{rsvp_url}?response=declined" 
                   style="display: inline-block; background-color: #f44336; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 5px; font-size: 16px;">
                    ✗ Je serai absent(e)
                </a>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f9fbfa; padding: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0; font-size: 14px; color: #666; text-align: center;">
                Cordialement,<br>
                <strong style="color: #1e4e3d;">{sender.get("name", "Coordonnateur en environnement")}</strong><br>
                Ville de Val-d'Or
            </p>
        </div>
    </div>
</body>
</html>
"""
        
        # Send emails to all recipients
        sent_count = 0
        errors = []
        
        for i, recipient in enumerate(recipients):
            # Rate limiting: wait 1.1 seconds between emails
            if i > 0:
                time.sleep(1.1)

            try:
                email_html = generate_email_html(
                    recipient.get("name", ""),
                    recipient.get("token", "")
                )
                
                email_params = {
                    "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
                    "to": [recipient.get("email")],
                    "subject": f"Ordre du jour du CCE – {formatted_date}",
                    "html": email_html,
                    "attachments": attachments 
                }

                # Retry logic with exponential backoff for 429 errors
                max_retries = 3
                sent_successfully = False
                last_error_msg = ""

                for attempt in range(max_retries):
                    try:
                        resend.Emails.send(email_params)
                        sent_successfully = True
                        break
                    except Exception as e:
                        last_error_msg = str(e)
                        if "429" in str(e) or "Too Many Requests" in str(e):
                            sleep_time = (2 ** (attempt + 1)) + random.uniform(0, 1)
                            print(f"[Convocation] Rate limited for {recipient.get('email')}. Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                            time.sleep(sleep_time)
                        else:
                            raise e

                if sent_successfully:
                    sent_count += 1
                    print(f"[Convocation] Email sent to {recipient.get('email')}")
                else:
                     raise Exception(f"Max retries exceeded. Last error: {last_error_msg}")
                
            except Exception as email_error:
                error_msg = f"Failed to send to {recipient.get('email')}: {str(email_error)}"
                print(f"[Convocation] {error_msg}")
                errors.append(error_msg)
        
        # Update convocation record with send status
        if convocation_id:
            db = firestore.client()
            db.collection("meetings").document(meeting_id).collection("convocations").document(convocation_id).update({
                "emailsSent": sent_count,
                "emailErrors": errors,
                "emailSentAt": datetime.now().isoformat()
            })
        
        return {
            "success": True,
            "sentCount": sent_count,
            "errorCount": len(errors),
            "errors": errors if errors else None
        }
        
    except Exception as e:
        print(f"[Convocation] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


@https_fn.on_call(
    memory=options.MemoryOption.MB_512,
    timeout_sec=180,
    region="us-central1"
)
def send_avis_convocation(req: https_fn.CallableRequest):
    """
    Send Avis de Convocation emails to CCE members with PDF attachment.
    Phase 1: Simple notification with meeting date, 15-day deadline for agenda suggestions,
    and the official convocation letter as PDF attachment.
    """
    print("[Avis] Starting send_avis_convocation function with PDF generation")
    
    try:
        import resend
        import base64
        
        # Get Resend API key
        resend_api_key = os.environ.get("RESEND_API_KEY")
        if not resend_api_key:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                message="RESEND_API_KEY non configurée"
            )
        
        resend.api_key = resend_api_key
        
        # Extract data
        data = req.data
        meeting_id = data.get("meetingId")
        avis_id = data.get("avisId")
        meeting = data.get("meeting", {})
        deadline = data.get("deadline", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        
        if not meeting_id or not recipients:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message="meetingId et recipients requis"
            )
        
        # Use pre-formatted dates from frontend
        formatted_meeting_date = meeting.get("formattedDate", "Date à confirmer")
        formatted_deadline = deadline.get("formattedDate", "Date limite")
        sender_email = sender.get("email", "coordonnateur@ville.valdor.qc.ca")
        sender_name = sender.get("name", "Coordonnateur CCE")
        meeting_title = meeting.get("title", "Assemblée CCE")
        meeting_location = meeting.get("location", "Ville de Val-d'Or")
        signature_url = sender.get("signatureUrl")
        
        # Format time from meeting date (convert from UTC to Eastern timezone)
        try:
            from zoneinfo import ZoneInfo
            meeting_datetime = datetime.fromisoformat(meeting.get("date", "").replace("Z", "+00:00"))
            # Convert to Eastern timezone (Quebec)
            eastern_tz = ZoneInfo("America/Montreal")
            meeting_datetime_local = meeting_datetime.astimezone(eastern_tz)
            meeting_time = meeting_datetime_local.strftime("%H h %M")
            print(f"[Avis] Meeting time: UTC={meeting_datetime}, Local={meeting_datetime_local}, Formatted={meeting_time}")
        except Exception as tz_error:
            print(f"[Avis] Timezone error: {tz_error}")
            meeting_time = "À confirmer"
        
        # Format location for proper grammar
        location_text = f"dans {meeting_location}" if meeting_location else "au bureau"
        
        # Generate PDF
        print("[Avis] Generating PDF...")
        pdf_bytes = generate_avis_pdf(
            meeting_date=formatted_meeting_date,
            meeting_time=meeting_time,
            meeting_location=location_text,
            deadline=formatted_deadline,
            sender_name=sender_name,
            sender_email=sender_email,
            signature_url=signature_url
        )
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        pdf_filename = f"Avis_Convocation_CCE_{formatted_meeting_date.replace(' ', '_').replace(',', '')}.pdf"
        print(f"[Avis] PDF generated: {len(pdf_bytes)} bytes")
        
        # Generate email HTML
        def generate_avis_email_html(recipient_name: str) -> str:
            return f"""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Georgia, 'Times New Roman', serif; background-color: #f9fbfa; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #1e4e3d; padding: 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-family: Arial, sans-serif;">
                COMITÉ CONSULTATIF EN ENVIRONNEMENT
            </h1>
            <p style="color: #c5a065; margin: 10px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">
                Ville de Val-d'Or
            </p>
        </div>
        
        <!-- Content -->
        <div style="padding: 30px;">
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Bonjour,
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Vous trouverez, <strong>en fichier joint</strong>, l'avis de convocation pour la prochaine assemblée du 
                <strong>Comité consultatif en environnement</strong>, prévue le <strong>{formatted_meeting_date}</strong>.
            </p>
            
            <!-- Deadline box -->
            <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <p style="margin: 0; font-size: 16px; color: #856404;">
                    <strong>Date limite pour suggestions :</strong><br>
                    Vous avez jusqu'au <strong>{formatted_deadline}</strong> pour faire vos suggestions de sujets 
                    à l'ordre du jour, par courriel à <a href="mailto:{sender_email}" style="color: #1e4e3d;">{sender_email}</a>
                </p>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Merci et bonne journée !
            </p>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f9fbfa; padding: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0; font-size: 14px; color: #666; text-align: center;">
                Cordialement,<br>
                <strong style="color: #1e4e3d;">{sender_name}</strong><br>
                Ville de Val-d'Or
            </p>
        </div>
    </div>
</body>
</html>
"""
        
        # Send emails to all recipients with PDF attachment
        sent_count = 0
        errors = []
        
        for recipient in recipients:
            try:
                email_html = generate_avis_email_html(recipient.get("name", ""))
                
                resend.Emails.send({
                    "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
                    "to": [recipient.get("email")],
                    "subject": f"Avis de convocation à Assemblée CCE du {formatted_meeting_date}",
                    "html": email_html,
                    "attachments": [
                        {
                            "filename": pdf_filename,
                            "content": pdf_base64
                        }
                    ]
                })
                
                sent_count += 1
                print(f"[Avis] Email with PDF sent to {recipient.get('email')}")
                
            except Exception as email_error:
                error_msg = f"Failed to send to {recipient.get('email')}: {str(email_error)}"
                print(f"[Avis] {error_msg}")
                errors.append(error_msg)
        
        # Update avis record with send status
        if avis_id:
            db = firestore.client()
            db.collection("meetings").document(meeting_id).collection("avis_convocations").document(avis_id).update({
                "emailsSent": sent_count,
                "emailErrors": errors,
                "emailSentAt": datetime.now().isoformat(),
                "pdfGenerated": True
            })
        
        return {
            "success": True,
            "sentCount": sent_count,
            "errorCount": len(errors),
            "pdfGenerated": True,
            "errors": errors if errors else None
        }
        
    except Exception as e:
        print(f"[Avis] Error: {str(e)}")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=str(e)
        )


# MAGIC LINK APPROVAL SERVICE
# ==============================================================================

import uuid
from datetime import datetime, timedelta
from typing import Any

@https_fn.on_call()
def send_approval_link(req: https_fn.CallableRequest) -> Any:
    """
    Generates a secure approval token and sends it via email.
    """
    try:
        import resend
        resend.api_key = os.environ.get("RESEND_API_KEY", "")
        
        data = req.data
        meeting_id = data.get("meetingId")
        member_id = data.get("memberId")
        email = data.get("email")
        name = data.get("name")
        role = data.get("role")

        if not meeting_id or not email:
            return {"success": False, "error": "Missing parameters"}

        # Generate secure token
        token = str(uuid.uuid4())
        # expires in 7 days
        expires_at = (datetime.now() + timedelta(days=7)).isoformat()

        # Store token in Firestore
        db = firestore.client()
        db.collection("meetings").document(meeting_id).collection("approval_tokens").document(token).set({
            "token": token,
            "meetingId": meeting_id,
            "memberId": member_id,
            "name": name,
            "role": role,
            "createdAt": datetime.now().isoformat(),
            "expiresAt": expires_at,
            "used": False
        })

        # Construct Link - format must match route: /approve/:meetingId/:token
        base_url = "https://comite-cce.web.app"
        approval_link = f"{base_url}/approve/{meeting_id}/{token}"

        # Send Email via Resend
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Demande d'approbation de Procès-Verbal</h2>
            <p>Bonjour {name},</p>
            <p>Le procès-verbal de la réunion est prêt pour votre révision et approbation.</p>
            <p>Veuillez cliquer sur le lien ci-dessous pour accéder au document sécurisé :</p>
            <p style="text-align: center; margin: 30px 0;">
                <a href="{approval_link}" style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
                    Réviser et Approuver
                </a>
            </p>
            <p>Ce lien est valide pour 7 jours.</p>
        </body>
        </html>
        """

        r = resend.Emails.send({
            "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
            "to": [email],
            "subject": "Action requise : Approbation de procès-verbal",
            "html": html_content
        })

        return {"success": True, "emailId": r.get("id")}

    except Exception as e:
        print(f"Error sending approval link: {e}")
        return {"success": False, "error": str(e)}


@https_fn.on_call()
def send_approval_notification(req: https_fn.CallableRequest) -> Any:
    """
    Sends email notification to coordinator when changes are requested in approval workflow.
    """
    try:
        import resend
        resend.api_key = os.environ.get("RESEND_API_KEY", "")
        
        data = req.data
        meeting_id = data.get("meetingId")
        meeting_title = data.get("meetingTitle")
        reviewer_name = data.get("reviewerName")
        comments = data.get("comments")
        notification_type = data.get("type", "changes_requested")  # 'approved' or 'changes_requested'
        
        if not meeting_id or not comments:
            return {"success": False, "error": "Missing parameters"}
        
        # Get coordinator email from Firestore
        db = firestore.client()
        members_ref = db.collection("members")
        coordinators = members_ref.where("role", "==", "coordinator").where("isActive", "==", True).limit(1).stream()
        
        coordinator_email = None
        coordinator_name = None
        for member in coordinators:
            member_data = member.to_dict()
            coordinator_email = member_data.get("email")
            coordinator_name = member_data.get("displayName", "Coordonnateur")
            break
        
        if not coordinator_email:
            print("No active coordinator found, cannot send notification")
            return {"success": False, "error": "Aucun coordonnateur actif trouvé"}
        
        # Build email content based on notification type
        if notification_type == "approved":
            subject = f"✅ PV Approuvé - {meeting_title}"
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #2e7d32;">Procès-verbal Approuvé</h2>
                <p>Bonjour {coordinator_name},</p>
                <p><strong>{reviewer_name}</strong> a approuvé le procès-verbal de la réunion :</p>
                <p style="font-size: 16px; color: #333;"><strong>{meeting_title}</strong></p>
                {f'<p><strong>Commentaires :</strong></p><blockquote style="border-left: 3px solid #2e7d32; padding-left: 12px; color: #555;">{comments}</blockquote>' if comments else ''}
                <p>Vous pouvez maintenant finaliser le document.</p>
            </body>
            </html>
            """
        else:
            subject = f"📝 Modifications demandées - {meeting_title}"
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #f57c00;">Modifications Demandées</h2>
                <p>Bonjour {coordinator_name},</p>
                <p><strong>{reviewer_name}</strong> a demandé des modifications au procès-verbal de la réunion :</p>
                <p style="font-size: 16px; color: #333;"><strong>{meeting_title}</strong></p>
                <p><strong>Commentaires :</strong></p>
                <blockquote style="border-left: 3px solid #f57c00; padding-left: 12px; color: #555; background: #fff3e0; padding: 12px;">
                    {comments}
                </blockquote>
                <p>Veuillez effectuer les corrections et renvoyer le lien d'approbation.</p>
            </body>
            </html>
            """
        
        r = resend.Emails.send({
            "from": "CCE Val-d'Or <coordination_cce@ccevvd.com>",
            "to": [coordinator_email],
            "subject": subject,
            "html": html_content
        })
        
        print(f"Notification sent to coordinator: {coordinator_email}")
        return {"success": True, "emailId": r.get("id")}
        
    except Exception as e:
        print(f"Error sending approval notification: {e}")
        return {"success": False, "error": str(e)}
