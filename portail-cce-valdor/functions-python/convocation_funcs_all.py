
@https_fn.on_call()
def send_convocation(req: https_fn.CallableRequest) -> Any:
    """
    Sends convocation emails with RSVP tokens (Phase 2).
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
        
        for recipient in recipients:
            token = recipient.get("token")
            # If no token, we can't send RSVP link, but should still send email? 
            # Logic assumes token is present for Phase 2.
            
            # Generate RSVP links
            # Link to the RSVP page with the token
            if token:
                rsvp_link = f"{base_url}/rsvp/{meeting_id}/{token}"
                confirm_link = f"{rsvp_link}?response=confirmed"
                decline_link = f"{rsvp_link}?response=declined"
                
                # Buttons HTML
                actions_html = f"""
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
                """
            else:
                actions_html = "<p style='color: #666; font-style: italic;'>Lien de confirmation non disponible pour cet utilisateur.</p>"

            
            # Email Content
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #1e4e3d; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0;">Ordre du jour disponible</h2>
                        <p style="margin: 5px 0 0;">Comité Consultatif en Environnement</p>
                    </div>
                    
                    <div style="padding: 30px 20px;">
                        <p>Bonjour {recipient.get('name')},</p>
                        
                        <p>Vous êtes convoqué(e) à la prochaine assemblée du CCE.</p>
                        
                        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><strong>📅 Date :</strong> {meeting_data.get('formattedDate', meeting_data.get('date'))}</p>
                            <p style="margin: 5px 0;"><strong>📍 Lieu :</strong> {meeting_data.get('location', "Ville de Val-d'Or")}</p>
                        </div>
                        
                        <p>L'ordre du jour est joint à ce courriel (si applicable).</p>
                        
                        {actions_html}
                    </div>
                    
                    <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666;">
                        <p>Envoyé par {sender.get('name')}</p>
                        <p>Ville de Val-d'Or</p>
                    </div>
                </div>
            </body>
            </html>
            """
            
            try:
                r = resend.Emails.send({
                    "from": "Comité CCE <onboarding@resend.dev>",
                    "to": [recipient.get("email")],
                    "subject": f"Convocation CCE - {meeting_data.get('formattedDate', meeting_data.get('date'))}",
                    "html": html_content,
                    "reply_to": sender.get("email")
                })
                email_results.append({"email": recipient.get("email"), "id": r.get("id"), "status": "sent"})
            except Exception as e:
                print(f"Error sending to {recipient.get('email')}: {str(e)}")
                email_results.append({"email": recipient.get("email"), "error": str(e), "status": "error"})

        return {"success": True, "results": email_results}

    except Exception as e:
        print(f"Error in send_convocation: {str(e)}")
        return {"success": False, "error": str(e)}

@https_fn.on_call()
def send_avis_convocation(req: https_fn.CallableRequest) -> Any:
    """
    Sends 'Avis de convocation' emails (Phase 1).
    Does NOT include RSVP links, as it's just a notice.
    """
    try:
        data = req.data
        meeting_id = data.get("meetingId")
        meeting_data = data.get("meeting", {})
        deadline = data.get("deadline", {})
        recipients = data.get("recipients", [])
        sender = data.get("sender", {})
        
        if not meeting_id or not recipients:
            return {"success": False, "error": "Missing parameters"}

        print(f"Sending AVIS convocation for meeting {meeting_id} to {len(recipients)} recipients")
        
        email_results = []
        
        for recipient in recipients:
            # Email Content
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #E8F5E9; color: #1e4e3d; padding: 20px; text-align: center; border-bottom: 3px solid #1e4e3d;">
                        <h2 style="margin: 0;">AVIS DE CONVOCATION</h2>
                        <p style="margin: 5px 0 0; font-weight: bold;">Comité Consultatif en Environnement</p>
                    </div>
                    
                    <div style="padding: 30px 20px;">
                        <p>Bonjour {recipient.get('name')},</p>
                        
                        <p>La prochaine assemblée du CCE est planifiée.</p>
                        
                        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #1e4e3d;">
                            <p style="margin: 5px 0;"><strong>📅 Date de la réunion :</strong> {meeting_data.get('formattedDate', meeting_data.get('date'))}</p>
                            <p style="margin: 5px 0;"><strong>📍 Lieu :</strong> {meeting_data.get('location', "Ville de Val-d'Or")}</p>
                        </div>
                        
                        <div style="background-color: #FFF3E0; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #FFE0B2;">
                            <p style="margin: 0; color: #E65100; font-weight: bold;">📢 Appel de sujets</p>
                            <p style="margin: 10px 0 0;">Si vous souhaitez ajouter un point à l'ordre du jour, veuillez en informer le président avant le :</p>
                            <p style="font-weight: bold; font-size: 1.1em; margin: 10px 0;">{deadline.get('formattedDate', deadline.get('date'))}</p>
                        </div>
                        
                        <p>L'ordre du jour détaillé vous sera envoyé ultérieurement.</p>
                    </div>
                    
                    <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666;">
                        <p>Envoyé par {sender.get('name')}</p>
                        <p>Ville de Val-d'Or</p>
                    </div>
                </div>
            </body>
            </html>
            """
            
            try:
                r = resend.Emails.send({
                    "from": "Comité CCE <onboarding@resend.dev>",
                    "to": [recipient.get("email")],
                    "subject": f"AVIS: Assemblée CCE - {meeting_data.get('formattedDate', meeting_data.get('date'))}",
                    "html": html_content,
                    "reply_to": sender.get("email")
                })
                email_results.append({"email": recipient.get("email"), "id": r.get("id"), "status": "sent"})
            except Exception as e:
                print(f"Error sending to {recipient.get('email')}: {str(e)}")
                email_results.append({"email": recipient.get("email"), "error": str(e), "status": "error"})

        return {"success": True, "results": email_results}

    except Exception as e:
        print(f"Error in send_avis_convocation: {str(e)}")
        return {"success": False, "error": str(e)}
