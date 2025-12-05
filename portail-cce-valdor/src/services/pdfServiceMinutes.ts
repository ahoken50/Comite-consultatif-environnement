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
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);

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
    doc.text('COMITÉ CONSULTATIF EN ENVIRONNEMENT', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text('PROCÈS-VERBAL', pageWidth / 2, 28, { align: 'center' });

    doc.setFontSize(12);
    doc.text(meeting.title.toUpperCase(), pageWidth / 2, 36, { align: 'center' });

    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    const timeStr = format(new Date(meeting.date), 'HH:mm', { locale: fr }).replace(':', ' h ');

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    // Introductory paragraph
    const introText = `PROCÈS-VERBAL de la ${meeting.title} du Comité consultatif en environnement tenue le ${dateStr}, ${timeStr} à ${meeting.location}.`;
    const splitIntro = doc.splitTextToSize(introText, contentWidth);
    doc.text(splitIntro, margin, 45);

    let currentY = 45 + (splitIntro.length * 5) + 5;

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
        const splitNames = doc.splitTextToSize(names, contentWidth - labelWidth);
        doc.text(splitNames, margin + labelWidth, currentY);

        currentY += (splitNames.length * 5) + 5;
    }

    // ÉTAIENT AUSSI PRÉSENTS
    if (othersPresent.length > 0) {
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
        const splitNotes = doc.splitTextToSize(globalNotes, contentWidth);
        doc.text(splitNotes, margin, currentY);
        currentY += (splitNotes.length * 5) + 10;
    }

    // --- Agenda Items ---
    meeting.agendaItems.forEach((item) => {
        // Check for page break
        if (currentY > doc.internal.pageSize.height - 40) {
            doc.addPage();
            currentY = 20;
        }

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(item.title, margin, currentY);
        currentY += 7;

        // Minute Number (Resolution or Comment)
        if (item.minuteNumber) {
            const label = item.minuteType === 'resolution' ? 'RÉSOLUTION' : 'COMMENTAIRE';
            doc.text(`${label} ${item.minuteNumber}`, margin, currentY);
            currentY += 7;
        }

        // Content
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const content = item.decision || 'Aucune note consignée.';
        const splitContent = doc.splitTextToSize(content, contentWidth);
        doc.text(splitContent, margin, currentY);
        currentY += (splitContent.length * 5) + 5;

        // Mover/Seconder for Resolutions
        if (item.minuteType === 'resolution' && (item.proposer || item.seconder)) {
            // Check for page break
            if (currentY > doc.internal.pageSize.height - 30) {
                doc.addPage();
                currentY = 20;
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
    if (signatureY > doc.internal.pageSize.height - 40) {
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
