import pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Initialize pdfMake with fonts
(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs || pdfFonts;

// Premium color palette matching HTML template
const PRIMARY_COLOR = '#1e4e3d';   // Vert Val-d'Or élégant
const ACCENT_COLOR = '#c5a065';    // Or/Beige institutionnel
const TEXT_COLOR = '#2b2b2b';
const LIGHT_BG = '#f9fbfa';        // Light green for attendance section
const RESOLUTION_BG = '#fdfcf8';   // Light cream for resolution blocks

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
 * Generate minute number for items without one
 */
const generateMinuteNumber = (
    meetingNum: string,
    minuteType: 'resolution' | 'comment' | 'other' | undefined,
    resolutionCounter: number,
    commentCounter: number
): { number: string; newResCounter: number; newComCounter: number } => {
    if (minuteType === 'resolution') {
        const num = `${meetingNum}-${String(resolutionCounter).padStart(2, '0')}`;
        return { number: num, newResCounter: resolutionCounter + 1, newComCounter: commentCounter };
    } else if (minuteType === 'comment') {
        const letter = String.fromCharCode(65 + (commentCounter % 26));
        const num = `${meetingNum}-${letter}`;
        return { number: num, newResCounter: resolutionCounter, newComCounter: commentCounter + 1 };
    }
    return { number: '', newResCounter: resolutionCounter, newComCounter: commentCounter };
};

/**
 * Parse decision text and format CONSIDÉRANT/IL EST RÉSOLU clauses
 */
const formatDecisionContent = (decision: string): Content[] => {
    if (!decision) return [];

    const sanitized = sanitizeText(decision);
    const lines = sanitized.split('\n').filter(line => line.trim().length > 0);
    const content: Content[] = [];

    for (const line of lines) {
        const trimmedLine = line.trim();

        // CONSIDÉRANT - with styling
        if (/^CONSID[ÉE]RANT/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(CONSID[ÉE]RANT)\s*(.*)/i);
            if (match) {
                content.push({
                    text: [
                        { text: match[1].toUpperCase() + ' ', style: 'considerantKeyword' },
                        { text: match[2] || '', style: 'resolutionText' }
                    ],
                    margin: [20, 4, 0, 4]
                });
            }
        }
        // ATTENDU - similar styling
        else if (/^ATTENDU/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(ATTENDU)\s*(.*)/i);
            if (match) {
                content.push({
                    text: [
                        { text: match[1].toUpperCase() + ' ', style: 'considerantKeyword' },
                        { text: match[2] || '', style: 'resolutionText' }
                    ],
                    margin: [20, 4, 0, 4]
                });
            }
        }
        // IL EST RÉSOLU - bold heading
        else if (/^IL EST R[ÉE]SOLU/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(IL EST R[ÉE]SOLU\s*:?)\s*(.*)/i);
            if (match) {
                content.push({
                    text: match[1],
                    style: 'ilEstResolu',
                    margin: [0, 12, 0, 8]
                });
                if (match[2]) {
                    content.push({
                        text: match[2],
                        style: 'resolutionText',
                        margin: [0, 0, 0, 4]
                    });
                }
            }
        }
        // Bullet points (lines starting with -)
        else if (/^[-•]/.test(trimmedLine)) {
            content.push({
                text: [
                    { text: '• ', color: ACCENT_COLOR },
                    { text: trimmedLine.replace(/^[-•]\s*/, ''), style: 'resolutionText' }
                ],
                margin: [20, 4, 0, 4]
            });
        }
        // Regular text
        else {
            content.push({
                text: trimmedLine,
                style: 'resolutionText',
                margin: [0, 4, 0, 4]
            });
        }
    }

    return content;
};

/**
 * Format content text with paragraph detection (for comments)
 */
const formatContentText = (text: string): Content[] => {
    if (!text) return [];

    const sanitized = sanitizeText(text);
    const paragraphs = sanitized.split('\n\n').filter(p => p.trim().length > 0);
    const content: Content[] = [];

    for (const para of paragraphs) {
        // Check if this is a sub-section title (numbered)
        if (/^\d+\.\s+[A-Z]/.test(para.trim())) {
            content.push({
                text: para.trim(),
                style: 'subsectionTitle',
                margin: [0, 15, 0, 8]
            });
        } else {
            content.push({
                text: para.replace(/\n/g, ' ').trim(),
                style: 'bodyText',
                alignment: 'justify' as const,
                margin: [0, 0, 0, 12]
            });
        }
    }

    return content;
};

/**
 * Get logo as base64 for PDF embedding
 */
