import type { Meeting, AgendaItem } from '../types/meeting.types';
import type { CouncilRecommendation } from '../types/recommendation.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Sanitize text to remove special characters
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
 * Format content for HTML (Resolutions, Considerants, etc.)
 */
const formatResolutionHTML = (text: string): string => {
    if (!text) return '';

    const sanitized = sanitizeText(text);
    const lines = sanitized.split('\n').filter(line => line.trim().length > 0);
    let html = '';
    let inResolvedList = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // CONSIDÉRANT / ATTENDU / RECONNAISSANT
        if (/^(CONSID[ÉE]RANT|ATTENDU|RECONNAISSANT)/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^((?:CONSID[ÉE]RANT|ATTENDU|RECONNAISSANT)(?:\s+QUE)?)\s*(.*)/i);
            if (match) {
                html += `<div class="considerant"><span class="considerant-keyword">${match[1].toUpperCase()}</span> ${match[2] || ''}</div>`;
            } else {
                html += `<div class="considerant">${trimmed}</div>`;
            }
        }
        // IL EST RÉSOLU
        else if (/^IL EST R[ÉE]SOLU/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            // Capture "IL EST RÉSOLU" optionally followed by "QUE"
            const match = trimmed.match(/^(IL EST R[ÉE]SOLU(?:\s+QUE)?\s*:?)\s*(.*)/i);
            if (match) {
                html += `<div class="il-est-resolu">${match[1]}</div>`;
                if (match[2]) html += `<div class="resolution-text">${match[2]}</div>`;
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
            html += `<div class="resolution-text">${trimmed}</div>`;
        }
    }

    if (inResolvedList) {
        html += '</ul>';
    }

    return html;
};

/**
 * Generate PDF for a Single Resolution Extract
 * source: Can be an AgendaItem (from Minutes) or a CouncilRecommendation object
 */
/**
 * Generate PDF for a Single Resolution Extract
 * source: Can be an AgendaItem (from Minutes) or a CouncilRecommendation object
 * mode: 'official' (legal extract) or 'campaign' (presentation with arguments)
 */
