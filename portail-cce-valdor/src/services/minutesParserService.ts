import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';
import { generateNextResolutionNumber, generateNextCommentNumber } from '../utils/resolutionUtils';

interface ParsedPVSection {
    title: string;
    orderNumber: number;
    content: string;
    entryType: 'resolution' | 'comment' | 'none';
    minuteEntries: MinuteEntry[];
    minuteType?: 'resolution' | 'comment';
    minuteNumber?: string;
    decision?: string;
    proposer?: string;
    seconder?: string;
}

interface ParseOptions {
    meetingNumber?: number | string;
    autoNumber?: boolean;
}

/**
 * Parses the raw AI-generated PV draft into structured Agenda Items.
 * 
 * Format:
 * - `## N. Title` = section header
 * - `---` = section delimiter
 * - "Décision" or "Adoption" in header = resolution
 * - "Information" or "Consultation" = comment  
 * - "Ouverture", "Levée", "Varia" = none (but content still preserved)
 * - Embedded RÉSOLUTION/COMMENTAIRE headers create additional entries
 */
export const parseMinutesDraft = (
    draftContent: string,
    options: ParseOptions = {}
): { items: AgendaItem[], intro: string } => {
    const { meetingNumber, autoNumber = true } = options;

    console.log(`[Parser] Starting parse with meetingNumber: ${meetingNumber}, autoNumber: ${autoNumber}`);

    const rawSections = draftContent.split(/^---+$/m);
    const sections: ParsedPVSection[] = [];
    let intro = '';

    const sectionHeaderRegex = /^##\s*(\d+)?\.\s*(.+)$/im;
    const standaloneHeaderRegex = /^##\s+(.+)$/im;

    const usedResolutionNumbers: string[] = [];
    const usedCommentNumbers: string[] = [];

    for (const rawSection of rawSections) {
        const trimmed = rawSection.trim();
        if (!trimmed) continue;

        const numberedMatch = trimmed.match(sectionHeaderRegex);

        if (numberedMatch) {
            const orderNumber = numberedMatch[1] ? parseInt(numberedMatch[1], 10) : 0;
            const fullTitle = numberedMatch[2].trim();
            const headerLine = numberedMatch[0];
            let rawContent = trimmed.slice(trimmed.indexOf(headerLine) + headerLine.length).trim();

            // Determine primary entry type from title
            const primaryEntryType = determineEntryType(fullTitle);
            console.log(`[Parser] Section ${orderNumber}: "${fullTitle}" -> primaryType: ${primaryEntryType}`);

            // Parse for embedded RÉSOLUTION/COMMENTAIRE markers
            const embeddedEntries = parseEmbeddedEntries(rawContent, meetingNumber, autoNumber, usedResolutionNumbers, usedCommentNumbers);

            // Clean content for display (remove headers but keep text)
            const cleanedContent = cleanContent(rawContent);

            const section: ParsedPVSection = {
                title: `${orderNumber}. ${fullTitle}`,
                orderNumber,
                content: cleanedContent,
                entryType: primaryEntryType,
                minuteEntries: []
            };

            // If embedded entries found, use those
            if (embeddedEntries.length > 0) {
                section.minuteEntries = embeddedEntries;
                console.log(`[Parser] Found ${embeddedEntries.length} embedded entries in section ${orderNumber}`);
            }
            // Otherwise, create a single entry based on title type (if content exists)
            else if (cleanedContent) {
                if (primaryEntryType !== 'none') {
                    let entryNumber = '';
                    if (autoNumber && meetingNumber) {
                        if (primaryEntryType === 'resolution') {
                            entryNumber = generateNextResolutionNumber(meetingNumber, usedResolutionNumbers);
                            usedResolutionNumbers.push(entryNumber);
                        } else {
                            entryNumber = generateNextCommentNumber(meetingNumber, usedCommentNumbers);
                            usedCommentNumbers.push(entryNumber);
                        }
                        console.log(`[Parser] Auto-generated ${primaryEntryType} number: ${entryNumber}`);
                    }

                    section.minuteEntries.push({
                        type: primaryEntryType,
                        number: entryNumber,
                        content: cleanedContent
                    });
                } else {
                    // For 'none' type (Ouverture, Levée, etc.), still store content but without type/number
                    // User requested: "Point 1 Ouverture doit avoir son texte copié"
                    section.decision = cleanedContent;
                    console.log(`[Parser] Section ${orderNumber} is type 'none' - content preserved in decision field`);
                }
            }

            // Legacy field sync
            if (section.minuteEntries.length > 0) {
                section.minuteType = section.minuteEntries[0].type;
                section.minuteNumber = section.minuteEntries[0].number;
                section.decision = section.minuteEntries[0].content;
            }

            sections.push(section);
        } else {
            // Standalone header or intro text
            const standaloneMatch = trimmed.match(standaloneHeaderRegex);

            if (standaloneMatch) {
                const title = standaloneMatch[1].trim();
                const headerLine = standaloneMatch[0];
                let content = trimmed.slice(trimmed.indexOf(headerLine) + headerLine.length).trim();
                content = cleanContent(content);

                if (title.toUpperCase().includes('PRÉSENTS') ||
                    title.toUpperCase().includes('PROCÈS-VERBAL') ||
                    title.toUpperCase().includes('FIN DU')) {
                    if (!intro) {
                        intro = `## ${title}\n\n${content}`;
                    } else {
                        intro += `\n\n## ${title}\n\n${content}`;
                    }
                } else {
                    sections.push({
                        title: title,
                        orderNumber: 0,
                        content,
                        entryType: 'none',
                        minuteEntries: [],
                        decision: content
                    });
                }
            } else {
                if (!intro) {
                    intro = cleanContent(trimmed);
                } else if (trimmed) {
                    intro += '\n\n' + cleanContent(trimmed);
                }
            }
        }
    }

    console.log(`[Parser] Parsed ${sections.length} sections, intro length: ${intro.length}`);

    // Convert to AgendaItems
    const items = sections.map((sec, idx) => ({
        id: `draft-parsed-${Date.now()}-${idx}`,
        order: sec.orderNumber || idx,
        title: sec.title,
        duration: 10,
        presenter: '',
        objective: sec.entryType === 'resolution' ? 'Décision' :
            sec.entryType === 'comment' ? 'Information' : '',
        description: '',
        minuteEntries: sec.minuteEntries,
        minuteType: sec.minuteType,
        minuteNumber: sec.minuteNumber || (sec.minuteEntries[0]?.number || ''),
        decision: sec.decision || sec.content,
        proposer: sec.proposer || '',
        seconder: sec.seconder || ''
    }));

    return { items, intro };
};

