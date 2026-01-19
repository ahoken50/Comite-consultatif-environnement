import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportSection } from '../types/report.types';

// Mock data fetchers for now - in real app, these would fetch from Firestore or Redux
const fetchProjectData = async (_year: number | string) => {
    // This would fetch actual data
    return [
        { title: 'Reaménagement Parc', status: 'En cours', budget: '50 000$', date: '2024-03-15' },
        { title: 'Étude Qualité Air', status: 'Terminé', budget: '15 000$', date: '2024-01-10' },
        { title: 'Plantation Arbres', status: 'Planifié', budget: '5 000$', date: '2024-05-20' },
    ];
};

export const generateCustomReport = async (sections: ReportSection[]) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let cursorY = 20;

    const addPage = () => {
        doc.addPage();
        cursorY = 20;
    };

    const checkSpace = (height: number) => {
        if (cursorY + height > pageHeight - 20) {
            addPage();
        }
    };

    // Helper to add title
    const addSectionTitle = (title: string) => {
        checkSpace(20);
        doc.setFontSize(16);
        doc.setTextColor(33, 33, 33);
        doc.text(title, 20, cursorY);
        cursorY += 10;
        doc.setLineWidth(0.5);
        doc.line(20, cursorY, pageWidth - 20, cursorY);
        cursorY += 15;
    };

    for (const section of sections) {
        switch (section.type) {
            case 'cover':
                // Cover Page
                doc.setFillColor(41, 128, 185); // Blue background
                doc.rect(0, 0, pageWidth, pageHeight, 'F');

                doc.setTextColor(255, 255, 255);
                doc.setFontSize(30);
                doc.text(section.title, pageWidth / 2, pageHeight / 3, { align: 'center' });

                if (section.subtitle) {
                    doc.setFontSize(18);
                    doc.text(section.subtitle, pageWidth / 2, (pageHeight / 3) + 15, { align: 'center' });
                }

                if (section.config.year) {
                    doc.setFontSize(24);
                    doc.text(section.config.year.toString(), pageWidth / 2, (pageHeight / 3) + 30, { align: 'center' });
                }

                // Reset for next pages
                addPage();
                doc.setTextColor(0, 0, 0);
                break;

            case 'intro':
            case 'text':
            case 'conclusion':
                addSectionTitle(section.title);
                doc.setFontSize(12);
                const text = section.config.content || "(Aucun contenu)";
                const splitText = doc.splitTextToSize(text, pageWidth - 40);
                checkSpace(splitText.length * 7);
                doc.text(splitText, 20, cursorY);
                cursorY += (splitText.length * 7) + 10;
                break;

            case 'stats':
                addSectionTitle(section.title);
                // Simple Stats Row
                const stats = [
                    { label: 'Projets', value: '12' },
                    { label: 'Réunions', value: '8' },
                    { label: 'Résolutions', value: '24' }
                ];

                let xOffset = 20;
                stats.forEach(stat => {
                    doc.setFillColor(240, 240, 240);
                    doc.rect(xOffset, cursorY, 50, 30, 'F');
                    doc.setFontSize(10);
                    doc.text(stat.label, xOffset + 25, cursorY + 10, { align: 'center' });
                    doc.setFontSize(14);
                    doc.setFont("helvetica", "bold");
                    doc.text(stat.value, xOffset + 25, cursorY + 22, { align: 'center' });
                    doc.setFont("helvetica", "normal");
                    xOffset += 60;
                });
                cursorY += 40;
                break;

            case 'projects':
                addSectionTitle(section.title);
                const projectData = await fetchProjectData(section.config.year);

                autoTable(doc, {
                    startY: cursorY,
                    head: [['Titre', 'Statut', 'Budget', 'Date']],
                    body: projectData.map(p => [p.title, p.status, p.budget, p.date]),
                    theme: 'grid',
                    headStyles: { fillColor: [41, 128, 185] }
                });

                // Update cursor after table
                cursorY = (doc as any).lastAutoTable.finalY + 20;
                break;

            default:
                addSectionTitle(section.title);
                doc.text("Section non implémentée: " + section.type, 20, cursorY);
                cursorY += 20;
        }
    }

    doc.save(`Rapport_CCE_${new Date().toISOString().split('T')[0]}.pdf`);
};
