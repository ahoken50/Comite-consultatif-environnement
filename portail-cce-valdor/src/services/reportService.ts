import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Project } from '../types/project.types';

/**
 * Generates a one-page status brief PDF for the given projects.
 * Focuses on active and urgent projects.
 */
export const generateStatusBrief = (projects: Project[]) => {
    const doc = new jsPDF();
    const now = new Date();

    // -- Header --
    doc.setFontSize(18);
    doc.text('Brief de Statut - CCE Val-d\'Or', 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Généré le ${format(now, 'd MMMM yyyy à HH:mm', { locale: fr })}`, 14, 28);

    // -- Stats Summary --
    const activeProjects = projects.filter(p => p.status === 'in_progress' || p.status === 'blocked');
    const urgentProjects = projects.filter(p => p.isUrgent);

    doc.setDrawColor(200);
    doc.line(14, 32, 196, 32);

    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Projets Actifs: ${activeProjects.length}`, 14, 40);
    doc.text(`Urgents: ${urgentProjects.length}`, 60, 40);

    // -- Priority Table --
    // Filter for table: Active or Urgent projects only, sorted by urgency then priority
    const tableData = projects
        .filter(p => p.status === 'in_progress' || p.status === 'blocked' || p.status === 'pending')
        .sort((a, b) => {
            if (a.isUrgent && !b.isUrgent) return -1;
            if (!a.isUrgent && b.isUrgent) return 1;
            // Map priority to number
            const priorityMap: Record<string, number> = { high: 3, medium: 2, low: 1 };
            return (priorityMap[b.priority] || 0) - (priorityMap[a.priority] || 0);
        })
        .map(p => [
            p.code || 'N/A',
            p.name,
            p.status === 'blocked' ? 'BLOQUÉ' : (p.status === 'in_progress' ? 'En cours' : 'En attente'),
            p.isUrgent ? 'OUI' : 'Non',
            p.priority === 'high' ? 'Haute' : (p.priority === 'medium' ? 'Moyenne' : 'Basse'),
            p.nextSteps ? (p.nextSteps.length > 50 ? p.nextSteps.substring(0, 50) + '...' : p.nextSteps) : '-'
        ]);

    autoTable(doc, {
        startY: 45,
        head: [['Code', 'Projet', 'Statut', 'Urgent', 'Priorité', 'Prochaines étapes']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 50, fontStyle: 'bold' },
            2: { cellWidth: 25 },
            3: { cellWidth: 15 },
            4: { cellWidth: 20 },
            5: { cellWidth: 'auto' }
        },
        didParseCell: (data: any) => {
            // Highlight Urgent rows or Blocked status
            if (data.section === 'body') {
                const isUrgent = data.row.raw[3] === 'OUI';
                const isBlocked = data.row.raw[2] === 'BLOQUÉ';

                if (isUrgent || isBlocked) {
                    data.cell.styles.fillColor = [254, 242, 242]; // Light red bg
                }
                if (isBlocked && data.column.index === 2) {
                    data.cell.styles.textColor = [220, 38, 38]; // Red text
                    data.cell.styles.fontStyle = 'bold';
                }
            }
        }
    });

    // -- Footer --
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${i} / ${pageCount}`, 196, 290, { align: 'right' });
    }

    doc.save(`Brief_Statut_CCE_${format(now, 'yyyy-MM-dd')}.pdf`);
};