/**
 * Parse embedded RÉSOLUTION and COMMENTAIRE entries within content.
 * Returns an array of MinuteEntry objects found in the text.
 */
function parseEmbeddedEntries(
    content: string,
    meetingNumber: number | string | undefined,
    autoNumber: boolean,
    usedResolutionNumbers: string[],
    usedCommentNumbers: string[]
): MinuteEntry[] {
    const entries: MinuteEntry[] = [];

    // Regex to find RÉSOLUTION XX-N or RÉSOLUTION (without number)
    const resolutionRegex = /(?:\*\*|__)?R[ÉE]SOLUTION(?:\*\*|__)?(?:[\s:]*(\d{2}-\d+))?[\s:.-]*/gi;
    // Regex to find COMMENTAIRE XX-A or COMMENTAIRE (without number)
    const commentaireRegex = /(?:\*\*|__)?COMMENTAIRE(?:\*\*|__)?(?:[\s:]*(\d{2}-[A-Z]))?[\s:.-]*/gi;

    let resMatches = [...content.matchAll(resolutionRegex)];
    let comMatches = [...content.matchAll(commentaireRegex)];

    // Collect all markers with their positions
    interface Marker {
        type: 'resolution' | 'comment';
        number: string;
        position: number;
        fullMatch: string;
    }

    const markers: Marker[] = [];

    for (const match of resMatches) {
        markers.push({
            type: 'resolution',
            number: match[1] || '',
            position: match.index || 0,
            fullMatch: match[0]
        });
    }

    for (const match of comMatches) {
        markers.push({
            type: 'comment',
            number: match[1] || '',
            position: match.index || 0,
            fullMatch: match[0]
        });
    }

    // Sort by position
    markers.sort((a, b) => a.position - b.position);

    if (markers.length === 0) {
        return [];
    }

    console.log(`[Parser] Found ${markers.length} embedded markers: ${markers.map(m => `${m.type}(${m.number})`).join(', ')}`);

    // Extract content for each marker
    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const startPos = marker.position + marker.fullMatch.length;
        const endPos = i < markers.length - 1 ? markers[i + 1].position : content.length;

        let entryContent = content.substring(startPos, endPos).trim();
        entryContent = cleanContent(entryContent);

        let entryNumber = marker.number;

        // Auto-number if no number found and meetingNumber is provided
        if (!entryNumber && autoNumber && meetingNumber) {
            if (marker.type === 'resolution') {
                entryNumber = generateNextResolutionNumber(meetingNumber, usedResolutionNumbers);
                usedResolutionNumbers.push(entryNumber);
            } else {
                entryNumber = generateNextCommentNumber(meetingNumber, usedCommentNumbers);
                usedCommentNumbers.push(entryNumber);
            }
            console.log(`[Parser] Auto-numbered embedded ${marker.type}: ${entryNumber}`);
        }

        entries.push({
            type: marker.type,
            number: entryNumber,
            content: entryContent
        });
    }

    return entries;
}

/**
 * Determine entry type from title keywords.
 */
function determineEntryType(title: string): 'resolution' | 'comment' | 'none' {
    const lower = title.toLowerCase();

    // Exceptions - never resolution or comment
    if (lower.includes('ouverture') ||
        lower.includes('levée') ||
        lower.includes('bienvenue') ||
        lower.includes('varia')) {
        return 'none';
    }

    // Decision keywords -> resolution
    if (lower.includes('décision') ||
        lower.includes('decision') ||
        lower.includes('adoption')) {
        return 'resolution';
    }

    // Information/Consultation -> comment
    if (lower.includes('information') || lower.includes('consultation')) {
        return 'comment';
    }

    // Default to comment for other content
    return 'comment';
}

/**
 * Clean content by removing headers and delimiters.
 */
function cleanContent(content: string): string {
    if (!content) return '';

    let cleaned = content;

    // Remove RÉSOLUTION headers
    cleaned = cleaned.replace(/(?:\*\*|__)?R[ÉE]SOLUTION(?:\*\*|__)?[\s:]*(\d{2}-\d+)?[\s:.-]*/gi, '');

    // Remove COMMENTAIRE headers
    cleaned = cleaned.replace(/(?:\*\*|__)?COMMENTAIRE(?:\*\*|__)?[\s:]*(\d{2}-[A-Z])?[\s:.-]*/gi, '');

    // Remove ## headers
    cleaned = cleaned.replace(/^##\s+.+$/gm, '');

    // Remove ---
    cleaned = cleaned.replace(/^---+$/gm, '');

    // Clean up extra newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}
