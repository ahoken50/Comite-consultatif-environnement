import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportSection } from '../types/report.types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

// Fetch actual project data from Firestore for the specified year
const fetchProjectData = async (year: number | string) => {
    try {
        const querySnapshot = await getDocs(collection(db, 'projects'));
        const allProjects = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as any));

        // Filter projects by year
        const filtered = allProjects.filter(p => {
            if (!p.dateCreated) return false;
            const date = new Date(p.dateCreated);
            return date.getFullYear().toString() === year.toString();
        });

        // Format for the report
        return filtered.map(p => ({
            title: p.name || 'Sans titre',
            status: p.status || 'N/A',
            budget: p.budget || 'N/A',
            date: p.dateCreated ? p.dateCreated.split('T')[0] : 'N/A'
        }));
    } catch (e) {
        console.error("Failed to fetch projects for report:", e);
        return [];
    }
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
                
                let projectCount = 0;
                let meetingCount = 0;
                let resolutionCount = 0;
                
                try {
                    const projectsSnap = await getDocs(collection(db, 'projects'));
                    const meetingsSnap = await getDocs(collection(db, 'meetings'));
                    
                    const yearFilter = section.config.year ? section.config.year.toString() : '';
                    
                    const filteredProjects = projectsSnap.docs.filter(docSnap => {
                        const data = docSnap.data();
                        if (!yearFilter) return true;
                        if (!data.dateCreated) return false;
                        const date = new Date(data.dateCreated);
                        return date.getFullYear().toString() === yearFilter;
                    });
                    
                    const filteredMeetings = meetingsSnap.docs.filter(docSnap => {
                        const data = docSnap.data();
                        if (!yearFilter) return true;
                        if (!data.date) return false;
                        const date = new Date(data.date);
                        return date.getFullYear().toString() === yearFilter;
                    });
                    
                    projectCount = filteredProjects.length;
                    meetingCount = filteredMeetings.length;
                    
                    // Sum resolutions across filtered meetings
                    filteredMeetings.forEach(docSnap => {
                        const data = docSnap.data();
                        if (data.agendaItems && Array.isArray(data.agendaItems)) {
                            data.agendaItems.forEach((item: any) => {
                                if (item.minuteEntries && Array.isArray(item.minuteEntries)) {
                                    resolutionCount += item.minuteEntries.filter((e: any) => e.type === 'resolution').length;
                                }
                            });
                        }
                    });
                } catch (err) {
                    console.error("Error calculating actual stats:", err);
                }

                // Stats Row
                const stats = [
                    { label: 'Projets', value: projectCount.toString() },
                    { label: 'Réunions', value: meetingCount.toString() },
                    { label: 'Résolutions', value: resolutionCount.toString() }
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

export const generateAnnualSummaryReport = async (year: number) => {
    // 1. Fetch meetings for the year
    const meetingsSnap = await getDocs(collection(db, 'meetings'));
    const yearStr = year.toString();
    const meetings = meetingsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as any))
        .filter(m => {
            if (!m.date) return false;
            return m.date.startsWith(yearStr) || new Date(m.date).getFullYear().toString() === yearStr;
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (meetings.length === 0) {
        throw new Error(`Aucune assemblée trouvée pour l'année ${year}`);
    }

    // 2. Compile context for Gemini
    let context = `RÉSUMÉ DES ASSEMBLÉES DU CCE DE L'ANNÉE ${year}\n\n`;
    meetings.forEach((m, idx) => {
        context += `ASSEMBLÉE #${idx + 1} : ${m.title}\n`;
        context += `Date : ${m.date}\n`;
        context += `Présents : ${m.attendees?.map((a: any) => `${a.name} (${a.role})`).join(', ') || 'N/A'}\n`;
        context += `Points à l'ordre du jour et résolutions :\n`;
        if (m.agendaItems && Array.isArray(m.agendaItems)) {
            m.agendaItems.forEach((item: any, i: number) => {
                context += `  Point ${i + 1} : ${item.title}\n`;
                if (item.decision) context += `    Décision : ${item.decision}\n`;
                if (item.minuteEntries && Array.isArray(item.minuteEntries)) {
                    item.minuteEntries.forEach((entry: any) => {
                        context += `    [${entry.type === 'resolution' ? 'Résolution' : 'Commentaire'}] ${entry.content}\n`;
                    });
                }
            });
        }
        context += `-------------------------------------------\n\n`;
    });

    // 3. Call AI Service to generate annual summary
    const { aiService } = await import('./ai/UnifiedAIService');
    const summaryText = await aiService.generateAnnualSummary(year, context);

    // 4. Generate high-fidelity PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let cursorY = 20;

    const addPage = () => {
        doc.addPage();
        cursorY = 25;
    };

    const checkSpace = (height: number) => {
        if (cursorY + height > pageHeight - 20) {
            addPage();
        }
    };

    // Draw header/footer on pages (excluding cover page)
    const drawPageDecorations = (pageNumber: number) => {
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        // Header
        doc.text("Comité Consultatif de l'Environnement (CCE) - Ville de Val-d'Or", 20, 10);
        doc.setDrawColor(220, 220, 220);
        doc.line(20, 12, pageWidth - 20, 12);
        // Footer
        doc.text(`Rapport Annuel ${year} | Page ${pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    };

    // PAGE 1: Cover Page
    doc.setFillColor(34, 112, 63); // Institutional Green for Val-d'Or
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.text("RAPPORT ANNUEL D'ACTIVITÉS", pageWidth / 2, pageHeight / 3, { align: 'center' });
    
    doc.setFontSize(20);
    doc.setFont("helvetica", "normal");
    doc.text("Comité Consultatif de l'Environnement", pageWidth / 2, (pageHeight / 3) + 15, { align: 'center' });

    doc.setFontSize(36);
    doc.setFont("helvetica", "bold");
    doc.text(yearStr, pageWidth / 2, (pageHeight / 3) + 35, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Ville de Val-d'Or, Québec", pageWidth / 2, pageHeight - 30, { align: 'center' });
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-CA')}`, pageWidth / 2, pageHeight - 20, { align: 'center' });

    // PAGE 2+: Synthesized Report Content
    doc.addPage();
    doc.setTextColor(33, 33, 33);
    doc.setFont("helvetica", "normal");
    cursorY = 25;
    let pageCount = 2;
    drawPageDecorations(pageCount);

    // Split text by lines and parse markdown-like structures
    const lines = summaryText.split('\n');
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
            cursorY += 5;
            return;
        }

        if (trimmed.startsWith('# ')) {
            // Main title
            checkSpace(25);
            cursorY += 5;
            doc.setFontSize(18);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(34, 112, 63); // Green Accent
            doc.text(trimmed.substring(2), 20, cursorY);
            cursorY += 12;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(33, 33, 33);
        } else if (trimmed.startsWith('## ')) {
            // Subtitle
            checkSpace(20);
            cursorY += 5;
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(41, 128, 185); // Blue Accent
            doc.text(trimmed.substring(3), 20, cursorY);
            cursorY += 10;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(33, 33, 33);
        } else if (trimmed.startsWith('### ')) {
            // H3 Title
            checkSpace(15);
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text(trimmed.substring(4), 20, cursorY);
            cursorY += 7;
            doc.setFont("helvetica", "normal");
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            // Bullet points
            doc.setFontSize(10.5);
            const bulletText = doc.splitTextToSize(`• ${trimmed.substring(2)}`, pageWidth - 45);
            checkSpace(bulletText.length * 6);
            bulletText.forEach((bLine: string, index: number) => {
                doc.text(bLine, index === 0 ? 22 : 26, cursorY);
                cursorY += 6;
            });
            cursorY += 2;
        } else {
            // Standard Paragraph text
            doc.setFontSize(10.5);
            const paragraphText = doc.splitTextToSize(trimmed, pageWidth - 40);
            checkSpace(paragraphText.length * 6);
            paragraphText.forEach((pLine: string) => {
                doc.text(pLine, 20, cursorY);
                cursorY += 6;
            });
            cursorY += 2;
        }

        // Add decorations if page added inside loops
        const activePage = (doc as any).internal.getCurrentPageInfo().pageNumber;
        if (activePage > pageCount) {
            pageCount = activePage;
            drawPageDecorations(pageCount);
        }
    });

    doc.save(`Rapport_Annuel_CCE_${yearStr}.pdf`);
};
