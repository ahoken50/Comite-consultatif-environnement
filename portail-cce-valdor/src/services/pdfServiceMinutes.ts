import pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Initialize pdfMake with fonts
(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs || pdfFonts;

// Colors matching the reference document
const DARK_GREEN = '#1a5c37';
const DARK_BLUE = '#1a3c6e';

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

        // CONSIDÉRANT - with hanging indent
        if (/^CONSID[ÉE]RANT/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(CONSID[ÉE]RANT)\s*(.*)/i);
            if (match) {
                content.push({
                    columns: [
                        { text: match[1].toUpperCase(), width: 80, style: 'bodyText' },
                        { text: match[2] || '', width: '*', style: 'bodyText' }
                    ],
                    margin: [0, 3, 0, 3]
                });
            }
        }
        // IL EST RÉSOLU - bold
        else if (/^IL EST R[ÉE]SOLU/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(IL EST R[ÉE]SOLU\s*:?)\s*(.*)/i);
            if (match) {
                content.push({
                    columns: [
                        { text: match[1], width: 95, style: 'boldText' },
                        { text: match[2] || '', width: '*', style: 'boldText' }
                    ],
                    margin: [0, 8, 0, 3]
                });
            }
        }
        // ATTENDU - similar to CONSIDÉRANT
        else if (/^ATTENDU/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(ATTENDU)\s*(.*)/i);
            if (match) {
                content.push({
                    columns: [
                        { text: match[1].toUpperCase(), width: 60, style: 'bodyText' },
                        { text: match[2] || '', width: '*', style: 'bodyText' }
                    ],
                    margin: [0, 3, 0, 3]
                });
            }
        }
        // Regular text - with first line indent effect via margin
        else {
            content.push({
                text: trimmedLine,
                style: 'bodyText',
                margin: [0, 5, 0, 5]
            });
        }
    }

    return content;
};

/**
 * Get logo as base64 for PDF embedding
 */
const getLogoBase64 = async (): Promise<string | null> => {
    try {
        const response = await fetch('/logo-cce.png');
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Could not load logo:', e);
        return null;
    }
};

