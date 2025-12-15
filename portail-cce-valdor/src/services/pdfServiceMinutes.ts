import jsPDF from 'jspdf';
import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import logoUrl from '../assets/logo-cce.png';

const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = url;
        img.onload = () => resolve(img);
        img.onerror = reject;
    });
};

/**
 * Sanitize text from Word documents to remove special characters
 * that cause rendering issues in PDF (blue text, weird spacing)
 */
const sanitizeText = (text: string): string => {
    if (!text) return '';

    return text
        // Remove zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Remove soft hyphens
        .replace(/\u00AD/g, '')
        // Remove non-breaking spaces and replace with regular spaces
        .replace(/\u00A0/g, ' ')
        // Remove other special whitespace characters
        .replace(/[\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
        // Remove multiple consecutive spaces
        .replace(/  +/g, ' ')
        // Remove tab characters and replace with space
        .replace(/\t/g, ' ')
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Trim each line
        .split('\n')
        .map(line => line.trim())
        .join('\n');
};

/**
 * Extracts the meeting number from the title (e.g., "9e ASSEMBLÉE" -> "09")
 */
const extractMeetingNumber = (title: string): string => {
    const match = title.match(/(\d+)\s*[eè]/i);
    if (match) {
        return match[1].padStart(2, '0');
    }
    // Fallback: try to find any number
    const numMatch = title.match(/(\d+)/);
    return numMatch ? numMatch[1].padStart(2, '0') : '01';
};

/**
 * Generate auto-numbering for items without minute numbers
 * Format: XX-NN for resolutions, XX-A for comments
 */
const generateMinuteNumber = (
    meetingNum: string,
    minuteType: 'resolution' | 'comment' | 'other' | undefined,
    resolutionCounter: number,
    commentCounter: number
): { number: string; newResCounter: number; newComCounter: number } => {
    if (minuteType === 'resolution') {
        const num = `${meetingNum}-${String(resolutionCounter).padStart(2, '0')}`;
        return { number: num, newResCounter: resolutionCounter + 1, newComCounter: commentCounter };
    } else if (minuteType === 'comment') {
        // Use letters A-Z for comments
        const letter = String.fromCharCode(65 + (commentCounter % 26)); // A=65
        const num = `${meetingNum}-${letter}`;
        return { number: num, newResCounter: resolutionCounter, newComCounter: commentCounter + 1 };
    }
    return { number: '', newResCounter: resolutionCounter, newComCounter: commentCounter };
};

export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string) => {
    const doc = new jsPDF({
        format: 'legal',
        unit: 'mm'
    });
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 25.4; // 1 inch
    const contentWidth = pageWidth - (margin * 2);
    const lineHeight = 5;

    // Extract meeting number for auto-numbering
    const meetingNum = extractMeetingNumber(meeting.title);
    let resolutionCounter = 1;
    let commentCounter = 0;

    // Helper to write text with safe page breaks
    const writeSafeText = (text: string | string[], x: number, y: number, options?: {
        align?: 'left' | 'center' | 'right',
        maxWidth?: number,
        indent?: number
    }): number => {
        const align = options?.align || 'left';
        const maxWidth = options?.maxWidth || contentWidth;
        const indent = options?.indent || 0;

        let lines: string[] = [];
        if (typeof text === 'string') {
            lines = doc.splitTextToSize(text, maxWidth - indent);
        } else {
            lines = text;
        }

        let currentLineY = y;

        lines.forEach((line, index) => {
            if (currentLineY > pageHeight - margin) {
                doc.addPage();
                currentLineY = margin;
            }
            const xPos = index > 0 && indent > 0 ? x + indent : x;
            doc.text(line, xPos, currentLineY, { align });
            currentLineY += lineHeight;
        });

        return currentLineY;
    };

    // --- Header ---
    try {
        const logo = await loadImage(logoUrl);
        doc.addImage(logo, 'PNG', margin, 10, 25, 25);
    } catch (e) {
        console.error("Could not load logo", e);
    }

    // Centered Title Block
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('COMITÉ CONSULTATIF EN ENVIRONNEMENT', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(16);
    doc.text('PROCÈS-VERBAL', pageWidth / 2, 28, { align: 'center' });

    doc.setFontSize(12);
    doc.text(meeting.title.toUpperCase(), pageWidth / 2, 38, { align: 'center' });

    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    const timeStr = format(new Date(meeting.date), 'HH:mm', { locale: fr }).replace(':', ' h ');
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    doc.text(formattedDate, pageWidth / 2, 46, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    // Introductory paragraph
    const introText = `PROCÈS-VERBAL de la ${meeting.title} du Comité consultatif en environnement tenue le ${dateStr}, ${timeStr} à ${meeting.location}.`;
    let currentY = writeSafeText(introText, margin, 58);
    currentY += 5;

    // --- Attendees Logic ---
    const members = meeting.attendees?.filter(a => a.role !== 'Secrétaire' && a.role !== 'Conseiller responsable' && a.role !== 'Conseiller') || [];
    const others = meeting.attendees?.filter(a => a.role === 'Secrétaire' || a.role === 'Conseiller responsable' || a.role === 'Conseiller') || [];
    const absents = meeting.attendees?.filter(a => !a.isPresent) || [];
    const presents = members.filter(a => a.isPresent);
    const othersPresent = others.filter(a => a.isPresent);

    const formatName = (a: typeof members[0]) => {
        const roleSuffix = (a.role && a.role !== 'Membre') ? `, ${a.role.toLowerCase()}` : '';
        return `${a.name}${roleSuffix}`;
    };

    // ÉTAIENT PRÉSENTS
    if (presents.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.text('ÉTAIENT PRÉSENTS', margin, currentY);
        const labelWidth = doc.getTextWidth('ÉTAIENT PRÉSENTS ');

        doc.setFont('helvetica', 'normal');
        const names = presents.map(formatName).join(', ');
        const splitNames = doc.splitTextToSize(names, contentWidth - labelWidth);
        doc.text(splitNames, margin + labelWidth, currentY);
        currentY += (splitNames.length * 5) + 5;
    }

    // ÉTAIENT AUSSI PRÉSENTS
    if (othersPresent.length > 0) {
        if (currentY > pageHeight - margin - 20) { doc.addPage(); currentY = margin; }

        doc.setFont('helvetica', 'bold');
        doc.text('ÉTAIENT AUSSI PRÉSENTS', margin, currentY);
        const labelWidth = doc.getTextWidth('ÉTAIENT AUSSI PRÉSENTS ');

        doc.setFont('helvetica', 'normal');
        const names = othersPresent.map(formatName).join(', ');
        const splitNames = doc.splitTextToSize(names, contentWidth - labelWidth);
        doc.text(splitNames, margin + labelWidth, currentY);
        currentY += (splitNames.length * 5) + 5;
    }

    // ÉTAIT ABSENT(E)
    if (absents.length > 0) {
        if (currentY > pageHeight - margin - 20) { doc.addPage(); currentY = margin; }

        doc.setFont('helvetica', 'bold');
        doc.text('ÉTAIT ABSENT(E)', margin, currentY);
        const labelWidth = doc.getTextWidth('ÉTAIT ABSENT(E) ');

        doc.setFont('helvetica', 'normal');
        const names = absents.map(a => a.name).join(', ');
        const splitNames = doc.splitTextToSize(names, contentWidth - labelWidth);
        doc.text(splitNames, margin + labelWidth, currentY);
        currentY += (splitNames.length * 5) + 5;
    }

    // --- Global Notes ---
    if (globalNotes) {
        currentY += 3;
        currentY = writeSafeText(globalNotes, margin, currentY);
        currentY += 5;
    }

    // --- Agenda Items ---
    meeting.agendaItems.forEach((item) => {
        if (currentY > pageHeight - margin - 30) {
            doc.addPage();
            currentY = margin;
        }

        // Item Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        currentY = writeSafeText(item.title, margin, currentY);
        currentY += 3;

        // Determine minute number (use existing or auto-generate)
        let minuteNumber = item.minuteNumber;
        if (!minuteNumber && item.minuteType) {
            const gen = generateMinuteNumber(meetingNum, item.minuteType, resolutionCounter, commentCounter);
            minuteNumber = gen.number;
            resolutionCounter = gen.newResCounter;
            commentCounter = gen.newComCounter;
        }

        // RÉSOLUTION or COMMENTAIRE header
        if (minuteNumber) {
            if (currentY > pageHeight - margin) { doc.addPage(); currentY = margin; }

            const label = item.minuteType === 'resolution' ? 'RÉSOLUTION' :
                item.minuteType === 'comment' ? 'COMMENTAIRE' : 'NOTE';
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text(`${label} ${minuteNumber}`, margin, currentY);
            currentY += 7;
        }

        // Content (decision/discussion)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0); // Force black text color

        if (item.decision) {
            // Sanitize the content to remove special characters from Word
            const sanitizedDecision = sanitizeText(item.decision);
            // Parse content for CONSIDÉRANT and IL EST RÉSOLU formatting
            const contentLines = sanitizedDecision.split('\n');

            for (const line of contentLines) {
                if (currentY > pageHeight - margin) {
                    doc.addPage();
                    currentY = margin;
                }

                const trimmedLine = line.trim();

                // Ensure text color is always black
                doc.setTextColor(0, 0, 0);

                // CONSIDÉRANT lines - could be bold or styled differently
                if (/^CONSID[ÉE]RANT/i.test(trimmedLine)) {
                    doc.setFont('helvetica', 'normal');
                    currentY = writeSafeText(trimmedLine, margin, currentY);
                }
                // IL EST RÉSOLU - slightly emphasized
                else if (/^IL EST R[ÉE]SOLU/i.test(trimmedLine)) {
                    currentY += 2; // Small gap before
                    doc.setFont('helvetica', 'bold');
                    currentY = writeSafeText(trimmedLine, margin, currentY);
                    doc.setFont('helvetica', 'normal');
                }
                // ATTENDU QUE
                else if (/^ATTENDU/i.test(trimmedLine)) {
                    doc.setFont('helvetica', 'normal');
                    currentY = writeSafeText(trimmedLine, margin, currentY);
                }
                // Regular content
                else if (trimmedLine.length > 0) {
                    doc.setFont('helvetica', 'normal');
                    currentY = writeSafeText(trimmedLine, margin, currentY);
                }
            }
        } else {
            currentY = writeSafeText('Aucune note consignée.', margin, currentY);
        }

        currentY += 3;

        // Proposer/Seconder for Resolutions
        if (item.minuteType === 'resolution' && (item.proposer || item.seconder)) {
            if (currentY > pageHeight - margin - 15) {
                doc.addPage();
                currentY = margin;
            }

            doc.setFontSize(10);
            if (item.proposer) {
                doc.text(`Proposé par : ${item.proposer}`, margin, currentY);
                currentY += 5;
            }
            if (item.seconder) {
                doc.text(`Appuyé par : ${item.seconder}`, margin, currentY);
                currentY += 5;
            }
        }

        currentY += 7; // Spacing between items
    });

    // --- Signatures ---
    let signatureY = currentY + 20;
    if (signatureY > pageHeight - margin - 40) {
        doc.addPage();
        signatureY = 50;
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');

    // Find President and Secretary from attendees
    const president = meeting.attendees?.find(a => a.role?.toLowerCase().includes('président'));
    const secretary = meeting.attendees?.find(a => a.role?.toLowerCase().includes('secrétaire'));

    // President Signature
    doc.text('___________________________', margin, signatureY);
    const presidentName = president ? president.name.toUpperCase() : 'PRÉSIDENT(E)';
    doc.text(`${presidentName}, Président(e)`, margin, signatureY + 6);

    // Secretary Signature
    const signatureX = pageWidth - 80;
    doc.text('___________________________', signatureX, signatureY);
    const secretaryName = secretary ? secretary.name.toUpperCase() : 'SECRÉTAIRE';
    doc.text(`${secretaryName}, Secrétaire`, signatureX, signatureY + 6);

    // Save with formatted filename
    const dateForFile = format(new Date(meeting.date), 'yyyy-MM-dd');
    doc.save(`PV-CCE-${meetingNum}-${dateForFile}.pdf`);
};
