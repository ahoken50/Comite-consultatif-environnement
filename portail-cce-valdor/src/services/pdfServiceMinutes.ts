import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Sanitize text from Word documents to remove special characters
 */
const sanitizeText = (text: string): string => {
    if (!text) return '';

    return text
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00AD/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/[\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
        .replace(/  +/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .join('\n');
};

/**
 * Extract meeting number from title
 */
const extractMeetingNumber = (title: string): string => {
    const match = title.match(/(\d+)\s*[eè]/i);
    if (match) {
        return match[1].padStart(2, '0');
    }
    const numMatch = title.match(/(\d+)/);
    return numMatch ? numMatch[1].padStart(2, '0') : '01';
};

/**
 * Format CONSIDÉRANT and IL EST RÉSOLU content for HTML
 */
const formatDecisionHTML = (decision: string): string => {
    if (!decision) return '';

    const sanitized = sanitizeText(decision);
    const lines = sanitized.split('\n').filter(line => line.trim().length > 0);
    let html = '';
    let inResolvedList = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // CONSIDÉRANT
        if (/^CONSID[ÉE]RANT/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^(CONSID[ÉE]RANT)\s*(.*)/i);
            if (match) {
                html += `<span class="considerant"><strong>${match[1].toUpperCase()}</strong> ${match[2] || ''}</span>`;
            }
        }
        // ATTENDU
        else if (/^ATTENDU/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^(ATTENDU)\s*(.*)/i);
            if (match) {
                html += `<span class="considerant"><strong>${match[1].toUpperCase()}</strong> ${match[2] || ''}</span>`;
            }
        }
        // IL EST RÉSOLU
        else if (/^IL EST R[ÉE]SOLU/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^(IL EST R[ÉE]SOLU\s*:?)\s*(.*)/i);
            if (match) {
                html += `<span class="il-est-resolu">${match[1]}</span>`;
                if (match[2]) {
                    html += `<span class="resolution-text">${match[2]}</span>`;
                }
            }
        }
        // Bullet points
        else if (/^[-•]/.test(trimmed)) {
            if (!inResolvedList) {
                html += '<ul class="resolu-list">';
                inResolvedList = true;
            }
            html += `<li>${trimmed.replace(/^[-•]\s*/, '')}</li>`;
        }
        // Regular text
        else {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            html += `<span class="resolution-text">${trimmed}</span>`;
        }
    }

    if (inResolvedList) {
        html += '</ul>';
    }

    return html;
};

/**
 * Format content paragraphs for HTML
 * Each line break creates a new paragraph for proper separation
 */
const formatContentHTML = (text: string): string => {
    if (!text) return '';

    const sanitized = sanitizeText(text);
    // Split on single newlines to preserve paragraph structure
    const lines = sanitized.split('\n').filter(p => p.trim().length > 0);
    let html = '';
    let currentParagraph = '';

    for (const line of lines) {
        const trimmed = line.trim();

        // Check if subsection title (numbered like "1. Title:" or "2. Another Title:")
        if (/^\d+\.\s+[A-ZÀ-Ÿ]/.test(trimmed)) {
            // Flush any accumulated paragraph
            if (currentParagraph) {
                html += `<p>${currentParagraph}</p>`;
                currentParagraph = '';
            }
            // Find the colon for title separation
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0 && colonIndex < 100) {
                const title = trimmed.substring(0, colonIndex + 1);
                const rest = trimmed.substring(colonIndex + 1).trim();
                html += `<div class="subsection-title">${title}</div>`;
                if (rest) {
                    html += `<p>${rest}</p>`;
                }
            } else {
                html += `<div class="subsection-title">${trimmed}</div>`;
            }
        } else {
            // Regular paragraph - each line is a separate paragraph
            html += `<p>${trimmed}</p>`;
        }
    }

    // Flush any remaining paragraph
    if (currentParagraph) {
        html += `<p>${currentParagraph}</p>`;
    }

    return html;
};

/**
 * Generate the complete HTML document for the PV
 */
