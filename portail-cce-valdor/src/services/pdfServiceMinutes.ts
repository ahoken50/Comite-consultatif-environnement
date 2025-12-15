import pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content, ContentTable, ContentColumns } from 'pdfmake/interfaces';
import type { Meeting } from '../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Initialize pdfMake with fonts
(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs || pdfFonts;

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
    if (!decision) return [{ text: 'Aucune note consignée.', style: 'normal', margin: [0, 0, 0, 5] }];

    const sanitized = sanitizeText(decision);
    const lines = sanitized.split('\n').filter(line => line.trim().length > 0);
    const content: Content[] = [];

    for (const line of lines) {
        const trimmedLine = line.trim();

        // CONSIDÉRANT - with hanging indent
        if (/^CONSID[ÉE]RANT/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(CONSID[ÉE]RANT)\s*(.*)/i);
            if (match) {
                const keyword = match[1].toUpperCase();
                const restOfText = match[2] || '';

                // Create a table for proper hanging indent
                const considerantTable: ContentTable = {
                    table: {
                        widths: [75, '*'],
                        body: [[
                            { text: keyword, style: 'normal', margin: [0, 0, 0, 0] },
                            { text: restOfText, style: 'normal', margin: [0, 0, 0, 0] }
                        ]]
                    },
                    layout: 'noBorders',
                    margin: [0, 2, 0, 2]
                };
                content.push(considerantTable);
            }
        }
        // IL EST RÉSOLU - bold with proper formatting
        else if (/^IL EST R[ÉE]SOLU/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(IL EST R[ÉE]SOLU\s*:?)\s*(.*)/i);
            if (match) {
                const keyword = match[1];
                const restOfText = match[2] || '';

                content.push({ text: '', margin: [0, 5, 0, 0] }); // Add spacing before

                const resoluTable: ContentTable = {
                    table: {
                        widths: [90, '*'],
                        body: [[
                            { text: keyword, style: 'bold', margin: [0, 0, 0, 0] },
                            { text: restOfText, style: 'bold', margin: [0, 0, 0, 0] }
                        ]]
                    },
                    layout: 'noBorders',
                    margin: [0, 2, 0, 2]
                };
                content.push(resoluTable);
            }
        }
        // ATTENDU - similar to CONSIDÉRANT
        else if (/^ATTENDU/i.test(trimmedLine)) {
            const match = trimmedLine.match(/^(ATTENDU)\s*(.*)/i);
            if (match) {
                const keyword = match[1].toUpperCase();
                const restOfText = match[2] || '';

                const attenduTable: ContentTable = {
                    table: {
                        widths: [55, '*'],
                        body: [[
                            { text: keyword, style: 'normal', margin: [0, 0, 0, 0] },
                            { text: restOfText, style: 'normal', margin: [0, 0, 0, 0] }
                        ]]
                    },
                    layout: 'noBorders',
                    margin: [0, 2, 0, 2]
                };
                content.push(attenduTable);
            }
        }
        // Regular text
        else {
            content.push({ text: trimmedLine, style: 'normal', margin: [0, 2, 0, 2] });
        }
    }

    return content;
};

