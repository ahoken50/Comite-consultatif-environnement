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

export const generateAgendaPDF = async (meeting: Meeting) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    // --- Header ---
    try {
        const logo = await loadImage(logoUrl);
        // Add logo centered or left - let's put it top left or centered based on "model" usually has logo top
        // Assuming standard letterhead: Logo top left or center. Let's center it for now or top-left.
        // "Copy formatting" usually implies a specific look. I'll place it Top-Left and Title centered.
        doc.addImage(logo, 'PNG', 14, 10, 40, 15); // Adjust aspect ratio as needed
    } catch (e) {
        console.error("Could not load logo", e);
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    // Center the main committee title
    doc.text('COMITÉ CONSULTATIF EN ENVIRONNEMENT', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    // Center the meeting title (e.g. "3e ASSEMBLÉE ORDINAIRE")
    doc.text(meeting.title.toUpperCase(), pageWidth / 2, 28, { align: 'center' });

    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    // Center the date
    doc.text(formattedDate, pageWidth / 2, 35, { align: 'center' });

    // --- Agenda Items ---
    const tableBody = meeting.agendaItems.map((item) => [
        `${item.order}.`,
        item.title,
        item.objective,
        item.duration + ' min',
        item.presenter,
        item.description || item.decision || ''
    ]);

    autoTable(doc, {
        startY: 45,
        head: [['#', 'Sujet', 'Objectif', 'Durée', 'Responsable', 'Note / Décision']],
        body: tableBody,
        theme: 'plain', // Clean look
        styles: {
            fontSize: 10,
            cellPadding: 3,
            valign: 'middle',
            overflow: 'linebreak'
        },
        headStyles: {
            fontStyle: 'bold',
            fillColor: [255, 255, 255], // White background for header
            textColor: [0, 0, 0], // Black text
            lineWidth: 0.1, // Bottom border for header
            lineColor: [0, 0, 0]
        },
        bodyStyles: {
            lineWidth: 0, // No borders for body rows usually looks cleaner, or minimal
        },
        columnStyles: {
            0: { cellWidth: 10, fontStyle: 'bold' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 25 },
            3: { cellWidth: 15 },
            4: { cellWidth: 35 },
            5: { cellWidth: 45 }
        },
    });

    // --- Signature ---
    const finalY = (doc as any).lastAutoTable.finalY || 150;

    // Ensure we have space
    let signatureY = finalY + 30;
    if (signatureY > doc.internal.pageSize.height - 40) {
        doc.addPage();
        signatureY = 40;
    }

    doc.setFontSize(11);
    // Right aligned signature block often looks professional
    const signatureX = pageWidth - 80;

    doc.text('_________________________________', signatureX, signatureY);
    doc.setFont('helvetica', 'bold');
    doc.text('MICHAËL ROSS', signatureX, signatureY + 6);
    doc.setFont('helvetica', 'normal');
    doc.text('Coordonnateur en environnement', signatureX, signatureY + 11);
    doc.text('Secrétaire', signatureX, signatureY + 16);

    // Save
    doc.save(`ODJ-${meeting.date.split('T')[0]}.pdf`);
};