const generateHTMLDocument = (meeting: Meeting, _globalNotes?: string): string => {
    const meetingNum = extractMeetingNumber(meeting.title);

    // Format date
    const dateObj = new Date(meeting.date);
    const dayName = format(dateObj, 'EEEE', { locale: fr });
    const dayOfMonth = format(dateObj, 'd', { locale: fr });
    const monthName = format(dateObj, 'MMMM', { locale: fr });
    const year = format(dateObj, 'yyyy', { locale: fr });
    const timeStr = format(dateObj, 'HH', { locale: fr }) + ' h';

    // Attendees processing
    const members = meeting.attendees?.filter(a =>
        a.role !== 'Secrétaire' && a.role !== 'Conseiller responsable' &&
        a.role !== 'Conseiller' && a.role !== 'Invité'
    ) || [];
    const others = meeting.attendees?.filter(a =>
        a.role === 'Secrétaire' || a.role === 'Conseiller responsable' ||
        a.role === 'Conseiller' || a.role === 'Invité'
    ) || [];
    const absents = meeting.attendees?.filter(a => !a.isPresent) || [];
    const presents = members.filter(a => a.isPresent);
    const othersPresent = others.filter(a => a.isPresent);

    const formatName = (a: typeof members[0]) => {
        const roleLabel = a.role && a.role !== 'Membre' ? ` (${a.role})` : '';
        return `${a.name}${roleLabel}`;
    };

    // Get president and secretary for signatures
    const president = meeting.attendees?.find(a =>
        a.role?.toLowerCase().includes('président') && !a.role?.toLowerCase().includes('vice')
    );
    const secretary = meeting.attendees?.find(a => a.role?.toLowerCase().includes('secrétaire'));
    const presidentName = president ? president.name : 'Président(e)';
    const secretaryName = secretary ? secretary.name : 'Secrétaire';

    // Build sections HTML
    let sectionsHTML = '';

    for (const item of meeting.agendaItems) {
        // Get comment reference if any
        let commentRef = '';
        if (item.minuteEntries && item.minuteEntries.length > 0) {
            const comment = item.minuteEntries.find(e => e.type === 'comment');
            if (comment) {
                commentRef = `<span class="comment-ref">COMMENTAIRE ${comment.number}</span>`;
            }
        }

        sectionsHTML += `
            <section class="content-section">
                <div class="section-title">
                    ${item.title}
                    ${commentRef}
                </div>
        `;

        // Render minute entries
        if (item.minuteEntries && item.minuteEntries.length > 0) {
            for (const entry of item.minuteEntries) {
                if (entry.type === 'comment') {
                    sectionsHTML += formatContentHTML(entry.content || '');
                } else if (entry.type === 'resolution') {
                    sectionsHTML += `
                        <div class="resolution-block">
                            <span class="resolution-header">RÉSOLUTION ${entry.number}</span>
                            <div class="resolution-content">
                                ${formatDecisionHTML(entry.content || '')}
                            </div>
                        </div>
                    `;
                }
            }
        } else if (item.decision) {
            // Legacy format
            if (item.minuteType === 'resolution') {
                sectionsHTML += `
                    <div class="resolution-block">
                        <span class="resolution-header">RÉSOLUTION ${item.minuteNumber || ''}</span>
                        <div class="resolution-content">
                            ${formatDecisionHTML(item.decision)}
                        </div>
                    </div>
                `;
            } else {
                sectionsHTML += formatContentHTML(item.decision);
            }
        }

        sectionsHTML += '</section>';
    }

    // Complete HTML document
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Procès-Verbal CCE - Ville de Val-d'Or</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        /* CONFIGURATION GÉNÉRALE */
        :root {
            --primary-color: #1e4e3d;
            --accent-color: #c5a065;
            --text-color: #2b2b2b;
            --bg-color: #ffffff;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background-color: #ffffff;
            font-family: 'Cormorant Garamond', serif;
            color: var(--text-color);
            margin: 0;
            padding: 0;
        }

        /* PAGE */
        .document-page {
            background-color: var(--bg-color);
            width: 816px;
            padding: 60px 80px;
            box-sizing: border-box;
        }

        /* EN-TÊTE */
        header {
            text-align: center;
            margin-bottom: 50px;
            border-bottom: 3px double var(--primary-color);
            padding-bottom: 25px;
        }

        .logo-placeholder {
            width: 150px;
            height: auto;
            margin: 0 auto 20px auto;
            display: block;
        }

        h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 24px;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: var(--primary-color);
            margin: 0 0 10px 0;
            font-weight: 600;
        }

        h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--accent-color);
            margin: 0 0 20px 0;
            font-weight: 500;
        }

        .meeting-info {
            font-size: 16px;
            font-style: italic;
            color: #555;
            line-height: 1.4;
        }

        /* SECTION PRÉSENCES */
        .attendance {
            background-color: #f9fbfa;
            border-left: 4px solid var(--primary-color);
            padding: 15px 25px;
            margin-bottom: 40px;
            font-family: 'Montserrat', sans-serif;
            font-size: 13px;
        }

        .attendance h3 {
            color: var(--primary-color);
            margin: 0 0 8px 0;
            font-size: 12px;
            text-transform: uppercase;
        }

        .attendance-group {
            margin-bottom: 12px;
        }

        /* CORPS DU TEXTE */
        .content-section {
            margin-bottom: 35px;
        }

        .section-title {
            font-family: 'Montserrat', sans-serif;
            font-size: 16px;
            font-weight: 600;
            color: var(--primary-color);
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
            margin-top: 30px;
            margin-bottom: 15px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
        }

        .comment-ref {
            font-size: 11px;
            color: #888;
            font-weight: 400;
        }

        .subsection-title {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            font-weight: 600;
            color: #444;
            margin-top: 20px;
            margin-bottom: 10px;
        }

        p {
            font-size: 15px;
            line-height: 1.5;
            margin-bottom: 15px;
            text-align: justify;
        }

        /* BLOCS RÉSOLUTION */
        .resolution-block {
            background-color: #fdfcf8;
            border: 1px solid #e0e0e0;
            border-top: 3px solid var(--accent-color);
            padding: 20px 30px;
            margin: 25px 0;
            page-break-inside: avoid;
        }

        .resolution-header {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            font-weight: 700;
            color: var(--accent-color);
            margin-bottom: 15px;
            display: block;
        }

        .resolution-content {
            font-style: italic;
            color: #444;
        }

        .considerant {
            margin-bottom: 8px;
            display: block;
            text-indent: -20px;
            padding-left: 20px;
        }
        
        .considerant strong {
            font-family: 'Montserrat', sans-serif;
            font-size: 12px;
            color: var(--primary-color);
            margin-right: 5px;
        }

        .il-est-resolu {
            margin-top: 15px;
            margin-bottom: 10px;
            font-weight: 600;
            color: var(--primary-color);
            display: block;
            font-family: 'Montserrat', sans-serif;
        }

        .resolution-text {
            display: block;
            margin-bottom: 8px;
        }

        .resolu-list {
            list-style-type: none;
            padding-left: 0;
            margin: 10px 0;
        }

        .resolu-list li {
            position: relative;
            padding-left: 20px;
            margin-bottom: 10px;
        }

        .resolu-list li::before {
            content: "•";
            color: var(--accent-color);
            position: absolute;
            left: 0;
        }

        /* SIGNATURES */
        .signatures {
            margin-top: 60px;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
        }

        .signature-block {
            width: 40%;
            text-align: center;
        }

        .signature-line {
            border-bottom: 1px solid #000;
            height: 50px;
            margin-bottom: 10px;
        }

        .signature-name {
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
        }

        .signature-role {
            font-family: 'Montserrat', sans-serif;
            font-size: 11px;
            color: #555;
        }

        /* IMPRESSION */
        @media print {
            @page {
                size: legal portrait;
                margin: 0.75in 0.5in;
            }

            body {
                background-color: white;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .document-page {
                width: 100%;
                padding: 0;
                box-shadow: none;
            }

            .resolution-block {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }

            .content-section {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .section-title {
                page-break-after: avoid;
                break-after: avoid;
            }

            .signatures {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }

            .attendance {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            header {
                page-break-after: avoid;
            }

            p {
                orphans: 3;
                widows: 3;
            }
        }
    </style>
</head>
<body>
    <div class="document-page">
        <!-- EN-TÊTE -->
        <header>
            <img src="/logo-valdor.png" alt="Logo Ville de Val-d'Or" class="logo-placeholder" onerror="this.style.display='none';">
            
            <h1>Procès-Verbal</h1>
            <h2>Comité Consultatif en Environnement (CCE)</h2>
            <div class="meeting-info">
                ${meetingNum.replace(/^0/, '')}e assemblée ordinaire<br>
                Tenue le ${dayName} ${dayOfMonth} ${monthName} ${year}, ${timeStr}<br>
                ${meeting.location || 'Salle de conférence des bureaux du Service permis, inspection et environnement'}
            </div>
        </header>

        <!-- PRÉSENCES -->
        <section class="attendance">
            ${presents.length > 0 ? `
            <div class="attendance-group">
                <h3>Étaient présents</h3>
                <div>${presents.map(formatName).join(', ')}.</div>
            </div>
            ` : ''}
            ${othersPresent.length > 0 ? `
            <div class="attendance-group">
                <h3>Étaient aussi présents</h3>
                <div>${othersPresent.map(formatName).join(', ')}.</div>
            </div>
            ` : ''}
            ${absents.length > 0 ? `
            <div class="attendance-group">
                <h3>Était absent${absents.length > 1 ? 's' : ''}</h3>
                <div>${absents.map(a => a.name).join(', ')}.</div>
            </div>
            ` : ''}
        </section>

        <!-- CONTENU -->
        ${sectionsHTML}

        <!-- SIGNATURES -->
        <section class="signatures">
            <div class="signature-block">
                <div class="signature-line"></div>
                <div class="signature-name">${presidentName}</div>
                <div class="signature-role">Président(e)</div>
            </div>
            <div class="signature-block">
                <div class="signature-line"></div>
                <div class="signature-name">${secretaryName}</div>
                <div class="signature-role">Secrétaire</div>
            </div>
        </section>
    </div>
</body>
</html>`;
};

/**
 * Generate PDF from HTML using native browser print
 * This approach respects CSS page-break rules for resolution blocks
 */
export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string) => {
    const html = generateHTMLDocument(meeting, globalNotes);

    // Open a new window for printing
    const printWindow = window.open('', '_blank', 'width=816,height=1056');

    if (!printWindow) {
        alert('Veuillez autoriser les pop-ups pour générer le PDF.');
        return;
    }

    // Write the HTML content
    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for fonts and images to load
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Trigger print dialog - user can choose "Microsoft Print to PDF" or similar
    printWindow.print();

    // Optional: close the window after print (some browsers may not allow this)
    // printWindow.close();
};