export const generateMinutesPDF = async (meeting: Meeting, globalNotes?: string) => {
    const meetingNum = extractMeetingNumber(meeting.title);
    let resolutionCounter = 1;
    let commentCounter = 0;

    // Format date
    const dateStr = format(new Date(meeting.date), 'EEEE d MMMM yyyy', { locale: fr });
    const timeStr = format(new Date(meeting.date), 'HH:mm', { locale: fr }).replace(':', ' h ');
    const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

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

    // Header
    content.push({
        text: 'COMITÉ CONSULTATIF EN ENVIRONNEMENT',
        style: 'header',
        alignment: 'center',
        margin: [0, 0, 0, 5]
    });

    content.push({
        text: 'PROCÈS-VERBAL',
        style: 'title',
        alignment: 'center',
        margin: [0, 0, 0, 5]
    });

    content.push({
        text: meeting.title.toUpperCase(),
        style: 'subtitle',
        alignment: 'center',
        margin: [0, 0, 0, 3]
    });

    content.push({
        text: formattedDate,
        style: 'subtitle',
        alignment: 'center',
        margin: [0, 0, 0, 15]
    });

    // Introductory paragraph
    content.push({
        text: `PROCÈS-VERBAL de la ${meeting.title} du Comité consultatif en environnement tenue le ${dateStr}, ${timeStr} à ${meeting.location}.`,
        style: 'normal',
        margin: [0, 0, 0, 15]
    });

    // Attendees sections
    if (presents.length > 0) {
        const attendeeColumns: ContentColumns = {
            columns: [
                { text: 'ÉTAIENT PRÉSENTS', style: 'bold', width: 120 },
                { text: presents.map(formatName).join(', '), style: 'normal', width: '*' }
            ],
            margin: [0, 0, 0, 8]
        };
        content.push(attendeeColumns);
    }

    if (othersPresent.length > 0) {
        const otherColumns: ContentColumns = {
            columns: [
                { text: 'ÉTAIENT AUSSI PRÉSENTS', style: 'bold', width: 140 },
                { text: othersPresent.map(formatName).join(', '), style: 'normal', width: '*' }
            ],
            margin: [0, 0, 0, 8]
        };
        content.push(otherColumns);
    }

    if (absents.length > 0) {
        const absentColumns: ContentColumns = {
            columns: [
                { text: 'ÉTAIT ABSENT(E)', style: 'bold', width: 100 },
                { text: absents.map(a => a.name).join(', '), style: 'normal', width: '*' }
            ],
            margin: [0, 0, 0, 8]
        };
        content.push(absentColumns);
    }

    // Global notes
    if (globalNotes) {
        content.push({
            text: sanitizeText(globalNotes),
            style: 'normal',
            margin: [0, 10, 0, 15]
        });
    }

    // Agenda items
    for (const item of meeting.agendaItems) {
        // Item title
        content.push({
            text: item.title,
            style: 'itemTitle',
            margin: [0, 15, 0, 5]
        });

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
                margin: [0, 5, 0, 8]
            });
        }

        // Decision content
        const decisionContent = formatDecisionContent(item.decision || '');
        content.push(...decisionContent);

        // Proposer/Seconder
        if (item.minuteType === 'resolution' && (item.proposer || item.seconder)) {
            if (item.proposer) {
                content.push({
                    text: `Proposé par : ${item.proposer}`,
                    style: 'normal',
                    margin: [0, 8, 0, 2]
                });
            }
            if (item.seconder) {
                content.push({
                    text: `Appuyé par : ${item.seconder}`,
                    style: 'normal',
                    margin: [0, 0, 0, 5]
                });
            }
        }
    }

    // Signatures
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
                    { text: `${presidentName}, Président(e)`, style: 'normal' }
                ]
            },
            {
                width: '*',
                stack: [
                    { text: '___________________________', margin: [0, 0, 0, 5], alignment: 'right' },
                    { text: `${secretaryName}, Secrétaire`, style: 'normal', alignment: 'right' }
                ]
            }
        ],
        margin: [0, 50, 0, 0]
    });

    // Document definition
    const docDefinition: TDocumentDefinitions = {
        pageSize: 'LEGAL',
        pageMargins: [72, 72, 72, 72], // 1 inch margins
        content: content,
        styles: {
            header: {
                fontSize: 14,
                bold: true
            },
            title: {
                fontSize: 16,
                bold: true
            },
            subtitle: {
                fontSize: 12,
                bold: true
            },
            itemTitle: {
                fontSize: 11,
                bold: true
            },
            resolutionHeader: {
                fontSize: 11,
                bold: true
            },
            normal: {
                fontSize: 10
            },
            bold: {
                fontSize: 10,
                bold: true
            }
        },
        defaultStyle: {
            font: 'Roboto'
        }
    };

    // Generate and download PDF
    const dateForFile = format(new Date(meeting.date), 'yyyy-MM-dd');
    pdfMake.createPdf(docDefinition).download(`PV-CCE-${meetingNum}-${dateForFile}.pdf`);
};
