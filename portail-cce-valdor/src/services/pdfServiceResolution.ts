import type { Meeting, AgendaItem } from '../types/meeting.types';
import type { CouncilRecommendation } from '../types/recommendation.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

if (typeof window !== 'undefined' && (pdfjsLib as any).GlobalWorkerOptions) {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;
}

const renderPdfToImages = async (url: string): Promise<string[]> => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch PDF");
        const arrayBuffer = await response.arrayBuffer();

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        const images: string[] = [];

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (context) {
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: context, viewport }).promise;
                images.push(canvas.toDataURL('image/jpeg', 0.8));
            }
        }
        return images;
    } catch (err) {
        console.error("Error rendering PDF to images", err);
        return [];
    }
};

export interface PDFGenerationResult {
    success: boolean;
    error?: string;
}

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
 * Format notes with line breaks
 */
const formattedNotes = (text: string): string => {
    return text.replace(/\n/g, '<br>');
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
        // IL EST RÉSOLU / IL EST ÉGALEMENT RÉSOLU / IL EST PROPOSÉ
        else if (/^IL EST (?:ÉGALEMENT )?(?:R[ÉE]SOLU|PROPOS[ÉE])/i.test(trimmed)) {
            if (inResolvedList) {
                html += '</ul>';
                inResolvedList = false;
            }
            const match = trimmed.match(/^(IL EST (?:ÉGALEMENT )?(?:R[ÉE]SOLU|PROPOS[ÉE])(?:\s+PAR)?(?:\s+QUE)?\s*:?)\s*(.*)/i);
            if (match) {
                html += `<div class="il-est-resolu-container"><span class="il-est-resolu">${match[1]}</span> `;
                if (match[2]) html += `<span class="resolution-text">${match[2]}</span></div>`;
                else html += `</div>`;
            } else {
                html += `<div class="il-est-resolu-container"><span class="il-est-resolu">${trimmed}</span></div>`;
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
            html += `<div class="il-est-resolu-container"><span class="resolution-text">${trimmed}</span></div>`;
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
 * mode: 'official' (legal extract) or 'campaign' (presentation with arguments)
 */
export const generateResolutionHTML = (
    meeting: Meeting,
    itemOrRec: AgendaItem | CouncilRecommendation,
    type: 'agendaItem' | 'recommendation',
    mode: 'official' | 'campaign' = 'official',
    enrichedSignatures: any[] = [] // Added to accept signatures
): string => {

    // Extract Data
    const meetingDate = new Date(meeting.date);
    const dayName = format(meetingDate, 'EEEE', { locale: fr });
    const dayOfMonth = format(meetingDate, 'd', { locale: fr });
    const monthName = format(meetingDate, 'MMMM', { locale: fr });
    const year = format(meetingDate, 'yyyy', { locale: fr });

    let resolutionNumber = '';
    let title = '';
    let content = '';
    let notes = '';
    let attachments: { url: string, name: string, resolutionNumber?: string }[] | undefined = undefined;

    if (type === 'agendaItem') {
        const item = itemOrRec as AgendaItem;
        resolutionNumber = item.minuteNumber || item.minuteEntries?.find(e => e.type === 'resolution')?.number || '-----';
        title = item.title;
        // Prefer explicit resolution entry, fallback to decision, fallback to description
        const resolutionEntry = item.minuteEntries?.find(e => e.type === 'resolution');
        content = resolutionEntry ? resolutionEntry.content : (item.decision || item.description || '');

    } else {
        const rec = itemOrRec as CouncilRecommendation;
        resolutionNumber = rec.councilResolutionNumber || rec.sourceResolutionNumber || 'PROJET';
        title = rec.projectName || 'Recommandation';
        content = rec.description; // In Recommendation builder, description contains the full text

        // Remove the appended list of considerants (redundant in PDF as they are formatted in main text)
        const parts = content.split(/\n\s*CONSIDÉRANTS\s*[:;]?\s*\n/i);
        if (parts.length > 0) {
            content = parts[0].trim();
        }

        notes = rec.notes ? rec.notes.replace(/^\[?[cC]ommentaires?\]?\s*:\s*/gi, '')
                                     .replace(/\[EXTRAIT SPÉCIFIQUE RÉSERVÉ AU CONSEIL\]\s*/gi, '')
                                     .trim() : '';
        attachments = rec.attachments;
    }

    const location = meeting.location || 'Suite virtuelle / Hôtel de Ville';
    const time = meeting.date ? format(new Date(meeting.date), "HH 'h' mm", { locale: fr }) : 'Non spécifiée';

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

    // Format attendees for formal text block
    const presents = meeting.attendees?.filter(a => a.isPresent !== false) || [];
    const absents = meeting.attendees?.filter(a => a.isPresent === false) || [];

    const translateRole = (role?: string) => {
        if (!role) return '';
        const r = role.toLowerCase();
        if (r.includes('elected_official')) return 'conseillé(ère) responsable';
        if (r.includes('coordinator')) return 'coordonnateur(trice) en environnement';
        if (r.includes('observer')) return 'observateur(trice)';
        if (r.includes('vice_president') || r.includes('vice president')) return 'vice-président(e)';
        if (r.includes('president') && !r.includes('vice')) return 'président(e)';
        if (r.includes('member')) return 'membre';
        if (r.includes('secretary')) return 'secrétaire';
        return role;
    };

    const formatAttendee = (a: any) => `${a.name}${a.role ? `, ${translateRole(a.role)}` : ''}`;

    const regularPresentsStr = presents.filter(a => !a.role?.toLowerCase().includes('secrétaire') && !a.role?.toLowerCase().includes('conseil') && !a.role?.toLowerCase().includes('coordon') && !a.role?.toLowerCase().includes('elected_official') && !a.role?.toLowerCase().includes('coordinator')).map(formatAttendee).join(', ');
    const staffPresentsStr = presents.filter(a => a.role?.toLowerCase().includes('secrétaire') || a.role?.toLowerCase().includes('conseil') || a.role?.toLowerCase().includes('coordon') || a.role?.toLowerCase().includes('elected_official') || a.role?.toLowerCase().includes('coordinator')).map(formatAttendee).join(', ');
    const absentsStr = absents.map(formatAttendee).join(', ');

    const meetingTypeStr = meeting.type === 'regular' ? 'ordinaire' : 'spéciale';
    const meetingNumberStr = meeting.meetingNumber ? `${meeting.meetingNumber}e ` : '';

    let globalTitle = type === 'recommendation' ? (itemOrRec as CouncilRecommendation).projectName || 'Recommandation' : title;
    
    // Prefix title with agenda order number if available
    if (type === 'agendaItem') {
        const item = itemOrRec as AgendaItem;
        if (item.order) {
            globalTitle = `Sujet ${item.order} - ${globalTitle}`;
        }
    } else {
        // Try to find if recommendation has source item order (we will set this in builder)
        const rec = itemOrRec as any;
        if (rec.sourceAgendaItemOrder) {
            globalTitle = `Sujet ${rec.sourceAgendaItemOrder} - ${globalTitle}`;
        }
    }

    let resolutionBlocksHTML = '';

    if (type === 'recommendation' && (itemOrRec as CouncilRecommendation).resolutions && (itemOrRec as CouncilRecommendation).resolutions!.length > 0) {
        const rec = itemOrRec as CouncilRecommendation;
        resolutionBlocksHTML = rec.resolutions!.map(r => `
    <div class="resolution-box">
        <div class="res-header">
            <span>RÉSOLUTION ${r.number || '---'}</span>
        </div>
        ${r.title !== globalTitle ? `<div class="res-title-sub">${r.title || ''}</div>` : ''}
        <div class="content">
            ${formatResolutionHTML(r.text)}
        </div>
    </div>
        `).join('\n');
    } else {
        const item = itemOrRec as AgendaItem;
        const entries = item.minuteEntries || [];
        
        let blocks = '';
        
        // Always print the item description if present
        if (item.description) {
            blocks += `<div class="content" style="margin-bottom: 20px;">
                ${formatResolutionHTML(item.description)}
            </div>`;
        }

        if (entries.length > 0) {
            // Sort entries: comments first, then notes, then resolutions
            const sortedEntries = [...entries].sort((a, b) => {
                const order: Record<string, number> = { comment: 0, note: 1, resolution: 2 };
                return (order[a.type as string] ?? 1) - (order[b.type as string] ?? 1);
            });

            for (const e of sortedEntries) {
                if (e.type === 'comment' || e.type === 'note') {
                    blocks += `<div class="content" style="margin-bottom: 15px;">
                        ${formatResolutionHTML(e.content)}
                    </div>`;
                } else if (e.type === 'resolution') {
                    blocks += `
                    <div class="resolution-box" style="margin-bottom: 25px;">
                        <div class="res-header">
                            <span>RÉSOLUTION ${e.number || ''}</span>
                        </div>
                        <div class="content">
                            ${formatResolutionHTML(e.content)}
                        </div>
                    </div>`;
                }
            }
        } else {
            // Legacy format fallback for items without explicit entries
            if (item.decision) {
                blocks += `
                <div class="resolution-box" style="margin-bottom: 25px;">
                    <div class="res-header"><span>DÉCISION</span></div>
                    <div class="content">${formatResolutionHTML(item.decision)}</div>
                </div>`;
            }
        }
        
        resolutionBlocksHTML = blocks;
    }

    // HTML Template
    const docTitle = type === 'recommendation' ? `Extrait_Specifique_Conseil_${resolutionNumber.replace(/[, ]+/g, '_')}` : `Extrait_CCE_${resolutionNumber.replace(/[, ]+/g, '_')}`;
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>${docTitle}</title>
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
            margin-bottom: 20px;
        }
        .meeting-info {
            font-size: 16px;
            font-style: italic;
            color: #555;
            line-height: 1.4;
            margin-bottom: 20px;
            text-align: center;
        }
        .attendance {
            background-color: #f9fbfa;
            border-left: 4px solid var(--primary-color);
            padding: 15px 25px;
            margin-bottom: 20px;
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
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 5px;
            text-transform: uppercase;
        }
        .campaign-content {
            font-size: 15px;
            line-height: 1.6;
            white-space: pre-wrap;
            margin-bottom: 30px;
            text-align: justify;
        }

        .resolution-box {
            background-color: #fdfcf8;
            border: 1px solid #e0e0e0;
            border-top: 3px solid var(--accent-color);
            padding: 20px 30px;
            margin: 25px 0;
            page-break-inside: avoid;
        }
        .res-header {
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 10px;
            text-transform: uppercase;
        }
        .res-title-sub {
            color: var(--primary-color);
            font-size: 16px; 
            margin-top: 5px;
            font-weight: 600;
            margin-bottom: 15px;
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
        .il-est-resolu-container {
            margin-top: 15px;
            margin-bottom: 15px;
            display: block;
        }
        .il-est-resolu {
            font-weight: 700;
            color: var(--primary-color);
            font-family: 'Montserrat', sans-serif;
            margin-right: 5px;
            text-transform: uppercase;
        }
        .resolution-text {
            color: #444;
            display: inline;
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
            page-break-inside: avoid;
        }
        .sig-block {
            text-align: center;
            width: 40%;
        }
        .sig-line {
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
        <div style="display: flex; justify-content: center; align-items: center; gap: 30px; margin-bottom: 15px;">
            <img src="/logo-valdor.png" alt="Logo Ville Val-d'Or" style="height: 80px;" onerror="this.style.display='none'">
            <img src="/logo-cce.png" alt="Logo CCE" style="height: 80px;" onerror="this.style.display='none'">
        </div>
        <h1 style="font-family: 'Montserrat', sans-serif; font-size: 20px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--primary-color); text-align: center; margin: 15px 0;">
            Extrait de procès-verbal CCE
        </h1>
        <div class="meeting-info">
            <strong>${meetingNumberStr.replace(/^0/, '')}assemblée ${meetingTypeStr}</strong><br>
            Tenue le ${dayName} ${dayOfMonth} ${monthName} ${year}, ${time}<br>
            ${location}
        </div>
    </div>

    <section class="attendance">
        ${regularPresentsStr ? `
        <div class="attendance-group">
            <h3>Étaient présent(e)s</h3>
            <div>${regularPresentsStr}</div>
        </div>
        ` : ''}
        ${staffPresentsStr ? `
        <div class="attendance-group">
            <h3>Étaient aussi présent(e)s</h3>
            <div>${staffPresentsStr}</div>
        </div>
        ` : ''}
        ${absentsStr ? `
        <div class="attendance-group">
            <h3>Étaient absent(e)s</h3>
            <div>${absentsStr}</div>
        </div>
        ` : ''}
    </section>

    <hr style="border: none; border-bottom: 2px solid var(--primary-color, #1e4e3d); margin: 25px 0 15px 0;">

    <div style="font-weight: bold; font-size: 20px; line-height: 1.4; margin-bottom: 30px;">
        ${globalTitle}
    </div>

    ${notes ? `
    <div style="margin-bottom: 30px;">
        <div class="campaign-title">COMMENTAIRE</div>
        <div class="campaign-content">${formattedNotes(notes)}</div>
    </div>
    ` : ''}

    ${resolutionBlocksHTML}

    ${meeting.approvalStatus === 'approved' || meeting.approvalStatus === 'final' || meeting.status === 'completed' ? `
    <div class="signatures">
        <div class="sig-block">
            <div class="sig-line">
            ${(() => {
                const sig = enrichedSignatures.find(s => s.role === 'president' || s.role === 'elected_official' || s.role === 'vice_president');
                if (sig) {
                    if (sig.signatureUrl) {
                        return '<img src="' + sig.signatureUrl + '" crossorigin="anonymous" onerror="this.remove()" style="max-width: 200px; max-height: 70px; object-fit: contain; margin-bottom: 2px;" />';
                    }
                    const dt = sig.signedAt ? new Date(sig.signedAt) : new Date('invalid');
                    const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleDateString('fr-CA') : '';
                    return '<div class="digital-signature">Signé numériquement<br>' + dateStr + '</div>';
                }
                return '';
            })()}
            </div>
            <div class="sig-name">${(() => {
                const sig = enrichedSignatures.find(s => s.role === 'president' || s.role === 'elected_official' || s.role === 'vice_president');
                return sig ? sig.signedByName : presidentName;
            })()}</div>
            <div class="sig-role">Président(e) / Élu(e) Responsable</div>
        </div>
        <div class="sig-block">
            <div class="sig-line">
            ${(() => {
                const sig = enrichedSignatures.find(s => s.role === 'coordinator' || s.role === 'admin_bypass');
                if (sig) {
                    if (sig.signatureUrl) {
                        return '<img src="' + sig.signatureUrl + '" crossorigin="anonymous" onerror="this.remove()" style="max-width: 200px; max-height: 70px; object-fit: contain; margin-bottom: 2px;" />';
                    }
                    const dt = sig.signedAt ? new Date(sig.signedAt) : new Date('invalid');
                    const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleDateString('fr-CA') : '';
                    return '<div class="digital-signature">Validé administrativement<br>' + dateStr + '</div>';
                }
                return '';
            })()}
            </div>
            <div class="sig-name">${(() => {
                const sig = enrichedSignatures.find(s => s.role === 'coordinator' || s.role === 'admin_bypass');
                return sig ? sig.signedByName : secretaryName;
            })()}</div>
            <div class="sig-role">Secrétaire / Coordonnateur</div>
        </div>
    </div>
    ` : `
    <div style="text-align:center; font-style:italic; margin-top: 80px; color: #888;">
        (Signatures requises une fois le PV approuvé)
    </div>
    `}

    ${mode === 'official' ? `
    <div class="cert">
        Copie certifiée conforme tirée du livre des délibérations du Comité Consultatif en Environnement de la Ville de Val-d'Or.
    </div>
    ` : ''}

    ${(() => {
        let annexesHTML = '';
        if (attachments && attachments.length > 0) {
            annexesHTML += `
                <div style="page-break-before: always; margin-top: 40px;">
                    <h2 style="font-family: 'Montserrat', sans-serif; font-size: 18px; color: var(--primary-color); text-transform: uppercase;">ANNEXES / PIÈCES JOINTES</h2>
                    <ul style="margin-bottom: 40px;">
            `;
            const uniqueAttachments: any[] = [];
            const seenNames = new Set<string>();
            attachments.forEach((att) => {
                // Remove "(Page X)" suffix for base name display
                const baseName = att.name.replace(/\s*\(Page\s+\d+\)$/i, '');
                if (!seenNames.has(baseName)) {
                    seenNames.add(baseName);
                    uniqueAttachments.push({ ...att, baseName });
                }
            });
            uniqueAttachments.forEach((att, idx) => {
                const linkedTo = att.resolutionNumber ? ` (Lié à la résolution ${att.resolutionNumber})` : '';
                annexesHTML += `<li style="margin-bottom: 10px; font-size: 15px;"><strong>Annexe ${idx + 1} :</strong> ${att.baseName}${linkedTo}</li>`;
            });
            annexesHTML += `</ul>`;
            
            attachments.forEach((att, idx) => {
                const isImage = att.name.toLowerCase().match(/\.(jpeg|jpg|gif|png|webp)/) != null || att.url.toLowerCase().match(/\.(jpeg|jpg|gif|png|webp|alt=media)/) != null || att.url.startsWith('data:image/');
                if (isImage) {
                    annexesHTML += `
                        <div style="margin-top: 30px; text-align: center; page-break-inside: avoid;">
                            <div style="font-weight: bold; margin-bottom: 15px;">Annexe ${idx + 1} - ${att.name}</div>
                            <img src="${att.url}" style="max-width: 100%; max-height: 800px; border: 1px solid #ccc; padding: 5px;" alt="${att.name}" />
                        </div>
                    `;
                }
            });
            annexesHTML += `</div>`;
        }
        return annexesHTML;
    })()}

</body>
</html>`;

    return html;
};

/**
 * Legacy PDF Printing logic using the browser popup window
 */
export const generateResolutionPDF = async (
    meeting: Meeting,
    itemOrRec: AgendaItem | CouncilRecommendation,
    type: 'agendaItem' | 'recommendation',
    mode: 'official' | 'campaign' = 'official'
): Promise<PDFGenerationResult> => {
    
    let processedItemOrRec = { ...itemOrRec } as any;
    
    if (type === 'recommendation') {
        const rec = itemOrRec as CouncilRecommendation;
        if (rec.attachments && rec.attachments.length > 0) {
            const newAttachments: { url: string, name: string, resolutionNumber?: string }[] = [];
            
            for (const att of rec.attachments) {
                const isPdf = att.name.toLowerCase().endsWith('.pdf');
                
                if (isPdf) {
                    const images = await renderPdfToImages(att.url);
                    if (images.length > 0) {
                        images.forEach((imgDataUrl, idx) => {
                            newAttachments.push({
                                url: imgDataUrl,
                                name: `${att.name} (Page ${idx + 1})`,
                                resolutionNumber: att.resolutionNumber
                            });
                        });
                    } else {
                        newAttachments.push(att);
                    }
                } else {
                    newAttachments.push(att);
                }
            }
            processedItemOrRec.attachments = newAttachments;
        }
    }

    const { fetchEnrichedSignatures } = await import('./pdfServiceExtract');
    const enrichedSignatures = await fetchEnrichedSignatures(meeting);

    const html = generateResolutionHTML(meeting, processedItemOrRec, type, mode, enrichedSignatures);
    
    // Open print window
    const printWindow = window.open('', '_blank', 'width=816,height=1056');
    if (!printWindow) {
        return { success: false, error: 'Pop-up bloqué. Veuillez autoriser les pop-ups pour générer le PDF.' };
    }

    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for resources
    await new Promise(resolve => setTimeout(resolve, 2500));
    printWindow.print();
    return { success: true };
};

