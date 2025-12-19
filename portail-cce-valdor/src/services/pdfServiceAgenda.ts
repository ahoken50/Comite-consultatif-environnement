import html2pdf from 'html2pdf.js';
import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Import logos as URLs
import logoCceUrl from '/logo-cce.png';
import logoValdorUrl from '/logo-valdor.png';

/**
 * Generates a beautifully styled Agenda PDF from meeting data using HTML template.
 */
export const generateAgendaPDF = async (meeting: Meeting) => {
    // Format date
    const meetingDate = new Date(meeting.date);
    const dateStr = format(meetingDate, 'EEEE d MMMM yyyy', { locale: fr });
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    const timeStr = format(meetingDate, 'HH', { locale: fr }) + ' h';

    // Generate agenda items HTML
    const agendaItemsHtml = meeting.agendaItems.map((item, index) => {
        // Determine objective class
        let objectiveClass = 'obj-info';
        let objectiveLabel = item.objective || 'Information';

        if (objectiveLabel.toLowerCase().includes('décision')) {
            objectiveClass = 'obj-decision';
        } else if (objectiveLabel.toLowerCase().includes('discussion') || objectiveLabel.toLowerCase().includes('consultation')) {
            objectiveClass = 'obj-discussion';
        }

        // Handle special last item style
        const isLastItem = item.title.toLowerCase().includes('levée') || item.title.toLowerCase().includes('ajournement');
        const borderStyle = isLastItem ? 'style="border-left-color: #333;"' : '';

        return `
            <div class="agenda-item" ${borderStyle}>
                <div class="agenda-header">
                    <span class="agenda-num">${item.order || index + 1}.</span>
                    <span class="agenda-title">${item.title}</span>
                    <span class="agenda-time">${item.duration || 10} min</span>
                </div>
                <div class="agenda-body">
                    <div class="agenda-details">
                        ${item.description ? `<div class="agenda-note-box">${item.description}</div>` : ''}
                        <div class="agenda-meta">Responsable : <span>${item.presenter || 'Coordonnateur'}</span></div>
                    </div>
                    <div class="agenda-objective-section">
                        <span class="objective-label">Objectif</span>
                        <div class="objective-box ${objectiveClass}">
                            ${objectiveLabel}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Full HTML template
    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ordre du Jour CCE - Ville de Val-d'Or</title>
    <style>
        /* CONFIGURATION GÉNÉRALE */
        :root {
            --primary-color: #1e4e3d;
            --accent-color: #c5a065;
            --text-color: #2b2b2b;
            --bg-color: #ffffff;
            --light-bg: #f9fbfa;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-color);
            font-family: 'Georgia', 'Times New Roman', serif;
            color: var(--text-color);
            padding: 40px;
            line-height: 1.4;
        }

        /* EN-TÊTE AVEC LOGOS */
        header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 3px double var(--primary-color);
            padding-bottom: 20px;
        }

        .logo-container {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 40px;
            margin-bottom: 20px;
        }

        .logo-img {
            max-width: 120px;
            height: auto;
        }

        h1 {
            font-family: 'Arial', sans-serif;
            font-size: 22px;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: var(--primary-color);
            margin: 0 0 8px 0;
            font-weight: 700;
        }

        h2 {
            font-family: 'Arial', sans-serif;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--accent-color);
            margin: 0 0 15px 0;
            font-weight: 600;
        }

        .meeting-info {
            font-size: 16px;
            font-style: italic;
            color: #555;
            line-height: 1.5;
        }

        .meeting-info strong {
            color: var(--primary-color);
        }

        /* ITEMS DE L'AGENDA */
        .agenda-container {
            width: 100%;
        }

        .agenda-item {
            display: flex;
            flex-direction: column;
            background-color: #fff;
            border-left: 5px solid var(--accent-color);
            margin-bottom: 20px;
            border: 1px solid #eee;
            border-left-width: 5px;
            border-left-color: var(--accent-color);
            border-radius: 0 4px 4px 0;
            page-break-inside: avoid;
        }

        .agenda-header {
            background-color: var(--light-bg);
            padding: 10px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #eee;
        }

        .agenda-num {
            font-family: 'Arial', sans-serif;
            font-weight: 700;
            font-size: 16px;
            color: var(--primary-color);
            margin-right: 10px;
            min-width: 25px;
        }

        .agenda-title {
            font-family: 'Arial', sans-serif;
            font-weight: 600;
            font-size: 14px;
            color: #333;
            flex-grow: 1;
        }

        .agenda-time {
            font-family: 'Arial', sans-serif;
            font-weight: 600;
            font-size: 11px;
            color: var(--primary-color);
            background-color: #e8f5e9;
            padding: 4px 8px;
            border-radius: 4px;
            white-space: nowrap;
        }

        .agenda-body {
            padding: 12px 15px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .agenda-details {
            flex-grow: 1;
            padding-right: 15px;
        }

        .agenda-note-box {
            font-size: 13px;
            color: #444;
            line-height: 1.5;
            margin-bottom: 10px;
            font-style: italic;
        }

        .agenda-meta {
            font-family: 'Arial', sans-serif;
            font-size: 10px;
            text-transform: uppercase;
            color: #888;
            letter-spacing: 0.5px;
        }

        .agenda-meta span {
            color: var(--accent-color);
            font-weight: 700;
        }

        /* SECTION OBJECTIF */
        .agenda-objective-section {
            min-width: 100px;
            max-width: 130px;
            text-align: left;
        }

        .objective-label {
            font-family: 'Arial', sans-serif;
            font-size: 9px;
            text-transform: uppercase;
            color: #999;
            margin-bottom: 4px;
            letter-spacing: 1px;
            display: block;
        }

        .objective-box {
            font-family: 'Arial', sans-serif;
            font-size: 11px;
            font-weight: 600;
            padding: 6px 10px;
            border-radius: 4px;
            text-align: center;
            text-transform: uppercase;
        }
        
        .obj-decision { 
            background-color: #fce4ec;
            color: #880e4f; 
            border: 1px solid #f8bbd0;
        }
        .obj-info { 
            background-color: #e3f2fd;
            color: #0d47a1; 
            border: 1px solid #bbdefb;
        }
        .obj-discussion {
            background-color: #f3e5f5;
            color: #4a148c; 
            border: 1px solid #e1bee7;
        }

        /* SECTION SIGNATURE */
        .signature-section {
            margin-top: 50px;
            display: flex;
            justify-content: flex-end;
            page-break-inside: avoid;
        }

        .signature-block {
            width: 220px;
            text-align: center;
        }

        .signature-line {
            border-bottom: 1px solid #333;
            height: 1px;
            margin-bottom: 8px;
            width: 100%;
        }

        .signature-name {
            font-family: 'Arial', sans-serif;
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
            color: var(--text-color);
            margin-bottom: 2px;
        }

        .signature-title {
            font-size: 12px;
            font-style: italic;
            color: #555;
        }
    </style>
</head>
<body>
    <!-- EN-TÊTE AVEC LOGOS -->
    <header>
        <div class="logo-container">
            <img src="${logoCceUrl}" alt="Logo CCE" class="logo-img" onerror="this.style.display='none';">
            <img src="${logoValdorUrl}" alt="Logo Val-d'Or" class="logo-img" onerror="this.style.display='none';">
        </div>
        
        <h1>Ordre du Jour</h1>
        <h2>Comité Consultatif en Environnement (CCE)</h2>
        <div class="meeting-info">
            ${meeting.title}<br>
            ${formattedDate}, à <strong>${timeStr}</strong><br>
            ${meeting.location || 'Ville de Val-d\'Or'}
        </div>
    </header>

    <!-- LISTE DES ITEMS -->
    <div class="agenda-container">
        ${agendaItemsHtml}
    </div>

    <!-- SECTION SIGNATURE -->
    <div class="signature-section">
        <div class="signature-block">
            <div class="signature-line"></div>
            <div class="signature-name">Michaël Ross</div>
            <div class="signature-title">Coordonnateur en environnement<br>Secrétaire</div>
        </div>
    </div>
</body>
</html>
    `;

    // Create a temporary container that's visible but hidden from user view
    // Using opacity: 0 and pointer-events: none instead of off-screen positioning
    // This ensures html2canvas can properly measure and render the content
    const container = document.createElement('div');
    container.innerHTML = htmlContent;
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '816px'; // Legal width at 96 DPI
    container.style.minHeight = '1344px'; // Legal height at 96 DPI
    container.style.zIndex = '-9999';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.overflow = 'visible';
    document.body.appendChild(container);

    // Wait for images to load and DOM to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    // PDF options
    const opt = {
        margin: [0.5, 0.5, 0.5, 0.5] as [number, number, number, number], // inches
        filename: `ODJ-${meeting.date.split('T')[0]}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            width: 816,
            height: container.scrollHeight || 1344,
            windowWidth: 816,
            windowHeight: container.scrollHeight || 1344
        },
        jsPDF: {
            unit: 'in' as const,
            format: 'legal' as const,
            orientation: 'portrait' as const
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] as ('avoid-all' | 'css' | 'legacy')[] }
    };

    try {
        await html2pdf().set(opt).from(container).save();
    } finally {
        // Cleanup
        document.body.removeChild(container);
    }
};