const getLogoBase64 = async (): Promise<string | null> => {
    const loadImage = async (url: string): Promise<string | null> => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`Logo fetch failed for ${url}: ${response.status}`);
                return null;
            }
            const blob = await response.blob();

            // Verify it's an image
            if (!blob.type.startsWith('image/')) {
                console.warn(`Invalid blob type for ${url}: ${blob.type}`);
                return null;
            }

            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = reader.result as string;
                    // Validate it's a proper dataURL
                    if (result && result.startsWith('data:image/')) {
                        resolve(result);
                    } else {
                        console.warn('Invalid dataURL format');
                        resolve(null);
                    }
                };
                reader.onerror = () => {
                    console.warn('FileReader error');
                    resolve(null);
                };
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn(`Error loading image ${url}:`, e);
            return null;
        }
    };

    // Try city logo first, then CCE logo
    const logos = ['/logo-valdor.png', '/logo-cce.png'];
    for (const logoUrl of logos) {
        const result = await loadImage(logoUrl);
        if (result) {
            console.log(`Logo loaded successfully: ${logoUrl}`);
            return result;
        }
    }

    console.warn('No logo could be loaded');
    return null;
};

/**
 * Create a resolution block with gold top border
 */
const createResolutionBlock = (
    number: string,
    type: 'resolution' | 'comment',
    decisionContent: Content[]
): Content => {
    const label = type === 'resolution' ? 'RÉSOLUTION' : 'COMMENTAIRE';

    return {
        table: {
            widths: ['*'],
            body: [
                // Gold top border row
                [{
                    text: '',
                    fillColor: ACCENT_COLOR,
                    border: [false, false, false, false] as [boolean, boolean, boolean, boolean],
                    margin: [0, 0, 0, 0]
                }],
                // Content row
                [{
                    stack: [
                        {
                            text: `${label} ${number}`,
                            style: 'resolutionHeader',
                            margin: [0, 0, 0, 12]
                        },
                        ...decisionContent
                    ],
                    fillColor: RESOLUTION_BG,
                    border: [true, false, true, true] as [boolean, boolean, boolean, boolean],
                    borderColor: ['#e0e0e0', '#e0e0e0', '#e0e0e0', '#e0e0e0'],
                    margin: [15, 15, 15, 15]
                }]
            ]
        },
        layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#e0e0e0',
            vLineColor: () => '#e0e0e0'
        },
        margin: [0, 20, 0, 20]
    };
};

