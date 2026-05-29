/**
 * PDF Service Avis de Convocation
 * Generates the "Avis de Convocation" letter as PDF and optionally uploads to Storage
 */

import type { Meeting } from '../types/meeting.types';
import type { Member } from '../types/member.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';

export interface AvisPDFGenerationResult {
    success: boolean;
    pdfUrl?: string;
    error?: string;
}

interface AvisData {
    meeting: Meeting;
    senderMember: Member;
    deadlineDate: Date;
}

/**
 * Generates the Avis de Convocation HTML content
 */
const generateAvisHTML = (data: AvisData): string => {
    const { meeting, senderMember, deadlineDate } = data;

    // Format dates
    const meetingDate = new Date(meeting.date);
    const dateStr = format(meetingDate, 'EEEE d MMMM yyyy', { locale: fr });
    const formattedMeetingDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    const timeStr = "17 h 00"; // CCE meetings are always at 17h00

    const deadlineStr = format(deadlineDate, 'd MMMM yyyy', { locale: fr });
    const todayStr = format(new Date(), 'd MMMM yyyy', { locale: fr });

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Avis de Convocation CCE - Ville de Val-d'Or</title>
    <style>
        :root {
            --primary-color: #1e4e3d;
            --accent-color: #c5a065;
            --text-color: #2b2b2b;
            --bg-color: #ffffff;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        @page {
            size: letter;
            margin: 0.75in 1in;
        }

        body {
            background-color: var(--bg-color);
            font-family: 'Georgia', 'Times New Roman', serif;
            color: var(--text-color);
            padding: 40px;
            line-height: 1.6;
        }

        header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px double var(--primary-color);
            padding-bottom: 25px;
        }

        .logo-container {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 40px;
            margin-bottom: 20px;
        }

        .logo-img {
            max-width: 100px;
            height: auto;
        }

        h1 {
            font-family: 'Arial', sans-serif;
            font-size: 20px;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: var(--primary-color);
            margin: 0 0 8px 0;
            font-weight: 700;
        }

        h2 {
            font-family: 'Arial', sans-serif;
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--accent-color);
            margin: 0 0 15px 0;
            font-weight: 600;
        }

        .document-title {
            font-family: 'Arial', sans-serif;
            font-size: 22px;
            font-weight: bold;
            color: var(--primary-color);
            text-align: center;
            margin: 30px 0;
            padding-bottom: 15px;
            border-bottom: 1px solid #ddd;
        }

        .date-line {
            text-align: right;
            font-style: italic;
            color: #666;
            margin-bottom: 30px;
        }

        .content {
            text-align: justify;
            font-size: 14px;
            line-height: 1.8;
        }

        .content p {
            margin-bottom: 20px;
        }

        .meeting-details {
            background-color: #f9fbfa;
            border-left: 4px solid var(--accent-color);
            padding: 20px;
            margin: 25px 0;
            border-radius: 0 4px 4px 0;
        }

        .meeting-details p {
            margin: 8px 0;
        }

        .meeting-details strong {
            color: var(--primary-color);
        }

        .deadline-box {
            background-color: #fff3cd;
            border: 1px solid #ffc107;
            padding: 20px;
            margin: 25px 0;
            border-radius: 4px;
            text-align: center;
        }

        .deadline-box strong {
            color: #856404;
        }

        .signature-section {
            margin-top: 60px;
            display: flex;
            justify-content: flex-end;
        }

        .signature-block {
            text-align: center;
            width: 250px;
        }

        .signature-line {
            border-bottom: 1px solid #333;
            height: 60px;
            margin-bottom: 10px;
        }

        .signature-name {
            font-weight: bold;
            font-family: 'Arial', sans-serif;
            font-size: 14px;
            color: var(--primary-color);
        }

        .signature-title {
            font-size: 12px;
            color: #666;
            font-style: italic;
            margin-top: 5px;
        }

        .footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            text-align: center;
            font-size: 10px;
            color: #999;
            padding: 10px;
        }
    </style>
</head>
<body>
    <header>
        <div class="logo-container">
            <img src="/logo-valdor.png" alt="Ville de Val-d'Or" class="logo-img">
            <img src="/logo-cce.png" alt="CCE" class="logo-img">
        </div>
        <h1>Comité Consultatif en Environnement</h1>
        <h2>Ville de Val-d'Or</h2>
    </header>

    <div class="document-title">AVIS DE CONVOCATION</div>

    <div class="date-line">Val-d'Or, le ${todayStr}</div>

    <div class="content">
        <p>Bonjour,</p>

        <p>Par la présente, nous vous convoquons à la prochaine assemblée du <strong>Comité consultatif en environnement</strong> de la Ville de Val-d'Or.</p>

        <div class="meeting-details">
            <p>📅 <strong>Date :</strong> ${formattedMeetingDate}</p>
            <p>🕐 <strong>Heure :</strong> ${timeStr}</p>
            <p>📍 <strong>Lieu :</strong> ${meeting.location || 'Ville de Val-d\'Or'}</p>
        </div>

        <div class="deadline-box">
            <p>📋 <strong>Date limite pour soumettre des sujets à l'ordre du jour :</strong></p>
            <p style="font-size: 18px; margin-top: 10px;"><strong>${deadlineStr}</strong></p>
            <p style="font-size: 12px; margin-top: 10px;">
                Veuillez faire parvenir vos suggestions par courriel à : 
                <a href="mailto:${senderMember.email}" style="color: var(--primary-color);">${senderMember.email}</a>
            </p>
        </div>

        <p>Nous vous prions de bien vouloir accuser réception du présent avis et de confirmer votre présence.</p>

        <p>Dans l'attente de vous rencontrer, veuillez agréer l'expression de nos salutations distinguées.</p>
    </div>

    <div class="signature-section">
        <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-name">${senderMember.displayName}</div>
            <div class="signature-title">Coordonnateur en environnement<br>Secrétaire du CCE</div>
        </div>
    </div>
</body>
</html>
    `;
};

/**
 * Opens print dialog for user to save as PDF
 */
export const generateAvisPDF = async (data: AvisData): Promise<AvisPDFGenerationResult> => {
    try {
        const htmlContent = generateAvisHTML(data);

        // Open print window
        const printWindow = window.open('', '_blank', 'width=816,height=1056');

        if (!printWindow) {
            return { success: false, error: 'Veuillez autoriser les pop-ups pour générer le PDF.' };
        }

        printWindow.document.write(htmlContent);
        printWindow.document.close();

        // Wait for images to load
        await new Promise(resolve => setTimeout(resolve, 1500));

        printWindow.print();

        return { success: true };
    } catch (error) {
        console.error('Error generating Avis PDF:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur lors de la génération du PDF'
        };
    }
};

/**
 * Generates the HTML content and saves it to Firebase Storage for later PDF conversion
 * This is used when we need to attach the PDF to an email
 */
export const generateAndUploadAvisHTML = async (
    data: AvisData,
    meetingId: string
): Promise<{ success: boolean; htmlUrl?: string; error?: string }> => {
    try {
        const htmlContent = generateAvisHTML(data);

        // Upload HTML to Firebase Storage
        const storage = getStorage();
        const timestamp = Date.now();
        const fileName = `avis_convocation_${meetingId}_${timestamp}.html`;
        const storageRef = ref(storage, `convocations/${meetingId}/${fileName}`);

        await uploadString(storageRef, htmlContent, 'raw', {
            contentType: 'text/html'
        });

        const htmlUrl = await getDownloadURL(storageRef);

        return { success: true, htmlUrl };
    } catch (error) {
        console.error('Error uploading Avis HTML:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur lors de l\'upload'
        };
    }
};
