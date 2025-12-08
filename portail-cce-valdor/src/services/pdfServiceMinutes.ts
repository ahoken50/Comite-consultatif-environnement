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

export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string) => {
    const doc = new jsPDF({
        format: 'legal',
        unit: 'mm'
    });
    const pageWidth = doc.internal.pageSize.width;
    const margin = 25.4; // 1 inch
    const contentWidth = pageWidth - (margin * 2);

    // Helper to write text with safe page breaks
    const writeSafeText = (text: string | string[], x: number, y: number, options?: { align?: 'left' | 'center' | 'right', maxWidth?: number }): number => {
        const align = options?.align || 'left';
        const maxWidth = options?.maxWidth || contentWidth;
        const lineHeight = 5;

        // If text is string, split it
        let lines: string[] = [];
        if (typeof text === 'string') {
            lines = doc.splitTextToSize(text, maxWidth);
        } else {
            lines = text;
        }

        let currentLineY = y;

        lines.forEach(line => {
            // Check page break
            if (currentLineY > doc.internal.pageSize.height - margin) {
                doc.addPage();
                currentLineY = margin; // Reset to top margin
            }
            doc.text(line, x, currentLineY, { align });
            currentLineY += lineHeight;
        });

        return currentLineY;
    };

    // --- Header ---
    try {
        const logo = await loadImage(logoUrl);
        // Logo on the left
        doc.addImage(logo, 'PNG', margin, 10, 25, 25);
    } catch (e) {
        console.error("Could not load logo", e);
    }

    // Centered Title Block
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    // Move text down to avoid overlap with logo (y=10 to 35)
    doc.text('COMITÉ CONSULTATIF EN ENVIRONNEMENT', pageWidth / 2, 25, { align: 'center' });

    doc.setFontSize(12);
    doc.text('PROCÈS-VERBAL', pageWidth / 2, 33, { align: 'center' });

    doc.setFontSize(12);
    doc.text(meeting.title.toUpperCase(), pageWidth / 2, 41, { align: 'center' });

    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    const timeStr = format(new Date(meeting.date), 'HH:mm', { locale: fr }).replace(':', ' h ');
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    doc.text(formattedDate, pageWidth / 2, 49, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    // Introductory paragraph
    const introText = `PROCÈS-VERBAL de la ${meeting.title} du Comité consultatif en environnement tenue le ${dateStr}, ${timeStr} à ${meeting.location}.`;
    let currentY = writeSafeText(introText, margin, 60);
    currentY += 5;

    // --- Attendees Logic ---
    const members = meeting.attendees?.filter(a => a.role !== 'Secrétaire' && a.role !== 'Conseiller responsable' && a.role !== 'Conseiller') || [];
    const others = meeting.attendees?.filter(a => a.role === 'Secrétaire' || a.role === 'Conseiller responsable' || a.role === 'Conseiller') || [];
    const absents = meeting.attendees?.filter(a => !a.isPresent) || [];
    const presents = members.filter(a => a.isPresent);
    const othersPresent = others.filter(a => a.isPresent);

    // Helper to format names with roles
    const formatName = (a: typeof members[0]) => {
        // If role is generic 'Membre' or empty, just show name. If specific role (Présidente, Vice-président), append it.
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
        // We need to handle wrapping manually here to indent lines after the first one
        // We use writeSafeText but offset the first line manually? 
        // Or simpler: just split and write.
        const splitNames = doc.splitTextToSize(names, contentWidth - labelWidth);
        doc.text(splitNames, margin + labelWidth, currentY);

        // Calculate new Y based on lines
        currentY += (splitNames.length * 5) + 5;
    }

    // ÉTAIENT AUSSI PRÉSENTS
    if (othersPresent.length > 0) {
        if (currentY > doc.internal.pageSize.height - margin - 20) { doc.addPage(); currentY = margin; }

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
        if (currentY > doc.internal.pageSize.height - margin - 20) { doc.addPage(); currentY = margin; }

        doc.setFont('helvetica', 'bold');
        doc.text('ÉTAIT ABSENT(E)', margin, currentY);
        const labelWidth = doc.getTextWidth('ÉTAIT ABSENT(E) ');

        doc.setFont('helvetica', 'normal');
        const names = absents.map(a => a.name).join(', ');
        const splitNames = doc.splitTextToSize(names, contentWidth - labelWidth);
        doc.text(splitNames, margin + labelWidth, currentY);
        currentY += (splitNames.length * 5) + 5;
    }

    // --- Global Notes / Opening ---
    if (globalNotes) {
        currentY = writeSafeText(globalNotes, margin, currentY);
        currentY += 5;
    }

    // --- Agenda Items ---
    meeting.agendaItems.forEach((item) => {
        // Evaluate rough space needed for title + potential content
        if (currentY > doc.internal.pageSize.height - margin - 20) {
            doc.addPage();
            currentY = margin;
        }

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(item.title, margin, currentY);
        currentY += 7;

        // Minute Number (Resolution or Comment)
        if (item.minuteNumber) {
            if (currentY > doc.internal.pageSize.height - margin) { doc.addPage(); currentY = margin; }
            const label = item.minuteType === 'resolution' ? 'RÉSOLUTION' : 'COMMENTAIRE';
            doc.text(`${label} ${item.minuteNumber}`, margin, currentY);
            currentY += 7;
        }

        // Content
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const content = item.decision || 'Aucune note consignée.';
        currentY = writeSafeText(content, margin, currentY);
        currentY += 5;

        // Mover/Seconder for Resolutions
        if (item.minuteType === 'resolution' && (item.proposer || item.seconder)) {
            if (currentY > doc.internal.pageSize.height - margin - 15) {
                doc.addPage();
                currentY = margin;
            }

            if (item.proposer) {
                doc.text(`Proposé par : ${item.proposer}`, margin, currentY);
                currentY += 5;
            }
            if (item.seconder) {
                doc.text(`Appuyé par : ${item.seconder}`, margin, currentY);
                currentY += 5;
            }
            currentY += 5;
        }

        currentY += 5; // Spacing between items
    });

    // --- Signatures ---
    // Ensure we have space
    let signatureY = currentY + 20;
    if (signatureY > doc.internal.pageSize.height - margin - 40) {
        doc.addPage();
        signatureY = 40;
    }

    doc.setFontSize(11);

    // President Signature
    doc.text('___________________________', margin, signatureY);
    doc.text('PATRICIA BOUTIN, Présidente', margin, signatureY + 6);

    // Secretary Signature
    const signatureX = pageWidth - 80;
    doc.text('___________________________', signatureX, signatureY);
    doc.text('MICHAËL ROSS, Secrétaire', signatureX, signatureY + 6);

    doc.save(`PV-${meeting.date.split('T')[0]}.pdf`);
};