export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string) => {
    const meetingNum = extractMeetingNumber(meeting.title);
    let resolutionCounter = 1;
    let commentCounter = 0;

    // Load logo for PDF header
    const logoBase64 = await getLogoBase64();

    // Format date
    const dateObj = new Date(meeting.date);
    const dayName = format(dateObj, 'EEEE', { locale: fr });
    const dayOfMonth = format(dateObj, 'd', { locale: fr });
    const monthName = format(dateObj, 'MMMM', { locale: fr });
    const year = format(dateObj, 'yyyy', { locale: fr });
    const timeStr = format(dateObj, 'HH', { locale: fr }) + ' h';

    // Attendees processing
    const members = meeting.attendees?.filter(a => a.role !== 'Secrétaire' && a.role !== 'Conseiller responsable' && a.role !== 'Conseiller' && a.role !== 'Invité') || [];
    const others = meeting.attendees?.filter(a => a.role === 'Secrétaire' || a.role === 'Conseiller responsable' || a.role === 'Conseiller' || a.role === 'Invité') || [];
    const absents = meeting.attendees?.filter(a => !a.isPresent) || [];
    const presents = members.filter(a => a.isPresent);
    const othersPresent = others.filter(a => a.isPresent);

    const formatName = (a: typeof members[0]) => {
        const roleLabel = a.role && a.role !== 'Membre' ? ` (${a.role})` : '';
        return `${a.name}${roleLabel}`;
    };

    // Build document content
    const content: Content[] = [];

    // ============ HEADER ============
    // Centered logo
    if (logoBase64) {
        content.push({
            image: logoBase64,
            width: 120,
            alignment: 'center',
            margin: [0, 0, 0, 20]
        });
    }

    // Title: PROCÈS-VERBAL
    content.push({
        text: 'PROCÈS-VERBAL',
        style: 'mainTitle',
        alignment: 'center',
        margin: [0, 0, 0, 8]
    });

    // Subtitle: Comité Consultatif en Environnement (CCE)
    content.push({
        text: 'Comité Consultatif en Environnement (CCE)',
        style: 'subtitle',
        alignment: 'center',
        margin: [0, 0, 0, 15]
    });

    // Meeting info in italics
    content.push({
        text: [
            `${meetingNum.replace(/^0/, '')}e assemblée ordinaire\n`,
            `Tenue le ${dayName} ${dayOfMonth} ${monthName} ${year}, ${timeStr}\n`,
            meeting.location || 'Salle de conférence du Service permis, inspection et environnement'
        ],
        style: 'meetingInfo',
        alignment: 'center',
        margin: [0, 0, 0, 20]
    });

    // Double line border under header
    content.push({
        canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 468, y2: 0, lineWidth: 1, lineColor: PRIMARY_COLOR },
            { type: 'line', x1: 0, y1: 4, x2: 468, y2: 4, lineWidth: 1, lineColor: PRIMARY_COLOR }
        ],
        alignment: 'center',
        margin: [0, 0, 0, 25]
    });

    // ============ ATTENDANCE SECTION ============
    // Build attendance rows for the table
    const attendanceRows: TableCell[][] = [];

    if (presents.length > 0 || true) {
        attendanceRows.push([
            { text: 'Étaient présents', style: 'attendanceTitle', border: [false, false, false, false] },
        ]);
        attendanceRows.push([
            {
                text: presents.length > 0 ? presents.map(formatName).join(', ') + '.' : '[Membres présents]',
                style: presents.length > 0 ? 'attendanceText' : 'placeholder',
                border: [false, false, false, false]
            }
        ]);
    }

    if (othersPresent.length > 0) {
        attendanceRows.push([
            { text: 'Étaient aussi présents', style: 'attendanceTitle', border: [false, false, false, false], margin: [0, 10, 0, 0] }
        ]);
        attendanceRows.push([
            { text: othersPresent.map(formatName).join(', ') + '.', style: 'attendanceText', border: [false, false, false, false] }
        ]);
    }

    if (absents.length > 0) {
        const absentLabel = absents.length === 1 ?
            (absents[0].name.includes('Mme') || !absents[0].name.includes('M.') ? 'Était absente' : 'Était absent') :
            'Étaient absents';
        attendanceRows.push([
            { text: absentLabel, style: 'attendanceTitle', border: [false, false, false, false], margin: [0, 10, 0, 0] }
        ]);
        attendanceRows.push([
            { text: absents.map(a => a.name).join(', ') + '.', style: 'attendanceText', border: [false, false, false, false] }
        ]);
    }

    // Attendance box with left border effect
    content.push({
        table: {
            widths: ['*'],
            body: [[{
                table: {
                    widths: ['*'],
                    body: attendanceRows
                },
                layout: 'noBorders',
                fillColor: LIGHT_BG,
                margin: [15, 12, 15, 12]
            }]]
        },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: (i: number) => i === 0 ? 4 : 0,
            vLineColor: () => PRIMARY_COLOR
        },
        margin: [0, 0, 0, 35]
    });

    // ============ GLOBAL NOTES ============
    if (globalNotes) {
        const notesContent = formatContentText(globalNotes);
        content.push(...notesContent);
    }

    // ============ AGENDA ITEMS ============
    for (const item of meeting.agendaItems) {
        // Get comment reference if any
        let commentRef = '';
        if (item.minuteEntries && item.minuteEntries.length > 0) {
            const comment = item.minuteEntries.find(e => e.type === 'comment');
            if (comment) {
                commentRef = `COMMENTAIRE ${comment.number}`;
            }
        }

        // Section title with optional comment reference
        content.push({
            table: {
                widths: ['*', 'auto'],
                body: [[
                    {
                        text: item.title,
                        style: 'sectionTitle',
                        border: [false, false, false, true] as [boolean, boolean, boolean, boolean],
                        borderColor: ['#ddd', '#ddd', '#ddd', '#ddd']
                    },
                    {
                        text: commentRef,
                        style: 'commentRef',
                        border: [false, false, false, true] as [boolean, boolean, boolean, boolean],
                        borderColor: ['#ddd', '#ddd', '#ddd', '#ddd'],
                        alignment: 'right'
                    }
                ]]
            },
            layout: {
                hLineWidth: (i: number) => i === 1 ? 1 : 0,
                vLineWidth: () => 0,
                hLineColor: () => '#ddd'
            },
            margin: [0, 25, 0, 15]
        });

        // Check if we have minuteEntries (new format) or need to use legacy fields
        if (item.minuteEntries && item.minuteEntries.length > 0) {
            for (const entry of item.minuteEntries) {
                if (entry.type === 'comment') {
                    // Comment content as regular paragraphs
                    const commentContent = formatContentText(entry.content || '');
                    content.push(...commentContent);
                } else if (entry.type === 'resolution') {
                    // Resolution block with gold border
                    const decisionContent = formatDecisionContent(entry.content || '');
                    content.push(createResolutionBlock(entry.number, 'resolution', decisionContent));
                }
            }
        } else {
            // LEGACY: Use single minuteType/minuteNumber/decision fields
            let minuteNumber = item.minuteNumber;
            if (!minuteNumber && item.minuteType) {
                const gen = generateMinuteNumber(meetingNum, item.minuteType, resolutionCounter, commentCounter);
                minuteNumber = gen.number;
                resolutionCounter = gen.newResCounter;
                commentCounter = gen.newComCounter;
            }

            if (minuteNumber && item.minuteType) {
                if (item.minuteType === 'resolution') {
                    const decisionContent = formatDecisionContent(item.decision || '');
                    content.push(createResolutionBlock(minuteNumber, 'resolution', decisionContent));
                } else if (item.minuteType === 'comment') {
                    const commentContent = formatContentText(item.decision || '');
                    content.push(...commentContent);
                }
            } else if (item.decision) {
                const decisionContent = formatContentText(item.decision);
                content.push(...decisionContent);
            }
        }
    }

    // ============ SIGNATURES ============
    const president = meeting.attendees?.find(a => a.role?.toLowerCase().includes('président') && !a.role?.toLowerCase().includes('vice'));
    const secretary = meeting.attendees?.find(a => a.role?.toLowerCase().includes('secrétaire'));
    const presidentName = president ? president.name : 'Président(e)';
    const secretaryName = secretary ? secretary.name : 'Secrétaire';

    content.push({
        columns: [
            {
                width: '45%',
                stack: [
                    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#000' }] },
                    { text: presidentName.toUpperCase(), style: 'signatureName', margin: [0, 8, 0, 0] },
                    { text: 'Président(e)', style: 'signatureRole' }
                ],
                alignment: 'center'
            },
            { width: '10%', text: '' },
            {
                width: '45%',
                stack: [
                    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#000' }] },
                    { text: secretaryName.toUpperCase(), style: 'signatureName', margin: [0, 8, 0, 0] },
                    { text: 'Secrétaire', style: 'signatureRole' }
                ],
                alignment: 'center'
            }
        ],
        margin: [0, 60, 0, 0]
    });

    // ============ DOCUMENT DEFINITION ============
    const docDefinition: TDocumentDefinitions = {
        pageSize: 'LEGAL', // 8.5 x 14 inches
        pageMargins: [60, 50, 60, 50],
        content: content,
        styles: {
            mainTitle: {
                fontSize: 22,
                bold: true,
                color: PRIMARY_COLOR,
                characterSpacing: 2
            },
            subtitle: {
                fontSize: 13,
                color: ACCENT_COLOR,
                characterSpacing: 1
            },
            meetingInfo: {
                fontSize: 12,
                italics: true,
                color: '#555',
                lineHeight: 1.4
            },
            sectionTitle: {
                fontSize: 14,
                bold: true,
                color: PRIMARY_COLOR
            },
            subsectionTitle: {
                fontSize: 12,
                bold: true,
                color: '#444',
                decoration: 'underline'
            },
            commentRef: {
                fontSize: 10,
                color: '#888'
            },
            attendanceTitle: {
                fontSize: 11,
                bold: true,
                color: PRIMARY_COLOR
            },
            attendanceText: {
                fontSize: 12,
                lineHeight: 1.3
            },
            resolutionHeader: {
                fontSize: 13,
                bold: true,
                color: ACCENT_COLOR
            },
            resolutionText: {
                fontSize: 11,
                italics: true,
                color: '#444',
                lineHeight: 1.3
            },
            considerantKeyword: {
                fontSize: 10,
                bold: true,
                color: PRIMARY_COLOR
            },
            ilEstResolu: {
                fontSize: 11,
                bold: true,
                color: PRIMARY_COLOR
            },
            bodyText: {
                fontSize: 12,
                lineHeight: 1.4,
                color: TEXT_COLOR
            },
            placeholder: {
                fontSize: 12,
                italics: true,
                color: '#888888'
            },
            signatureName: {
                fontSize: 11,
                bold: true
            },
            signatureRole: {
                fontSize: 10,
                color: '#555'
            }
        },
        defaultStyle: {
            font: 'Roboto',
            fontSize: 11,
            color: TEXT_COLOR
        }
    };

    // Generate and download PDF
    const dateForFile = format(new Date(meeting.date), 'yyyy-MM-dd');
    pdfMake.createPdf(docDefinition).download(`PV-CCE-${meetingNum}-${dateForFile}.pdf`);
};