export const generateResolutionPDF = async (
    meeting: Meeting,
    itemOrRec: AgendaItem | CouncilRecommendation,
    type: 'agendaItem' | 'recommendation',
    mode: 'official' | 'campaign' = 'official'
) => {

    // Extract Data
    const meetingDate = new Date(meeting.date);
    const dayName = format(meetingDate, 'EEEE', { locale: fr });
    const dayOfMonth = format(meetingDate, 'd', { locale: fr });
    const monthName = format(meetingDate, 'MMMM', { locale: fr });
    const year = format(meetingDate, 'yyyy', { locale: fr });

    let resolutionNumber = '';
    let title = '';
    let content = '';
    let proposer = '';
    let seconder = '';
    let notes = '';

    if (type === 'agendaItem') {
        const item = itemOrRec as AgendaItem;
        resolutionNumber = item.minuteNumber || item.minuteEntries?.find(e => e.type === 'resolution')?.number || '-----';
        title = item.title;
        // Prefer explicit resolution entry, fallback to decision, fallback to description
        const resolutionEntry = item.minuteEntries?.find(e => e.type === 'resolution');
        content = resolutionEntry ? resolutionEntry.content : (item.decision || item.description || '');
        proposer = item.proposer || resolutionEntry?.proposer || '';
        seconder = item.seconder || resolutionEntry?.seconder || '';

    } else {
        const rec = itemOrRec as CouncilRecommendation;
        resolutionNumber = rec.councilResolutionNumber || rec.sourceResolutionNumber || 'PROJET';
        title = rec.projectName || 'Recommandation';
        content = rec.description; // In Recommendation builder, description contains the full text
        notes = rec.notes || '';
    }

    // Signatures (President & Secretary only for Extracts)
    const president = meeting.attendees?.find(a =>
        (a.role?.toLowerCase().includes('président') && !a.role?.toLowerCase().includes('vice')) ||
        a.role === 'president'
    );
    const secretary = meeting.attendees?.find(a =>
        a.role?.toLowerCase().includes('secrétaire') || a.role === 'secretary'
    );

    const presidentName = president ? president.name : 'Président(e)';
    const secretaryName = secretary ? secretary.name : 'Secrétaire';

    // HTML Template
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Extrait de Résolution - CCE Val-d'Or</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary-color: #1e4e3d;
            --accent-color: #c5a065;
            --text-color: #2b2b2b;
        }
        body {
            font-family: 'Cormorant Garamond', serif;
            color: var(--text-color);
            padding: 40px 60px;
            max-width: 816px; /* Legal/Letter approx width */
            margin: 0 auto;
        }
        .header {
            text-align: center;
            border-bottom: 3px double var(--primary-color);
            padding-bottom: 20px;
            margin-bottom: 40px;
        }
        .logo {
            height: 80px;
            margin-bottom: 15px;
        }
        h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 20px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: var(--primary-color);
            margin: 5px 0;
        }
        h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            font-weight: 500;
            color: #555;
            margin-bottom: 15px;
            text-transform: uppercase;
        }
        .meta-info {
            font-size: 15px;
            font-style: italic;
            margin-bottom: 30px;
        }
        
        /* Campaign Mode Styles */
        .campaign-box {
            background-color: #f0f4f4;
            border: 1px solid #d0e0e0;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 4px;
        }
        .campaign-title {
            font-family: 'Montserrat', sans-serif;
            font-size: 16px;
            font-weight: 700;
            color: var(--primary-color);
            margin-bottom: 10px;
            text-transform: uppercase;
        }
        .campaign-content {
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-wrap;
        }

        .resolution-box {
            background-color: #fdfcf8;
            border: 1px solid #e0e0e0;
            border-left: 4px solid var(--accent-color);
            padding: 30px;
            margin: 20px 0;
        }
        .res-header {
            font-family: 'Montserrat', sans-serif;
            font-size: 16px;
            font-weight: 700;
            color: var(--accent-color);
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .res-title {
            color: var(--primary-color);
            font-size: 18px; 
            margin-top: 5px;
        }
        .content {
            font-size: 16px;
            line-height: 1.6;
            text-align: justify;
        }
        .considerant {
            margin-bottom: 12px;
            padding-left: 20px;
        }
        .considerant-keyword {
            font-family: 'Montserrat', sans-serif;
            font-size: 13px;
            font-weight: 600;
            color: var(--primary-color);
        }
        .il-est-resolu {
            margin-top: 25px;
            margin-bottom: 15px;
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            color: var(--primary-color);
            text-transform: uppercase;
        }
        .movers {
            margin-top: 30px;
            font-size: 14px;
            font-style: italic;
            color: #666;
            text-align: right;
        }
        .signatures {
            margin-top: 80px;
            display: flex;
            justify-content: space-around;
        }
        .sig-block {
            text-align: center;
            width: 40%;
        }
        .sig-line {
            border-bottom: 1px solid #000;
            margin-bottom: 10px;
            height: 40px;
        }
        .sig-name {
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
        }
        .cert {
            margin-top: 60px;
            font-size: 12px; 
            color: #888; 
            text-align: center;
            border-top: 1px solid #eee;
            padding-top: 10px;
        }
    </style>
</head>
<body>
    <div class="header">
        <img src="/logo-valdor.png" alt="Logo" class="logo" onerror="this.style.display='none'">
        <h1>${mode === 'official' ? 'Extrait du Procès-Verbal' : 'Présentation de Projet'}</h1>
        <h2>Comité Consultatif en Environnement</h2>
        <div class="meta-info">
            Séance du ${dayName} ${dayOfMonth} ${monthName} ${year}
        </div>
    </div>

    ${mode === 'campaign' && notes ? `
    <div class="campaign-box">
        <div class="campaign-title">Argumentaire / Contexte</div>
        <div class="campaign-content">${formattedNotes(notes)}</div>
    </div>
    ` : ''}

    <div class="resolution-box">
        <div class="res-header">
            <span>RÉSOLUTION ${resolutionNumber}</span>
        </div>
        <div class="res-title">${title}</div>
        
        <div class="content">
            ${formatResolutionHTML(content)}
        </div>

        ${(proposer || seconder) ? `
        <div class="movers">
            ${proposer ? `Proposé par : ${proposer}` : ''}<br>
            ${seconder ? `Appuyé par : ${seconder}` : ''}
        </div>
        ` : ''}
    </div>

    <div class="signatures">
        <div class="sig-block">
            <div class="sig-line"></div>
            <div class="sig-name">${presidentName}</div>
            <div>Président(e)</div>
        </div>
        <div class="sig-block">
            <div class="sig-line"></div>
            <div class="sig-name">${secretaryName}</div>
            <div>Secrétaire</div>
        </div>
    </div>

    ${mode === 'official' ? `
    <div class="cert">
        Copie certifiée conforme tirée du livre des délibérations du Comité Consultatif en Environnement de la Ville de Val-d'Or.
    </div>
    ` : ''}

</body>
</html>`;

    // Open print window
    const printWindow = window.open('', '_blank', 'width=816,height=1056');
    if (!printWindow) {
        alert('Pop-up bloqué.');
        return;
    }

    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for resources
    await new Promise(resolve => setTimeout(resolve, 1000));
    printWindow.print();
};

const formattedNotes = (text: string) => {
    return text.replace(/\n/g, '<br>');
};
