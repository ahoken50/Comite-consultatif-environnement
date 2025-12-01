import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
// import logo from '../assets/logo-valdor.png';

export const generateAgendaPDF = (meeting: Meeting) => {
    const doc = new jsPDF();
    // const pageWidth = doc.internal.pageSize.width;

    // --- Header ---
    // Logo (if available, otherwise placeholder)
    // For now, we'll skip the actual image loading to avoid complexity with async loading in this snippet,
    // but in a real app, you'd load the image data URL.
    // doc.addImage(logoDataUrl, 'PNG', 10, 10, 30, 30);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('COMITÉ CONSULTATIF EN ENVIRONNEMENT', 14, 20);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(meeting.title.toUpperCase(), 14, 26);

    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    // Capitalize first letter
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    doc.text(formattedDate, 14, 32);

    // --- Agenda Items ---
    const tableBody = meeting.agendaItems.map((item) => [
        `${item.order}.`,
        item.title,
        item.objective,
        item.duration + ' min',
        item.presenter,
        item.decision || ''
    ]);

    autoTable(doc, {
        startY: 45,
        head: [['#', 'Sujet', 'Objectif', 'Durée', 'Responsable', 'Note / Décision']],
        body: tableBody,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240] },
        columnStyles: {
            0: { cellWidth: 10 },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 25 },
            3: { cellWidth: 20 },
            4: { cellWidth: 30 },
            5: { cellWidth: 40 }
        },
    });

    // --- Signature ---
    const finalY = (doc as any).lastAutoTable.finalY || 150;

    doc.setFontSize(10);
    doc.text('_________________________________', 14, finalY + 40);
    doc.setFont('helvetica', 'bold');
    doc.text('MICHAËL ROSS, coordonnateur en environnement', 14, finalY + 46);
    doc.setFont('helvetica', 'normal');
    doc.text('Secrétaire', 14, finalY + 51);

    // Save
    doc.save(`ODJ-${meeting.date.split('T')[0]}.pdf`);
};
