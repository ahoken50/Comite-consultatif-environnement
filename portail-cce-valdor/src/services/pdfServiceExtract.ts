
import { collection, addDoc, Timestamp, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Meeting, AgendaItem } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export interface MinuteExtract {
    id?: string;
    meetingId: string;
    agendaItemId: string;
    extractNumber: string;
    title: string;
    meetingDate: string;
    url: string;
    uploadedAt: string;
    uploadedBy: string;
}

/* ─── Text helpers (same as pdfServiceMinutes) ─── */

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

const formatDecisionHTML = (decision: string): string => {
    if (!decision) return '';
    const sanitized = sanitizeText(decision);
    const lines = sanitized.split('\n').filter(line => line.trim().length > 0);
    let html = '';
    let inResolvedList = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (/^CONSID[ÉE]RANT/i.test(trimmed)) {
            if (inResolvedList) { html += '</ul>'; inResolvedList = false; }
            const match = trimmed.match(/^(CONSID[ÉE]RANT)\s+(.*)/i);
            if (match) {
                html += `<div class="considerant-row"><div class="considerant-label">${match[1].toUpperCase()}</div><div class="considerant-text">${match[2]}</div></div>`;
            } else {
                html += `<div class="considerant-row"><div class="considerant-label">${trimmed.toUpperCase()}</div><div class="considerant-text"></div></div>`;
            }
        } else if (/^(ATTENDU|RECONNAISSANT)/i.test(trimmed)) {
            if (inResolvedList) { html += '</ul>'; inResolvedList = false; }
            const match = trimmed.match(/^((?:ATTENDU|RECONNAISSANT))\s+(.*)/i);
            if (match) {
                html += `<div class="considerant-row"><div class="considerant-label">${match[1].toUpperCase()}</div><div class="considerant-text">${match[2]}</div></div>`;
            } else {
                html += `<div class="considerant-row"><div class="considerant-label">${trimmed.toUpperCase()}</div><div class="considerant-text"></div></div>`;
            }
        } else if (/^IL EST R[ÉE]SOLU/i.test(trimmed)) {
            if (inResolvedList) { html += '</ul>'; inResolvedList = false; }
            const match = trimmed.match(/^(IL EST R[ÉE]SOLU(?:\s+QUE)?\s*:?)\s*(.*)/i);
            if (match) {
                html += `<div class="il-est-resolu">${match[1]}</div>`;
                if (match[2]) html += `<div class="resolution-text">${match[2]}</div>`;
            } else {
                html += `<div class="il-est-resolu">${trimmed}</div>`;
            }
        } else if (/^[-•]/.test(trimmed)) {
            if (!inResolvedList) { html += '<ul class="resolu-list">'; inResolvedList = true; }
            html += `<li>${trimmed.replace(/^[-•]\s*/, '')}</li>`;
        } else {
            if (inResolvedList) { html += '</ul>'; inResolvedList = false; }
            html += `<div class="il-est-resolu-container"><span class="resolution-text">${trimmed}</span></div>`;
        }
    }
    if (inResolvedList) html += '</ul>';
    return html;
};

const formatContentHTML = (text: string): string => {
    if (!text) return '';
    const sanitized = sanitizeText(text);
    const lines = sanitized.split('\n').filter(p => p.trim().length > 0);
    let html = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+\.\s+[A-ZÀ-Ÿ]/.test(trimmed)) {
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0 && colonIndex < 100) {
                const title = trimmed.substring(0, colonIndex + 1);
                const rest = trimmed.substring(colonIndex + 1).trim();
                html += `<div class="subsection-title">${title}</div>`;
                if (rest) html += `<p>${rest}</p>`;
            } else {
                html += `<div class="subsection-title">${trimmed}</div>`;
            }
        } else {
            html += `<p>${trimmed}</p>`;
        }
    }
    return html;
};

/* ─── Role labels ─── */

const getRoleLabelPDF = (role: string, name: string = ''): string => {
    const labels: Record<string, string> = {
        president: 'présidente',
        vice_president: 'vice-président',
        coordinator: 'coordonnateur',
        elected_official: name.includes('Sylvie') || name.includes('Hébert') ? 'conseillère responsable' : 'conseiller responsable',
        advisor: name.includes('Sylvie') || name.includes('Hébert') ? 'conseillère responsable' : 'conseiller responsable',
        guest: 'invité',
        member: 'membre',
        observer: 'observateur'
    };
    return labels[role.toLowerCase()] || labels[role] || role;
};

