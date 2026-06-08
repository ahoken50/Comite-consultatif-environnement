import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { fetchEnrichedSignatures } from './pdfServiceExtract';

export interface PDFGenerationResult {
    success: boolean;
    error?: string;
}

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
            // Split detection: CONSIDÉRANT (label) + text
            const match = trimmed.match(/^(CONSID[ÉE]RANT)\s+(.*)/i);
            if (match) {
                html += `<div class="considerant-row"><div class="considerant-label">${match[1].toUpperCase()}</div><div class="considerant-text">${match[2]}</div></div>`;
            } else {
                // Fallback
                html += `<div class="considerant-row"><div class="considerant-label">${trimmed.toUpperCase()}</div><div class="considerant-text"></div></div>`;
            }
        }
        // ATTENDU / RECONNAISSANT
        else if (/^(ATTENDU|RECONNAISSANT)/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^((?:ATTENDU|RECONNAISSANT))\s+(.*)/i);
            if (match) {
                html += `<div class="considerant-row"><div class="considerant-label">${match[1].toUpperCase()}</div><div class="considerant-text">${match[2]}</div></div>`;
            } else {
                html += `<div class="considerant-row"><div class="considerant-label">${trimmed.toUpperCase()}</div><div class="considerant-text"></div></div>`;
            }
        }
        // IL EST RÉSOLU / IL EST ÉGALEMENT RÉSOLU / IL EST PROPOSÉ
        else if (/^IL EST (?:ÉGALEMENT )?(?:R[ÉE]SOLU|PROPOS[ÉE])/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^(IL EST (?:ÉGALEMENT )?(?:R[ÉE]SOLU|PROPOS[ÉE])(?:\s+PAR)?(?:\s+QUE)?\s*:?)\s*(.*)/i);
            if (match) {
                html += `<div class="il-est-resolu">${match[1]}</div>`;
                if (match[2]) {
                    html += `<div class="resolution-text">${match[2]}</div>`;
                }
            } else {
                html += `<div class="il-est-resolu">${trimmed}</div>`;
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
 * @param members - Optional array of members from Firestore to enrich attendee roles
 */
const generateHTMLDocument = (meeting: Meeting, _globalNotes?: string, enrichedSignatures: any[] = [], members: any[] = []): string => {

    // Enrich attendee roles from the members collection (fixes stale 'Membre' roles in Firestore)
    const enrichedAttendees = (meeting.attendees || []).map(attendee => {
        const matchedMember = members.find(m => m.id === attendee.id || m.displayName === attendee.name);
        if (matchedMember && matchedMember.role) {
            return { ...attendee, role: matchedMember.role };
        }
        return attendee;
    });
    // Use enriched attendees for all subsequent processing
    const meetingAttendees = enrichedAttendees;
    const meetingNum = extractMeetingNumber(meeting.title);

    // Format date
    const dateObj = new Date(meeting.date);
    const dayName = format(dateObj, 'EEEE', { locale: fr });
    const dayOfMonth = format(dateObj, 'd', { locale: fr });
    const monthName = format(dateObj, 'MMMM', { locale: fr });
    const year = format(dateObj, 'yyyy', { locale: fr });
    const timeStr = format(dateObj, 'HH', { locale: fr }) + ' h';

    // Attendees processing - correct grouping:
    // "ÉTAIENT PRÉSENT(E)S" - members, president, vice_president, elected_official
    // "ÉTAIENT ABSENT(E)S" - anyone not checked as present
    // "ÉTAIENT AUSSI PRÉSENT(E)S" - coordinator, observer, guest (if present)

    // Normalize role for matching (handles both English keys and French labels)
    const normalizeRole = (role: string): string => {
        const r = role.toLowerCase().trim();
        if (r.includes('président') && r.includes('vice')) return 'vice_president';
        if (r.includes('président') || r === 'president') return 'president';
        if (r.includes('coordon') || r === 'coordinator') return 'coordinator';
        if (r.includes('élu') || r.includes('conseill') || r === 'elected_official' || r === 'advisor') return 'elected_official';
        if (r.includes('observat') || r === 'observer') return 'observer';
        if (r.includes('invité') || r === 'guest') return 'guest';
        if (r.includes('membre') || r === 'member') return 'member';
        return r;
    };

    // Roles that go in "ÉTAIENT PRÉSENT(E)S" (committee members)
    const memberCategoryRoles = new Set(['member', 'president', 'vice_president', 'elected_official']);
    const isMemberRole = (role: string) => memberCategoryRoles.has(normalizeRole(role));

    // Roles that should NOT appear in "ÉTAIENT ABSENT(E)S" — if not present, they simply don't show
    const excludeFromAbsents = new Set(['observer', 'coordinator', 'guest']);

    // Presents: members/president/VP/élu who are checked as present
    const presents = meetingAttendees.filter(a => a.isPresent && isMemberRole(a.role));

    // Others present: coordinator, observer, guest who are present
    const othersPresent = meetingAttendees.filter(a => a.isPresent && !isMemberRole(a.role));

    // Absents: Build from TWO sources:
    // 1. Attendees marked as !isPresent (but exclude observer/coordinator/guest)
    // 2. Active members from members collection who are NOT in the attendees list at all
    const attendeeIds = new Set(meetingAttendees.map(a => a.id));
    const attendeeNames = new Set(meetingAttendees.map(a => a.name.toLowerCase()));

    const absentsFromAttendees = meetingAttendees
        .filter(a => !a.isPresent && !excludeFromAbsents.has(normalizeRole(a.role)));

    const absentsFromMembers = members
        .filter(m => {
            if (!m.isActive) return false;
            // Already in attendees list? Skip (handled above)
            if (attendeeIds.has(m.id) || attendeeNames.has((m.displayName || '').toLowerCase())) return false;
            // Only include member-category roles in absents
            const role = normalizeRole(m.role || 'member');
            return isMemberRole(role) && !excludeFromAbsents.has(role);
        })
        .map(m => ({
            id: m.id,
            name: m.displayName || m.name || '',
            role: m.role || 'member',
            isPresent: false
        }));

    const absents = [...absentsFromAttendees, ...absentsFromMembers];

    // Role label mapping for PDF display
    const getRoleLabelPDF = (role: string, name: string = ''): string => {
        const normalized = normalizeRole(role);
        const labels: Record<string, string> = {
            president: 'présidente',
            vice_president: 'vice-président',
            coordinator: 'coordonnateur',
            elected_official: name.includes('Sylvie') || name.includes('Hébert') ? 'conseillère responsable' : 'conseiller responsable',
            guest: 'invité',
            member: 'membre',
            observer: 'observateur'
        };
        return labels[normalized] || role;
    };

    const formatName = (a: typeof presents[0]) => {
        const roleLabel = getRoleLabelPDF(a.role, a.name);
        return roleLabel ? `${a.name} (${roleLabel})` : a.name;
    };

    // Get president and secretary for signatures
    const president = meetingAttendees.find(a => {
        const nr = normalizeRole(a.role);
        return nr === 'president';
    });
    const secretary = meetingAttendees.find(a => a.role?.toLowerCase().includes('secrétaire'));
    const presidentName = president ? president.name : 'Président(e)';
    const secretaryName = secretary ? secretary.name : 'Secrétaire';

    // Build sections HTML with proper numbering
    let sectionsHTML = '';

    for (let i = 0; i < meeting.agendaItems.length; i++) {
        const item = meeting.agendaItems[i];
        const orderNum = i + 1; // 1-based numbering

        // Get comment reference if any
        let commentRef = '';
        if (item.minuteEntries && item.minuteEntries.length > 0) {
            const comment = item.minuteEntries.find(e => e.type === 'comment');
            if (comment) {
                commentRef = `<span class="comment-ref">COMMENTAIRE ${comment.number}</span>`;
            }
        }

        // Build title with order number - strip any existing number prefix from title
        const cleanTitle = item.title.replace(/^\d+[.)-]?\s*/, '');
        const titleWithNumber = `${orderNum}. ${cleanTitle}`;

        sectionsHTML += `
            <section class="content-section">
                <div class="section-title">
                    ${titleWithNumber}
                    ${commentRef}
                </div>
        `;

        // Render minute entries
        if (item.minuteEntries && item.minuteEntries.length > 0) {

            // Sort entries: comments first, then notes, then resolutions
            const sortedEntries = [...item.minuteEntries].sort((a, b) => {
                const order = { comment: 0, note: 1, resolution: 2 };
                return (order[a.type] ?? 1) - (order[b.type] ?? 1);
            });

            for (const entry of sortedEntries) {
                if (entry.type === 'comment' || entry.type === 'note') {
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

        .logos-container {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 30px;
            margin-bottom: 20px;
        }

        .logo-placeholder {
            width: 120px;
            height: auto;
        }

        .logo-cce {
            width: 100px;
            height: auto;
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

        .considerant-row {
            margin-bottom: 8px;
            overflow: hidden; /* Clear floats */
            page-break-inside: avoid;
            break-inside: avoid;
        }
        
        .considerant-label {
            font-family: 'Montserrat', sans-serif;
            font-size: 12px;
            font-weight: 700;
            color: var(--primary-color);
            float: left;
            width: 110px;
        }

        .considerant-text {
            margin-left: 110px;
            display: block;
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

        /* FILIGRANE BROUILLON */
        .watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 100px;
            color: rgba(200, 0, 0, 0.15);
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            text-transform: uppercase;
            white-space: nowrap;
            pointer-events: none;
            z-index: 1000;
            border: 5px solid rgba(200, 0, 0, 0.15);
            padding: 20px;
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
            height: 70px;
            margin-bottom: 10px;
            position: relative;
            display: flex;
            align-items: flex-end;
            justify-content: center;
        }

        .digital-signature {
            position: absolute;
            bottom: 5px;
            left: 0;
            right: 0;
            font-family: 'Courier New', monospace;
            font-size: 10px;
            color: var(--primary-color);
            background-color: rgba(255, 255, 255, 0.8);
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
                margin: 0.75in 0.5in 0.75in 2cm;
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
            
            .watermark {
                display: block !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .resolution-block {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .content-section {
                page-break-inside: auto;
                break-inside: auto;
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
        <!-- MARQUEUR BROUILLON SI NON APPROUVÉ -->
        ${(() => {
            const hasPresidentSig = enrichedSignatures.some(s => s.role === 'president' || s.role === 'elected_official' || s.role === 'vice_president');
            const hasSecretarySig = enrichedSignatures.some(s => s.role === 'coordinator' || s.role === 'admin_bypass');
            const isFullySigned = hasPresidentSig && hasSecretarySig;
            
            if (meeting.approvalStatus === 'approved' || meeting.approvalStatus === 'final' || isFullySigned) {
                return '';
            }
            return '<div class="watermark">BROUILLON<br>CONFIDENTIEL</div>';
        })()}

        <!-- EN-TÊTE -->
        <header>
            <div class="logos-container">
                <img src="/logo-valdor.png" alt="Logo Ville de Val-d'Or" class="logo-placeholder" onerror="this.style.display='none';">
                <img src="/logo-cce.png" alt="Logo CCE" class="logo-cce" onerror="this.style.display='none';">
            </div>
            
            <h1>${meeting.type === 'circular' ? 'Procès-Verbal Spécial' : 'Procès-Verbal'}</h1>
            <h2>Comité Consultatif en Environnement (CCE)</h2>
            <div class="meeting-info">
                ${meeting.type === 'circular'
                    ? `<strong>Résolution Écrite Adoptée Hors Séance</strong><br>Adoptée le ${dayName} ${dayOfMonth} ${monthName} ${year}`
                    : `<strong class="assembly-number">${meetingNum.replace(/^0/, '')}e assemblée ${meeting.type === 'special' ? 'extraordinaire' : 'ordinaire'}</strong><br>
                       Tenue le ${dayName} ${dayOfMonth} ${monthName} ${year}, ${timeStr}<br>
                       ${meeting.location || 'Salle de conférence des bureaux du Service permis, inspection et environnement'}`
                }
            </div>
        </header>

        <!-- PRÉSENCES -->
        ${meeting.type === 'circular' ? `
        <section class="attendance">
            <div class="attendance-group">
                <h3>MEMBRES ET APPROBATEURS REQUIS (UNANIMITÉ REQUISE)</h3>
                <div>${(() => {
                    const votingRoles = ['president', 'vice_president', 'member', 'elected_official'];
                    const votingMembers = members.filter(m => m.isActive && votingRoles.includes(m.role));
                    
                    const displayMembers = votingMembers.length > 0 ? votingMembers : (meeting.approvalSignatures || []).map(s => ({
                        id: s.signedBy,
                        displayName: s.signedByName,
                        role: s.role
                    }));

                    return displayMembers.map(m => `${m.displayName} (${getRoleLabelPDF(m.role, m.displayName)})`).join(', ');
                })()}.</div>
            </div>
        </section>
        ` : `
        <section class="attendance">
            ${presents.length > 0 ? `
            <div class="attendance-group">
                <h3>ÉTAIENT PRÉSENT(E)S</h3>
                <div>${presents.map(formatName).join(', ')}.</div>
            </div>
            ` : ''}
            ${absents.length > 0 ? `
            <div class="attendance-group">
                <h3>ÉTAIENT ABSENT(E)S</h3>
                <div>${absents.map(formatName).join(', ')}.</div>
            </div>
            ` : ''}
            ${othersPresent.length > 0 ? `
            <div class="attendance-group">
                <h3>ÉTAIENT AUSSI PRÉSENT(E)S</h3>
                <div>${othersPresent.map(formatName).join(', ')}.</div>
            </div>
            ` : ''}
        </section>
        `}

        <!-- CONTENU -->
        ${sectionsHTML}

        ${meeting.type === 'circular' ? `
        <!-- SIGNATURES CIRCULAIRES -->
        <h3 style="margin-top: 30px; border-bottom: 2px solid #1a365d; padding-bottom: 5px; font-size: 1.1em; color: #1a365d; page-break-inside: avoid; page-break-after: avoid;">CONSENTEMENTS ET SIGNATURES REQUIS (UNANIMITÉ)</h3>
        <div class="circular-signatures-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px; margin-bottom: 30px;">
            ${(() => {
                const votingRoles = ['president', 'vice_president', 'member', 'elected_official'];
                const votingMembers = members.filter(m => m.isActive && votingRoles.includes(m.role));
                
                const displayMembers = votingMembers.length > 0 ? votingMembers : (meeting.approvalSignatures || []).map(s => ({
                    id: s.signedBy,
                    displayName: s.signedByName,
                    role: s.role,
                    signatureUrl: undefined
                }));

                return displayMembers.map(m => {
                    const sig = enrichedSignatures.find(s => s.signedBy === m.id);
                    const hasSigned = !!sig;
                    
                    let sigContent = '<div style="color: #c53030; font-weight: bold; font-style: italic; font-size: 0.9em;">En attente de signature</div>';
                    let traceContent = '';
                    
                    if (hasSigned) {
                        if (sig.consentType === 'email') {
                            sigContent = `<div class="digital-signature" style="color: #2b6cb0; border: 1px dashed #2b6cb0; padding: 6px; border-radius: 4px; font-size: 0.8em; background-color: #ebf8ff; line-height: 1.3;">
                                <strong>Accord écrit consigné</strong><br>
                                le ${new Date(sig.signedAt).toLocaleDateString('fr-CA')}<br>
                                par la coordination
                            </div>`;
                            if (sig.emailConsentText) {
                                traceContent = `<div class="email-trace" style="margin-top: 8px; font-size: 0.7em; color: #4a5568; background: #f7fafc; padding: 6px; border: 1px solid #e2e8f0; border-radius: 4px; white-space: pre-wrap; font-family: monospace; max-height: 90px; overflow: hidden; text-overflow: ellipsis; text-align: left; line-height: 1.2;">
                                    <strong>Preuve de traçabilité :</strong><br>
                                    ${sig.emailConsentText}
                                </div>`;
                            }
                        } else {
                            if (sig.signatureUrl) {
                                sigContent = `<img src="${sig.signatureUrl}" crossorigin="anonymous" style="max-width: 180px; max-height: 55px; object-fit: contain; margin-bottom: 2px;" />`;
                            } else {
                                const dt = sig.signedAt ? new Date(sig.signedAt) : new Date();
                                const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleDateString('fr-CA') : '';
                                sigContent = `<div class="digital-signature" style="color: #2f855a; border: 1px solid #2f855a; padding: 6px; border-radius: 4px; font-size: 0.8em; background-color: #f0fff4; line-height: 1.3;">
                                    <strong>Signature Électronique</strong><br>
                                    le ${dateStr}
                                </div>`;
                            }
                        }
                    }

                    return `
                        <div class="signature-block" style="border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; background: #fff; page-break-inside: avoid; text-align: center;">
                            <div style="font-weight: bold; border-bottom: 1px solid #edf2f7; padding-bottom: 4px; margin-bottom: 8px; font-size: 0.9em; text-align: left;">
                                ${m.displayName}
                                <span style="font-size: 0.8em; font-weight: normal; color: #718096; display: block; margin-top: 2px;">
                                    ${getRoleLabelPDF(m.role, m.displayName).toUpperCase()}
                                </span>
                            </div>
                            <div class="signature-line" style="min-height: 60px; display: flex; align-items: center; justify-content: center;">
                                ${sigContent}
                            </div>
                            ${traceContent}
                        </div>
                    `;
                }).join('');
            })()}
        </div>
        ` : `
        <!-- SIGNATURES -->
        <section class="signatures">
            <div class="signature-block">
                <div class="signature-line">
                ${(() => {
            const isAccepted = meeting.approvalStatus === 'approved' || meeting.approvalStatus === 'final';
            if (!isAccepted) {
                return `<div class="digital-signature">Signature administrative</div>`;
            }
            const sig = enrichedSignatures.find(s => s.role === 'president' || s.role === 'vice_president');
            if (sig) {
                if (sig.signatureUrl) {
                    return `<img src="${sig.signatureUrl}" crossorigin="anonymous" style="max-width: 200px; max-height: 70px; object-fit: contain; margin-bottom: 2px;" />`;
                }
                const dt = sig.signedAt ? new Date(sig.signedAt) : new Date('invalid');
                const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleDateString('fr-CA') : '';
                return `<div class="digital-signature">Signé numériquement<br>${dateStr}</div>`;
            }
            return '';
        })()}
                </div>
                <div class="signature-name">${(() => {
            const sig = enrichedSignatures.find(s => s.role === 'president' || s.role === 'vice_president');
            return sig ? sig.signedByName : presidentName;
        })()}</div>
                <div class="signature-role">Présidente</div>
            </div>
            <div class="signature-block">
                <div class="signature-line">
                     ${(() => {
            const sig = enrichedSignatures.find(s => s.role === 'coordinator' || s.role === 'admin_bypass'); 
            if (sig) {
                if (sig.signatureUrl) {
                    return `<img src="${sig.signatureUrl}" crossorigin="anonymous" style="max-width: 200px; max-height: 70px; object-fit: contain; margin-bottom: 2px;" />`;
                }
                const dt = sig.signedAt ? new Date(sig.signedAt) : new Date('invalid');
                const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleDateString('fr-CA') : '';
                return `<div class="digital-signature">Validé administrativement<br>${dateStr}</div>`;
            }
            return '';
        })()}
                </div>
                <div class="signature-name">${(() => {
            const sig = enrichedSignatures.find(s => s.role === 'coordinator' || s.role === 'admin_bypass');
            return sig ? sig.signedByName : secretaryName;
        })()}</div>
                <div class="signature-role">Secrétaire</div>
            </div>
        </section>
        `}
    </div>
</body>
</html>`;
};

/**
 * Generate PDF from HTML using native browser print
 * This approach respects CSS page-break rules for resolution blocks
 */
export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string, windowRef?: Window | null, members: any[] = []): Promise<PDFGenerationResult> => {
    
    // 1. Prepare enriched signatures using the shared service to prevent logic conflicts
    const enrichedSignatures = await fetchEnrichedSignatures(meeting);
    
    const html = generateHTMLDocument(meeting, globalNotes, enrichedSignatures, members);

    // Use provided window or open a new one
    let printWindow = windowRef;
    if (!printWindow) {
        printWindow = window.open('', '_blank', 'width=816,height=1056');
    }

    if (!printWindow) {
        return { success: false, error: 'Veuillez autoriser les pop-ups pour générer le PDF.' };
    }

    // Write the HTML content
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for fonts and images to load
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Trigger print dialog - user can choose "Microsoft Print to PDF" or similar
    printWindow.print();

    // Optional: close the window after print (some browsers may not allow this)
    // printWindow.close();
    return { success: true };
};
