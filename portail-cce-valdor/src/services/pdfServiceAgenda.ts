import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
// @ts-ignore
import html2pdf from 'html2pdf.js';

export interface PDFGenerationResult {
    success: boolean;
    error?: string;
}

/**
 * Helper to generate the HTML string for the agenda.
 * Shared between print and base64 generation.
 */
const getAgendaHTML = (meeting: Meeting): string => {
    // Format date
    const meetingDate = new Date(meeting.date);
    const dateStr = format(meetingDate, 'EEEE d MMMM yyyy', { locale: fr });
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    const timeStr = format(meetingDate, 'HH', { locale: fr }) + ' h ' + format(meetingDate, 'mm', { locale: fr });

    // Helper for objective color coding
    const getObjectiveStyle = (objective: string = 'Information') => {
        const obj = objective.toLowerCase();
        if (obj.includes('décision') || obj.includes('résolution')) return 'background-color: #fce4ec; color: #880e4f; border: 1px solid #f8bbd0;'; // Pink/Red
        if (obj.includes('information')) return 'background-color: #e3f2fd; color: #0d47a1; border: 1px solid #bbdefb;'; // Blue
        if (obj.includes('discussion') || obj.includes('consultation')) return 'background-color: #f3e5f5; color: #4a148c; border: 1px solid #e1bee7;'; // Purple
        return 'background-color: #eee; color: #333;'; // Default logic
    };

    // Sort items by order if possible, otherwise keep as is
    const sortedItems = [...meeting.agendaItems].sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) {
            return a.order - b.order;
        }
        return 0;
    });

    // Generate agenda items HTML rows
    const agendaRowsHtml = sortedItems.map((item, index) => {
        const rowClass = index % 2 === 0 ? 'even' : 'row';
        const itemNumber = index + 1; // Enforce sequential numbering 1..N
        const objectiveStyle = getObjectiveStyle(item.objective);

        return `
            <tr class="row ${rowClass}">
                <td class="col-num">${itemNumber}</td>
                <td class="cell col-title">
                    <div class="title-container">
                        <span class="title-text">${item.title}</span>
                    </div>
                    ${(item.description || item.agendaNote) ? `<span class="desc-text">${item.description || item.agendaNote}</span>` : ''}
                </td>
                <td class="cell col-lead">
                    <div style="margin-bottom: 3px;">${item.presenter || 'Président'}</div>
                    <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
                         <span class="chip" style="${objectiveStyle}">${item.objective || 'Information'}</span>
                         <span class="chip" style="background: #e0e0e0; color: #333;">${item.duration || 10} min</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ordre du Jour - CCE Val-d'Or</title>
    <style>
        @page {
            size: 8.5in 14in; /* Legal Size */
            margin: 0;
        }

        :root {
            --primary: #00563f; /* Vert Application */
            --secondary: #333333;
            --accent: #e8f5e9;
            --paper-width: 8.5in;
            --paper-height: 14in;
        }

        body {
            font-family: 'Segoe UI', 'Roboto', 'Helvetica', sans-serif;
            background-color: #fff;
            margin: 0;
            color: var(--secondary);
            -webkit-print-color-adjust: exact;
        }

        .sheet {
            width: 100%;
            height: 100%;
            padding: 0.5in 0.6in; /* Reduced margins */
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        /* HEADER */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid var(--primary); /* Thinner border */
            padding-bottom: 10px; /* Reduced */
            margin-bottom: 15px; /* Reduced */
        }

        .header-logos {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .logo-img {
            height: 55px; /* Smaller logos */
            object-fit: contain;
        }

        .header-text {
            text-align: right;
        }

        h1 {
            margin: 0;
            font-size: 18pt; /* Smaller title */
            color: var(--primary);
            text-transform: uppercase;
            font-weight: 700;
            letter-spacing: 0.5px;
        }

        .sub-header {
            font-size: 9pt; /* Smaller subtitle */
            margin-top: 2px;
            color: #555;
            font-weight: 500;
        }

        /* CONTENT */
        .content {
            flex-grow: 1;
        }

        /* TABLE LAYOUT */
        .agenda-table {
            width: 100%;
            border-collapse: collapse;
        }

        .agenda-table th {
            text-align: left;
            padding-bottom: 6px; /* Reduced */
            color: var(--primary);
            font-size: 8.5pt;
            border-bottom: 1px solid #eee;
            text-transform: uppercase;
        }

        .row {
            border-bottom: 1px solid #f0f0f0;
        }
        
        .row.even {
            background-color: #fafafa;
        }

        .cell {
            padding: 5px 4px; /* Reduced cell padding */
            vertical-align: top;
        }

        .col-num {
            width: 35px;
            font-weight: bold;
            color: var(--primary);
            font-size: 10pt;
            text-align: center;
            padding-top: 5px;
        }

        .col-lead {
            width: 140px; /* Slightly wider for the chips */
            font-size: 8.5pt;
            color: #666;
            text-align: right;
        }

        .title-text {
            font-weight: 600;
            font-size: 10pt; /* Smaller regular text */
            margin-bottom: 1px;
            color: #222;
        }

        .desc-text {
            font-size: 8.5pt;
            color: #555;
            font-style: italic;
            line-height: 1.2;
            display: block;
        }

        .chip {
            display: inline-block;
            border-radius: 3px;
            padding: 1px 5px;
            font-size: 7pt; /* Smaller chips */
            font-weight: 600;
            white-space: nowrap;
        }

        /* SIGNATURE SECTION */
        .signature-section {
            margin-top: auto; /* Push to bottom */
            padding-top: 20px;
            display: flex;
            justify-content: flex-end;
            page-break-inside: avoid;
        }

        .signature-block {
            width: 250px;
            text-align: center;
        }

        .signature-line {
            border-bottom: 1px solid #333;
            height: 40px; /* Space for digital signature */
            margin-bottom: 8px;
            width: 100%;
        }

        .signature-name {
            font-weight: 700;
            font-size: 11pt;
            text-transform: uppercase;
            color: var(--secondary);
        }

        .signature-title {
            font-size: 10pt;
            font-style: italic;
            color: #666;
        }

        /* FOOTER */
        .footer {
            margin-top: 15px;
            border-top: 1px solid #eee;
            padding-top: 10px;
            font-size: 8pt;
            color: #999;
            display: flex;
            justify-content: space-between;
        }

        @media print {
            body { margin: 0; background: none; }
            .sheet { padding: 0.5in; }
        }
    </style>
</head>
<body>

    <div class="sheet">
        <header class="header">
            <div class="header-logos">
                <img src="/logo-valdor.png" alt="Ville de Val-d'Or" class="logo-img" onerror="this.style.display='none';">
                <img src="/logo-cce.png" alt="CCE" class="logo-img" onerror="this.style.display='none';">
            </div>
            <div class="header-text">
                <h1>Ordre du Jour</h1>
                <div class="sub-header">${formattedDate} • ${timeStr}</div>
                <div class="sub-header">${meeting.location || 'Salle du Conseil'}</div>
            </div>
        </header>

        <div class="content">
            <table class="agenda-table">
                <thead>
                    <tr>
                        <th class="col-num">#</th>
                        <th class="col-title">Sujet</th>
                        <th class="col-lead">Responsable / Durée</th>
                    </tr>
                </thead>
                <tbody>
                    ${agendaRowsHtml}
                </tbody>
            </table>
        </div>

        <div class="signature-section">
            <div class="signature-block">
                <!-- Espace pour signature numérique -->
                <div class="signature-line"></div> 
                <div class="signature-name">Michaël Ross</div>
                <div class="signature-title">Coordonnateur en environnement<br>Secrétaire</div>
            </div>
        </div>

        <footer class="footer">
            <div>Comité Consultatif en Environnement - Ville de Val-d'Or</div>
            <div>Généré le ${format(new Date(), "dd/MM/yyyy HH:mm")}</div>
        </footer>
    </div>

</body>
</html>
    `;
};

/**
 * Generates a beautifully styled Agenda PDF (Legal Size One-Pager) using HTML template.
 */
export const generateAgendaPDF = async (meeting: Meeting): Promise<PDFGenerationResult> => {
    const htmlContent = getAgendaHTML(meeting);

    // Open text window
    const printWindow = window.open('', '_blank', 'width=850,height=1100'); // Approx dimension ratio

    if (!printWindow) {
        return { success: false, error: 'Veuillez autoriser les pop-ups.' };
    }

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Wait slightly
    await new Promise(resolve => setTimeout(resolve, 1000));
    printWindow.print();

    return { success: true };
};

/**
 * Generates the Agenda PDF as a Base64 string for email attachment.
 * Uses html2pdf.js to render the HTML canvas to PDF.
 */
export const generateAgendaPDFBase64 = async (meeting: Meeting): Promise<string> => {
    const htmlContent = getAgendaHTML(meeting);

    // Create a temporary container
    const container = document.createElement('div');
    container.innerHTML = htmlContent;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.width = '816px'; // 8.5in at 96dpi
    container.style.background = '#fff'; // Ensure white background
    document.body.appendChild(container);

    const opt = {
        margin: 0,
        filename: `Ordre_du_jour_${meeting.date}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in' as const, format: 'legal' as const, orientation: 'portrait' as const }
    };

    try {
        // Generate PDF and get output as data URI string
        const pdfBase64 = await html2pdf().from(container).set(opt).outputPdf('datauristring');
        // Remove the prefix "data:application/pdf;base64," if present
        if (typeof pdfBase64 === 'string' && pdfBase64.includes(',')) {
            return pdfBase64.split(',')[1];
        }
        return pdfBase64;
    } catch (error) {
        console.error("Error generating PDF base64:", error);
        throw error;
    } finally {
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
    }
};
