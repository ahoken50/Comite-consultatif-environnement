import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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

    // --- Header ---
    try {
        const logo = await loadImage(logoUrl);
        doc.addImage(logo, 'PNG', 14, 10, 40, 15);
    } catch (e) {
        console.error("Could not load logo", e);
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('COMITÉ CONSULTATIF EN ENVIRONNEMENT', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('PROCÈS-VERBAL', pageWidth / 2, 28, { align: 'center' });
    doc.text(meeting.title.toUpperCase(), pageWidth / 2, 35, { align: 'center' });

    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    doc.text(formattedDate, pageWidth / 2, 42, { align: 'center' });

    let currentY = 55;

    // --- Attendees ---
    // For now, we don't have a full attendance module, so we'll skip or list hardcoded if available.
    // Future: Add attendance list here.

    // --- Global Notes ---
    if (globalNotes) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Notes générales:', 14, currentY);
        currentY += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);

        const splitNotes = doc.splitTextToSize(globalNotes, pageWidth - 28);
        doc.text(splitNotes, 14, currentY);
        currentY += (splitNotes.length * 5) + 10;
    }

    // --- Agenda Items & Decisions ---
    const tableBody = meeting.agendaItems.map((item) => [
        `${item.order}.`,
        item.title,
        item.decision || 'Aucune note consignée.'
    ]);

    autoTable(doc, {
        startY: currentY,
        head: [['#', 'Sujet', 'Décision / Note']],
        body: tableBody,
        theme: 'grid', // Grid theme is better for minutes to separate items clearly
        styles: {
            fontSize: 10,
            cellPadding: 4,
            valign: 'top',
            overflow: 'linebreak'
        },
        headStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            lineWidth: 0.1,
            lineColor: [200, 200, 200]
        },
        columnStyles: {
            0: { cellWidth: 10, fontStyle: 'bold' },
            1: { cellWidth: 60, fontStyle: 'bold' },
            2: { cellWidth: 'auto' }
        },
    });

    // --- Signatures ---
    const finalY = (doc as any).lastAutoTable.finalY || currentY + 50;

    let signatureY = finalY + 30;
    if (signatureY > doc.internal.pageSize.height - 40) {
        doc.addPage();
        signatureY = 40;
    }

    doc.setFontSize(11);
    const signatureX = pageWidth - 80;

    doc.text('_________________________________', signatureX, signatureY);
    doc.setFont('helvetica', 'bold');
    doc.text('MICHAËL ROSS', signatureX, signatureY + 6);
    doc.setFont('helvetica', 'normal');
    doc.text('Coordonnateur en environnement', signatureX, signatureY + 11);
    doc.text('Secrétaire', signatureX, signatureY + 16);

    doc.save(`PV-${meeting.date.split('T')[0]}.pdf`);
};