/* ─── HTML generation (PV-minutes layout, scoped to one agenda item) ─── */

const generateExtractHTML = (
    meeting: Meeting,
    item: AgendaItem,
    agendaOrderNumber: number,
    enrichedSignatures: any[] = []
): string => {
    // Date
    let dayName = '', dayOfMonth = '', monthName = '', year = '', timeStr = '';
    if (meeting.date) {
        const parsedDate = new Date(meeting.date);
        if (!isNaN(parsedDate.getTime())) {
            dayName = format(parsedDate, 'EEEE', { locale: fr });
            dayOfMonth = format(parsedDate, 'd', { locale: fr });
            monthName = format(parsedDate, 'MMMM', { locale: fr });
            year = format(parsedDate, 'yyyy', { locale: fr });
            timeStr = format(parsedDate, 'HH', { locale: fr }) + ' h';
        }
    }

    const meetingNum = meeting.meetingNumber
        ? String(meeting.meetingNumber)
        : (meeting.title.match(/(\d+)/)?.[1] || '01');

    // Attendees
    const memberRoles = ['member', 'Membre', 'president', 'Président(e)', 'vice_president', 'Vice-président(e)'];
    const isMemberRole = (role: string) => memberRoles.some(r => r.toLowerCase() === role.toLowerCase());
    const absents = meeting.attendees?.filter(a => !a.isPresent) || [];
    const presents = meeting.attendees?.filter(a => a.isPresent && isMemberRole(a.role)) || [];
    const othersPresent = meeting.attendees?.filter(a => a.isPresent && !isMemberRole(a.role)) || [];

    const formatName = (a: typeof presents[0]) => {
        const roleLabel = getRoleLabelPDF(a.role, a.name);
        return roleLabel ? `${a.name} (${roleLabel})` : a.name;
    };

    // Signature names
    const president = meeting.attendees?.find(a =>
        a.role?.toLowerCase().includes('président') && !a.role?.toLowerCase().includes('vice')
    );
    const secretary = meeting.attendees?.find(a => a.role?.toLowerCase().includes('secrétaire'));
    const presidentName = president ? president.name : 'Président(e)';
    const secretaryName = secretary ? secretary.name : 'Secrétaire';

    // Build agenda item content using same approach as pdfServiceMinutes
    const cleanTitle = item.title.replace(/^\d+[\.)\-]?\s*/, '');
    const titleWithNumber = `Sujet ${agendaOrderNumber} - ${cleanTitle}`;

    let commentRef = '';
    if (item.minuteEntries && item.minuteEntries.length > 0) {
        const comment = item.minuteEntries.find(e => e.type === 'comment');
        if (comment) commentRef = `<span class="comment-ref">COMMENTAIRE ${comment.number}</span>`;
    }

    let contentHTML = '';
    contentHTML += `
        <section class="content-section">
            <div class="section-title">
                ${titleWithNumber}
                ${commentRef}
            </div>
    `;

    if (item.minuteEntries && item.minuteEntries.length > 0) {
        const sortedEntries = [...item.minuteEntries].sort((a, b) => {
            const order: Record<string, number> = { comment: 0, note: 1, resolution: 2 };
            return (order[a.type] ?? 1) - (order[b.type] ?? 1);
        });

        for (const entry of sortedEntries) {
            if (entry.type === 'comment' || entry.type === 'note') {
                contentHTML += formatContentHTML(entry.content || '');
            } else if (entry.type === 'resolution') {
                contentHTML += `
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
        if (item.minuteType === 'resolution') {
            contentHTML += `
                <div class="resolution-block">
                    <span class="resolution-header">RÉSOLUTION ${item.minuteNumber || ''}</span>
                    <div class="resolution-content">
                        ${formatDecisionHTML(item.decision)}
                    </div>
                </div>
            `;
        } else {
            contentHTML += formatContentHTML(item.decision);
        }
    }

    // Also include item.description if present and not already covered
    if (item.description && (!item.minuteEntries || item.minuteEntries.length === 0) && !item.decision) {
        contentHTML += formatContentHTML(item.description);
    }

    contentHTML += '</section>';

    const meetingTypeStr = meeting.type === 'regular' ? 'ordinaire' : 'spéciale';

    // Full HTML document using original elegant fonts natively supported by window.print
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Extrait de PV - ${titleWithNumber}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background-color: #ffffff;
            font-family: 'Cormorant Garamond', serif;
            color: #2b2b2b;
            margin: 0;
            padding: 0;
        }

        .document-page {
            background-color: #ffffff;
            width: 816px;
            padding: 60px 80px;
            box-sizing: border-box;
        }

        header {
            text-align: center;
            margin-bottom: 50px;
            border-bottom: 3px double #1e4e3d;
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
            color: #1e4e3d;
            margin: 0 0 10px 0;
            font-weight: 600;
        }

        h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #c5a065;
            margin: 0 0 20px 0;
            font-weight: 500;
        }

        .meeting-info {
            font-size: 16px;
            font-style: italic;
            color: #555;
            line-height: 1.4;
        }

        .attendance {
            background-color: #f9fbfa;
            border-left: 4px solid #1e4e3d;
            padding: 15px 25px;
            margin-bottom: 40px;
            font-family: 'Montserrat', sans-serif;
            font-size: 13px;
        }

        .attendance h3 {
            color: #1e4e3d;
            margin: 0 0 8px 0;
            font-size: 12px;
            text-transform: uppercase;
        }

        .attendance-group {
            margin-bottom: 12px;
        }

        .content-section {
            margin-bottom: 35px;
        }

        .section-title {
            font-family: 'Montserrat', sans-serif;
            font-size: 16px;
            font-weight: 600;
            color: #1e4e3d;
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

        .resolution-block {
            background-color: #fdfcf8;
            border: 1px solid #e0e0e0;
            border-top: 3px solid #c5a065;
            padding: 20px 30px;
            margin: 25px 0;
            page-break-inside: avoid;
        }

        .resolution-header {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            font-weight: 700;
            color: #c5a065;
            margin-bottom: 15px;
            display: block;
        }

        .resolution-content {
            font-style: italic;
            color: #444;
        }

        .considerant-row {
            display: flex;
            margin-bottom: 8px;
            align-items: baseline;
        }

        .considerant-label {
            font-family: 'Montserrat', sans-serif;
            font-size: 12px;
            font-weight: 700;
            color: #1e4e3d;
            min-width: 110px;
            flex-shrink: 0;
        }

        .considerant-text {
            flex-grow: 1;
        }

        .il-est-resolu-container {
            margin-top: 15px;
            margin-bottom: 15px;
            display: block;
        }

        .il-est-resolu {
            font-weight: 700;
            color: #1e4e3d;
            font-family: 'Montserrat', sans-serif;
            margin-right: 5px;
        }

        .resolution-text {
            display: inline;
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
            color: #c5a065;
            position: absolute;
            left: 0;
        }

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
            color: #1e4e3d;
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

        .cert {
            margin-top: 40px;
            font-size: 12px;
            color: #888;
            text-align: center;
            border-top: 1px solid #eee;
            padding-top: 10px;
        }

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
            .resolution-block {
                /* Allowed to break in extracts */
            }
            .content-section {
                /* Allowed to break in extracts */
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
        <header>
            <div class="logos-container">
                <img src="/logo-valdor.png" alt="Logo Ville de Val-d'Or" class="logo-placeholder" onerror="this.style.display='none';">
                <img src="/logo-cce.png" alt="Logo CCE" class="logo-cce" onerror="this.style.display='none';">
            </div>

            <h1>Extrait de Procès-Verbal</h1>
            <h2>Comité Consultatif en Environnement (CCE)</h2>
            <div class="meeting-info">
                <strong>${meetingNum.replace(/^0/, '')}e assemblée ${meetingTypeStr}</strong><br>
                Tenue le ${dayName} ${dayOfMonth} ${monthName} ${year}, ${timeStr}<br>
                ${meeting.location || 'Salle de conférence des bureaux du Service permis, inspection et environnement'}
            </div>
        </header>

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
                <h3>Étaient absents</h3>
                <div>${absents.map(formatName).join(', ')}.</div>
            </div>
            ` : ''}
        </section>

        ${contentHTML}

        <section class="signatures">
            <div class="signature-block">
                <div class="signature-line">
                ${(() => {
                    const sig = enrichedSignatures.find(s => s.role === 'president' || s.role === 'elected_official' || s.role === 'vice_president');
                    if (sig) {
                        if (sig.signatureUrl) {
                            return `<img src="${sig.signatureUrl}" crossorigin="anonymous" onerror="this.remove()" style="max-width: 200px; max-height: 70px; object-fit: contain; margin-bottom: 2px;" />`;
                        }
                        const dt = sig.signedAt ? new Date(sig.signedAt) : new Date('invalid');
                        const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleDateString('fr-CA') : '';
                        return `<div class="digital-signature">Signé numériquement<br>${dateStr}</div>`;
                    }
                    return '';
                })()}
                </div>
                <div class="signature-name">${(() => {
                    const sig = enrichedSignatures.find(s => s.role === 'president' || s.role === 'elected_official' || s.role === 'vice_president');
                    return sig ? sig.signedByName : presidentName;
                })()}</div>
                <div class="signature-role">Président(e) / Élu(e) Responsable</div>
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
                <div class="signature-role">Secrétaire / Coordonnateur</div>
            </div>
        </section>

        <div class="cert">
            Copie certifiée conforme tirée du livre des délibérations du Comité Consultatif en Environnement de la Ville de Val-d'Or.
        </div>
    </div>
</body>
</html>`;
};


/* ─── Enriched signatures (same logic as pdfServiceMinutes) ─── */

const fetchEnrichedSignatures = async (meeting: Meeting): Promise<any[]> => {
    const enrichedSignatures: any[] = [];

    for (const sig of meeting.approvalSignatures || []) {
        let signatureUrl = '';
        if (sig.signedBy) {
            try {
                const memberDoc = await getDoc(doc(db, 'members', sig.signedBy));
                if (memberDoc.exists()) {
                    const memberData = memberDoc.data();
                    // Prevent Coordinator's signature image from stamping the President's signature field
                    const isCoordinatorSpoofingPresident = memberData.role === 'coordinator' && ['president', 'vice_president', 'elected_official'].includes(sig.role);
                    
                    if (!isCoordinatorSpoofingPresident && memberData.signatureUrl) {
                        signatureUrl = memberData.signatureUrl;
                    }
                }
            } catch (e) {
                console.error('Error fetching member signature:', e);
            }
        }
        enrichedSignatures.push({
            role: sig.role,
            signedByName: sig.signedByName,
            signedAt: sig.signedAt,
            signatureUrl
        });
    }

    try {
        const tokensRef = collection(db, 'meetings', meeting.id, 'approval_tokens');
        const tokensSnap = await getDocs(tokensRef);
        for (const d of tokensSnap.docs) {
            const t = d.data();
            if (t.status === 'approved') {
                let signatureUrl = '';
                if (t.userId) {
                    try {
                        const memberDoc2 = await getDoc(doc(db, 'members', t.userId));
                        if (memberDoc2.exists()) {
                            const memberData2 = memberDoc2.data();
                            const isCoordinatorSpoofingPresident = memberData2.role === 'coordinator' && ['president', 'vice_president', 'elected_official'].includes(t.role);
                            if (!isCoordinatorSpoofingPresident && memberData2.signatureUrl) {
                                signatureUrl = memberData2.signatureUrl;
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching token member signature:', e);
                    }
                } else if (t.email) {
                    const q = query(collection(db, 'members'), where('email', '==', t.email));
                    const memSnap = await getDocs(q);
                    if (!memSnap.empty && memSnap.docs[0].data().signatureUrl) {
                        signatureUrl = memSnap.docs[0].data().signatureUrl;
                    }
                }
                enrichedSignatures.push({
                    role: t.role,
                    signedByName: t.name || 'Signataire',
                    signedAt: t.approvedAt || t.updatedAt || new Date().toISOString(),
                    signatureUrl
                });
            }
        }
    } catch (e) {
        console.error('Error fetching approval tokens:', e);
    }

    return enrichedSignatures;
};

/* ─── Main export ─── */

export const generateExtractAndUpload = async (
    meeting: Meeting,
    item: AgendaItem,
    uploadedBy: string,
    agendaOrderNumber: number,
    prefetchedSignatures?: any[]  // Pass from caller to avoid refetching per item
): Promise<MinuteExtract> => {
    try {
        console.log(`📄 [Extract ${agendaOrderNumber}] Starting: "${item.title}"`);

        // 1. Check for existing extract
        const extractsRef = collection(db, 'extracts');
        const q = query(extractsRef, where('agendaItemId', '==', item.id));
        const snapshot = await getDocs(q);

        let existingExtract: MinuteExtract | null = null;
        if (!snapshot.empty) {
            existingExtract = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as MinuteExtract;
            console.log(`📄 [Extract ${agendaOrderNumber}] Existing extract found, will update.`);
        }

        const allResNumbers = item.minuteEntries?.filter(e => e.type === 'resolution' && e.number).map(e => e.number).join(', ');
        const extractNumber = `EXT-${agendaOrderNumber}`;
        const extractTitle = allResNumbers
            ? `${agendaOrderNumber}. ${item.title} (Résolutions: ${allResNumbers})`
            : `${agendaOrderNumber}. ${item.title}`;

        // 2. Get signatures (use prefetched if available)
        const enrichedSignatures = prefetchedSignatures || await fetchEnrichedSignatures(meeting);
        console.log(`📄 [Extract ${agendaOrderNumber}] Signatures: ${enrichedSignatures.length}`);

        // 3. We NO LONGER generate a PDF file here or upload it to Storage.
        // We only prepare the metadata to be saved in Firestore.
        // The actual PDF will be generated on-the-fly (`window.print`) when the user clicks "Consulter" in ExtractsPage.
        
        // 4. Save metadata to Firestore
        const extractData: Omit<MinuteExtract, 'id'> = {
            meetingId: meeting.id,
            agendaItemId: item.id,
            extractNumber,
            title: extractTitle,
            meetingDate: meeting.date,
            url: '', // No heavy PDF URL anymore, generated live on-demand
            uploadedAt: new Date().toISOString(),
            uploadedBy
        };

        let finalDocId = '';
        if (existingExtract && existingExtract.id) {
            const { doc: docFn, updateDoc } = await import('firebase/firestore');
            const docRef = docFn(db, 'extracts', existingExtract.id);
            await updateDoc(docRef, extractData as any);
            finalDocId = existingExtract.id;
        } else {
            const docRef = await addDoc(collection(db, 'extracts'), {
                ...extractData,
                timestamp: Timestamp.now()
            });
            finalDocId = docRef.id;
        }

        console.log(`✅ [Extract ${agendaOrderNumber}] Done! docId=${finalDocId}`);
        return { id: finalDocId, ...extractData };

    } catch (error: any) {
        console.error(`❌ [Extract ${agendaOrderNumber}] Error:`, error, '| message:', error?.message, '| string:', String(error));
        throw error;
    }
};

export { fetchEnrichedSignatures };

/**
 * On-Demand Native PDF Generation
 * Opens a popup with the Extrait HTML and triggers the browser's native window.print()
 * This guarantees 100% searchable vector text and perfect layout scaling.
 */
export const generateExtractPDF_WindowPrint = async (
    meeting: Meeting,
    item: AgendaItem,
    agendaOrderNumber: number,
    prefetchedSignatures?: any[]
): Promise<void> => {
    try {
        console.log(`📄 [Extract PDF] Generating Native Popup for "${item.title}"`);

        // Get signatures
        const enrichedSignatures = prefetchedSignatures || await fetchEnrichedSignatures(meeting);

        // Generate full HTML
        const htmlString = generateExtractHTML(meeting, item, agendaOrderNumber, enrichedSignatures);

        // Open print window
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert("Bloqueur de fenêtres contextuelles détecté. Veuillez l'autoriser pour imprimer le PDF.");
            throw new Error("Popup blocker prevented printing.");
        }

        printWindow.document.write(htmlString);
        printWindow.document.close();

        // Wait for fonts to load
        await new Promise(resolve => setTimeout(resolve, 1500));
        try {
            await Promise.race([
                // @ts-ignore
                printWindow.document.fonts?.ready,
                new Promise(resolve => setTimeout(resolve, 3000))
            ]);
        } catch { /* continue */ }

        // Trigger native print
        printWindow.focus();
        printWindow.print();

    } catch (error) {
        console.error("❌ Error generating extract window print:", error);
        throw error;
    }
};
