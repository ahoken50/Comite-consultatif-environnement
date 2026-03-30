from datetime import datetime

def generate_avis_pdf(meeting_date: str, meeting_time: str, 
                      meeting_location: str, deadline: str, sender_name: str, 
                      sender_email: str, signature_url: str = None) -> bytes:
    """
    Generate Avis de Convocation PDF using reportlab.
    Matches the official memo format:
    - DESTINATAIRE / EXPÉDITEUR / DATE / OBJET header
    - Body with meeting details and deadline
    - Signature at the bottom
    Returns PDF as bytes for email attachment.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
    import io
    import urllib.request
    
    # Colors
    primary_color = HexColor('#1e4e3d')
    accent_color = HexColor('#c5a065')
    
    # Create PDF buffer
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, 
                           topMargin=0.6*inch, bottomMargin=0.6*inch,
                           leftMargin=1*inch, rightMargin=1*inch)
    
    # Styles
    styles = getSampleStyleSheet()
    
    header_style = ParagraphStyle(
        'HeaderStyle',
        parent=styles['Heading1'],
        fontSize=14,
        textColor=primary_color,
        alignment=TA_CENTER,
        spaceAfter=5,
        fontName='Helvetica-Bold'
    )
    
    subheader_style = ParagraphStyle(
        'SubheaderStyle',
        parent=styles['Heading2'],
        fontSize=11,
        textColor=accent_color,
        alignment=TA_CENTER,
        spaceAfter=20,
        fontName='Helvetica'
    )
    
    label_style = ParagraphStyle(
        'LabelStyle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=HexColor('#333333'),
        fontName='Helvetica-Bold',
        leading=14
    )
    
    value_style = ParagraphStyle(
        'ValueStyle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=HexColor('#333333'),
        fontName='Helvetica',
        leading=14
    )
    
    body_style = ParagraphStyle(
        'BodyStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#333333'),
        alignment=TA_JUSTIFY,
        spaceAfter=12,
        leading=16,
        fontName='Times-Roman'
    )
    
    signature_style = ParagraphStyle(
        'SignatureStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#333333'),
        alignment=TA_LEFT,
        fontName='Times-Roman',
        leftIndent=20
    )
    
    # Build document content
    elements = []
    
    # === HEADER with logos ===
    # Logo URLs from deployed app
    logo_valdor_url = "https://comite-cce.web.app/logo-valdor.png"
    logo_cce_url = "https://comite-cce.web.app/logo-cce.png"
    
    # Try to download and add logos
    logo_valdor_img = None
    logo_cce_img = None
    
    try:
        with urllib.request.urlopen(logo_valdor_url, timeout=10) as response:
            logo_data = response.read()
            logo_buffer = io.BytesIO(logo_data)
            logo_valdor_img = Image(logo_buffer, width=1.2*inch, height=0.8*inch)
            print("[Avis PDF] Logo Val-d'Or loaded")
    except Exception as e:
        print(f"[Avis PDF] Could not load logo Val-d'Or: {e}")
    
    try:
        with urllib.request.urlopen(logo_cce_url, timeout=10) as response:
            logo_data = response.read()
            logo_buffer = io.BytesIO(logo_data)
            logo_cce_img = Image(logo_buffer, width=0.8*inch, height=0.8*inch)
            print("[Avis PDF] Logo CCE loaded")
    except Exception as e:
        print(f"[Avis PDF] Could not load logo CCE: {e}")
    
    # Create header with logos (side by side)
    if logo_valdor_img and logo_cce_img:
        logo_table = Table(
            [[logo_valdor_img, logo_cce_img]],
            colWidths=[3*inch, 3*inch]
        )
        logo_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(logo_table)
        elements.append(Spacer(1, 15))
    
    elements.append(Paragraph("COMITÉ CONSULTATIF EN ENVIRONNEMENT", header_style))
    elements.append(Paragraph("VILLE DE VAL-D'OR", subheader_style))
    
    # Horizontal line
    from reportlab.platypus import HRFlowable
    elements.append(HRFlowable(width="100%", thickness=2, color=primary_color, spaceAfter=20))
    
    # Format today's date in French
    months_fr = {
        1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
        7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre"
    }
    today = datetime.now()
    today_str = f"Le {today.day} {months_fr[today.month]} {today.year}"
    
    # === MEMO HEADER TABLE ===
    # DESTINATAIRE / EXPÉDITEUR / DATE / OBJET format
    memo_data = [
        [Paragraph("<b>DESTINATAIRE :</b>", label_style), 
         Paragraph("Les membres du Comité consultatif en environnement", value_style)],
        [Paragraph("<b>EXPÉDITEUR :</b>", label_style), 
         Paragraph(f"{sender_name}, coordonnateur en environnement", value_style)],
        [Paragraph("<b>DATE :</b>", label_style), 
         Paragraph(today_str, value_style)],
        [Paragraph("<b>OBJET :</b>", label_style), 
         Paragraph("Réunion du Comité consultatif en environnement", value_style)],
    ]
    
    memo_table = Table(memo_data, colWidths=[1.3*inch, 4.7*inch])
    memo_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(memo_table)
    elements.append(Spacer(1, 20))
    
    # Horizontal line
    elements.append(HRFlowable(width="100%", thickness=1, color=HexColor('#cccccc'), spaceAfter=20))
    
    # === BODY ===
    elements.append(Paragraph("Mesdames, Messieurs,", body_style))
    elements.append(Spacer(1, 12))
    
    # Main paragraph with meeting details
    body_text = f"""Je vous prie de prendre note qu'une assemblée du Comité consultatif en environnement 
    est prévue le <b>{meeting_date}</b> à <b>{meeting_time}</b> {meeting_location}."""
    elements.append(Paragraph(body_text, body_style))
    elements.append(Spacer(1, 8))
    
    # Deadline paragraph
    deadline_text = f"""Vous avez jusqu'au <b>{deadline}</b> pour faire vos suggestions de point à l'ordre du jour."""
    elements.append(Paragraph(deadline_text, body_style))
    elements.append(Spacer(1, 8))
    
    # Closing
    elements.append(Paragraph("Je vous remercie grandement de votre collaboration.", body_style))
    elements.append(Spacer(1, 40))
    
    # === SIGNATURE ===
    # Try to add signature image if available
    signature_added = False
    if signature_url:
        try:
            # Download signature image
            with urllib.request.urlopen(signature_url, timeout=10) as response:
                sig_data = response.read()
                sig_buffer = io.BytesIO(sig_data)
                sig_image = Image(sig_buffer, width=1.5*inch, height=0.5*inch)
                sig_image.hAlign = 'LEFT'  # Align image to left
                elements.append(sig_image)
                signature_added = True
                print(f"[Avis PDF] Signature image added from URL")
        except Exception as sig_error:
            print(f"[Avis PDF] Could not load signature image: {sig_error}")
    
    if not signature_added:
        # Add signature line if no image
        elements.append(Spacer(1, 30))
    
    # Signature name aligned left (same as image)
    signature_name_style = ParagraphStyle(
        'SignatureNameStyle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=HexColor('#333333'),
        alignment=TA_LEFT,
        fontName='Times-Roman',
        leftIndent=0  # No indent - align with signature image
    )
    elements.append(Paragraph(f"{sender_name}, secrétaire du Comité", signature_name_style))
    
    # Build PDF
    doc.build(elements)
    
    # Get PDF bytes
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    return pdf_bytes