export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string) => {
    const meetingNum = extractMeetingNumber(meeting.title);
    let resolutionCounter = 1;
    let commentCounter = 0;

    // Load logo for PDF header
    const logoBase64 = await getLogoBase64();

    // Format date
    const dateObj = new Date(meeting.date);
    // Date components for formatting
    const dayName = format(dateObj, 'EEEE', { locale: fr });
    const dayOfMonth = format(dateObj, 'd', { locale: fr });
    const monthName = format(dateObj, 'MMMM', { locale: fr });
    const year = format(dateObj, 'yyyy', { locale: fr });
    const timeStr = format(dateObj, 'HH', { locale: fr }) + ' h ' + format(dateObj, 'mm', { locale: fr });
    const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const formattedDateLine = `${capitalizedDay} ${dayOfMonth} ${monthName} ${year}`;

    // Attendees processing
    const members = meeting.attendees?.filter(a => a.role !== 'Secrétaire' && a.role !== 'Conseiller responsable' && a.role !== 'Conseiller') || [];
    const others = meeting.attendees?.filter(a => a.role === 'Secrétaire' || a.role === 'Conseiller responsable' || a.role === 'Conseiller') || [];
    const absents = meeting.attendees?.filter(a => !a.isPresent) || [];
    const presents = members.filter(a => a.isPresent);
    const othersPresent = others.filter(a => a.isPresent);

    const formatName = (a: typeof members[0]) => {
        const roleSuffix = (a.role && a.role !== 'Membre') ? `, ${a.role.toLowerCase()}` : '';
        return `${a.name}${roleSuffix}`;
    };

    // Build document content
    const content: Content[] = [];

    // ============ HEADER ============
    // Logo and title side by side
    content.push({
        columns: [
            // Left side - logo
            logoBase64 ? {
                image: logoBase64,
                width: 70,
                height: 70,
                margin: [0, 0, 15, 0] as [number, number, number, number]
            } : {
                width: 80,
                stack: [
                    { text: 'CCE', style: 'logoText', alignment: 'center' as const },
                    { text: 'VAL-D\'OR', style: 'logoSubText', alignment: 'center' as const }
                ],
                margin: [0, 0, 15, 0] as [number, number, number, number]
            },
            // Right side - titles
            {
                width: '*',
                stack: [
                    {
                        text: 'COMITÉ CONSULTATIF EN ENVIRONNEMENT',
                        style: 'mainTitle',
                        alignment: 'center'
                    },
                    {
                        text: 'PROCÈS-VERBAL',
                        style: 'mainTitle',
                        alignment: 'center',
                        margin: [0, 5, 0, 0]
                    }
                ]
            }
        ],
        margin: [0, 0, 0, 15]
    });

    // Assembly title and date
    content.push({
        text: `ASSEMBLÉE ORDINAIRE CCE ${meetingNum.replace(/^0/, '')}`,
        style: 'assemblyTitle',
        alignment: 'center',
        margin: [0, 10, 0, 5]
    });

    content.push({
        text: formattedDateLine,
        style: 'dateTitle',
        alignment: 'center',
        decoration: 'underline',
        margin: [0, 0, 0, 20]
    });

    // Introductory paragraph
    const meetingTitle = `ASSEMBLÉE ORDINAIRE CCE ${meetingNum.replace(/^0/, '')}`;
    content.push({
        text: `PROCÈS-VERBAL de la ${meetingTitle} du Comité consultatif en environnement tenue le ${dayName} ${dayOfMonth} ${monthName} ${year}, ${timeStr} à ${meeting.location}.`,
        style: 'bodyText',
        margin: [0, 0, 0, 20]
    });

    // ============ ATTENDEES SECTION ============
    // This section is reserved for attendees - will show placeholder if no data
    content.push({
        text: '________________________________________________________________________',
        alignment: 'center',
        margin: [0, 10, 0, 10],
        color: '#cccccc'
    });

    // ÉTAIENT PRÉSENTS
    if (presents.length > 0) {
        content.push({
            columns: [
                { text: 'ÉTAIENT PRÉSENTS', style: 'attendeeLabel', width: 130 },
                { text: presents.map(formatName).join(', '), style: 'bodyText', width: '*' }
            ],
            margin: [0, 5, 0, 8]
        });
    } else {
        content.push({
            columns: [
                { text: 'ÉTAIENT PRÉSENTS', style: 'attendeeLabel', width: 130 },
                { text: '[Membres présents]', style: 'placeholder', width: '*' }
            ],
            margin: [0, 5, 0, 8]
        });
    }

    // ÉTAIENT AUSSI PRÉSENTS
    if (othersPresent.length > 0) {
        content.push({
            columns: [
                { text: 'ÉTAIENT AUSSI PRÉSENTS', style: 'attendeeLabel', width: 155 },
                { text: othersPresent.map(formatName).join(', '), style: 'bodyText', width: '*' }
            ],
            margin: [0, 0, 0, 8]
        });
    }

    // ÉTAIT ABSENT(E)
    if (absents.length > 0) {
        content.push({
            columns: [
                { text: 'ÉTAIT ABSENT(E)', style: 'attendeeLabel', width: 115 },
                { text: absents.map(a => a.name).join(', '), style: 'bodyText', width: '*' }
            ],
            margin: [0, 0, 0, 8]
        });
    }

    content.push({
        text: '________________________________________________________________________',
        alignment: 'center',
        margin: [0, 10, 0, 20],
        color: '#cccccc'
    });

    // ============ GLOBAL NOTES ============
    if (globalNotes) {
        content.push({
            text: sanitizeText(globalNotes),
            style: 'bodyText',
            margin: [0, 0, 0, 15]
        });
    }

    // ============ AGENDA ITEMS ============
    for (const item of meeting.agendaItems) {
        // Item title - bold and slightly larger
        content.push({
            text: item.title,
            style: 'itemTitle',
            margin: [0, 20, 0, 10]
        });

        // Check if we have minuteEntries (new format) or need to use legacy fields
        if (item.minuteEntries && item.minuteEntries.length > 0) {
            // NEW: Render all minute entries (multiple resolutions/comments)
            for (const entry of item.minuteEntries) {
                // Entry header (RÉSOLUTION/COMMENTAIRE)
                const label = entry.type === 'resolution' ? 'RÉSOLUTION' : 'COMMENTAIRE';
                content.push({
                    text: `${label} ${entry.number}`,
                    style: 'resolutionHeader',
                    margin: [0, 10, 0, 10]
                });

                // Entry content
                const entryContent = formatDecisionContent(entry.content || '');
                if (entryContent.length > 0) {
                    content.push(...entryContent);
                }

                // Proposer/Seconder for resolutions
                if (entry.type === 'resolution' && (entry.proposer || entry.seconder)) {
                    if (entry.proposer) {
                        content.push({
                            text: `Proposé par : ${entry.proposer}`,
                            style: 'bodyText',
                            margin: [0, 10, 0, 3]
                        });
                    }
                    if (entry.seconder) {
                        content.push({
                            text: `Appuyé par : ${entry.seconder}`,
                            style: 'bodyText',
                            margin: [0, 0, 0, 5]
                        });
                    }
                }
            }
        } else {
            // LEGACY: Use single minuteType/minuteNumber/decision fields
            // Determine minute number
            let minuteNumber = item.minuteNumber;
            if (!minuteNumber && item.minuteType) {
                const gen = generateMinuteNumber(meetingNum, item.minuteType, resolutionCounter, commentCounter);
                minuteNumber = gen.number;
                resolutionCounter = gen.newResCounter;
                commentCounter = gen.newComCounter;
            }

            // Resolution/Comment header
            if (minuteNumber) {
                const label = item.minuteType === 'resolution' ? 'RÉSOLUTION' :
                    item.minuteType === 'comment' ? 'COMMENTAIRE' : 'NOTE';
                content.push({
                    text: `${label} ${minuteNumber}`,
                    style: 'resolutionHeader',
                    margin: [0, 5, 0, 10]
                });
            }

            // Decision content
            const decisionContent = formatDecisionContent(item.decision || '');
            if (decisionContent.length > 0) {
                content.push(...decisionContent);
            }

            // Proposer/Seconder
            if (item.minuteType === 'resolution' && (item.proposer || item.seconder)) {
                if (item.proposer) {
                    content.push({
                        text: `Proposé par : ${item.proposer}`,
                        style: 'bodyText',
                        margin: [0, 10, 0, 3]
                    });
                }
                if (item.seconder) {
                    content.push({
                        text: `Appuyé par : ${item.seconder}`,
                        style: 'bodyText',
                        margin: [0, 0, 0, 5]
                    });
                }
            }
        }
    }

    // ============ SIGNATURES ============
    const president = meeting.attendees?.find(a => a.role?.toLowerCase().includes('président'));
    const secretary = meeting.attendees?.find(a => a.role?.toLowerCase().includes('secrétaire'));
    const presidentName = president ? president.name.toUpperCase() : 'PRÉSIDENT(E)';
    const secretaryName = secretary ? secretary.name.toUpperCase() : 'SECRÉTAIRE';

    content.push({
        columns: [
            {
                width: '*',
                stack: [
                    { text: '___________________________', margin: [0, 0, 0, 5] },
                    { text: `${presidentName}`, style: 'signatureName' },
                    { text: 'Président(e)', style: 'signatureRole' }
                ]
            },
            {
                width: '*',
                stack: [
                    { text: '___________________________', margin: [0, 0, 0, 5], alignment: 'right' },
                    { text: `${secretaryName}`, style: 'signatureName', alignment: 'right' },
                    { text: 'Secrétaire', style: 'signatureRole', alignment: 'right' }
                ]
            }
        ],
        margin: [0, 60, 0, 0]
    });

    // ============ DOCUMENT DEFINITION ============
    const docDefinition: TDocumentDefinitions = {
        pageSize: 'LEGAL', // 8.5 x 14 inches
        pageMargins: [72, 72, 72, 72], // 1 inch margins all around (72 points = 1 inch)
        content: content,
        styles: {
            mainTitle: {
                fontSize: 16,
                bold: true,
                color: DARK_GREEN
            },
            assemblyTitle: {
                fontSize: 14,
                bold: true,
                color: DARK_BLUE
            },
            dateTitle: {
                fontSize: 12,
                bold: true,
                color: DARK_BLUE
            },
            logoText: {
                fontSize: 20,
                bold: true,
                color: DARK_GREEN
            },
            logoSubText: {
                fontSize: 10,
                bold: true,
                color: DARK_GREEN
            },
            itemTitle: {
                fontSize: 13,
                bold: true
            },
            resolutionHeader: {
                fontSize: 12,
                bold: true
            },
            bodyText: {
                fontSize: 11,
                lineHeight: 1.3
            },
            boldText: {
                fontSize: 11,
                bold: true,
                lineHeight: 1.3
            },
            attendeeLabel: {
                fontSize: 11,
                bold: true
            },
            placeholder: {
                fontSize: 11,
                italics: true,
                color: '#888888'
            },
            signatureName: {
                fontSize: 11,
                bold: true
            },
            signatureRole: {
                fontSize: 10
            }
        },
        defaultStyle: {
            font: 'Roboto',
            fontSize: 11
        }
    };

    // Generate and download PDF
    const dateForFile = format(new Date(meeting.date), 'yyyy-MM-dd');
    pdfMake.createPdf(docDefinition).download(`PV-CCE-${meetingNum}-${dateForFile}.pdf`);
};
