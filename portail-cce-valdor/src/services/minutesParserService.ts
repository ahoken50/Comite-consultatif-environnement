import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';
import { generateNextResolutionNumber, generateNextCommentNumber } from '../utils/resolutionUtils';

interface ParsedPVSection {
    title: string;
    orderNumber: number;
    content: string;
    entryType: 'resolution' | 'comment' | 'none';
    minuteEntries: MinuteEntry[];
    minuteType?: 'resolution' | 'comment' | 'note';
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
 * - Embedded RÉSOLUTION/COMMENTAIRE/NOTE/DÉCISION headers create additional entries
 */
export const parseMinutesDraft = (
    draftContent: string,
    options: ParseOptions = {}
): { items: AgendaItem[], intro: string } => {
    const { meetingNumber, autoNumber = true } = options;

    console.log(`[Parser] Starting parse with meetingNumber: ${meetingNumber}, autoNumber: ${autoNumber}`);

    // Split on ## headers (lookahead keeps the header in the section)
    const rawSections = draftContent.split(/(?=^##\s+)/m);
    const sections: ParsedPVSection[] = [];
    let intro = '';

    const sectionHeaderRegex = /^##\s*(\d+)?\.\s*(.+)$/im;
    const standaloneHeaderRegex = /^##\s+(.+)$/im;

    const usedResolutionNumbers: string[] = [];
    const usedCommentNumbers: string[] = [];

    console.log(`[Parser] Split into ${rawSections.length} raw sections`);

    for (let sectionIndex = 0; sectionIndex < rawSections.length; sectionIndex++) {
        const rawSection = rawSections[sectionIndex];
        const trimmed = rawSection.trim();
        if (!trimmed) continue;

        console.log(`[Parser] Processing raw section ${sectionIndex}:`, trimmed.substring(0, 80) + '...');

        const numberedMatch = trimmed.match(sectionHeaderRegex);

        if (numberedMatch) {
            const orderNumber = numberedMatch[1] ? parseInt(numberedMatch[1], 10) : 0;
            const fullTitle = numberedMatch[2].trim();
            const headerLine = numberedMatch[0];
            const rawContent = trimmed.slice(trimmed.indexOf(headerLine) + headerLine.length).trim();

            // Determine primary entry type from title
            const primaryEntryType = determineEntryType(fullTitle);
            console.log(`[Parser] Section ${orderNumber}: "${fullTitle}" -> primaryType: ${primaryEntryType}`);

            // Parse for embedded RÉSOLUTION/COMMENTAIRE/NOTE/DÉCISION markers
            const embeddedEntries = parseEmbeddedEntries(rawContent, meetingNumber, autoNumber, usedResolutionNumbers, usedCommentNumbers);

            // Clean content for display (remove headers but keep text)
            const cleanedContent = cleanContent(rawContent);

            const section: ParsedPVSection = {
                title: `${orderNumber}. ${fullTitle}`,
                orderNumber,
                content: cleanedContent,
                entryType: primaryEntryType,
                minuteEntries: [],
                // ALWAYS set decision for content preservation (for Ouverture, etc.)
                decision: cleanedContent,
            };

            // If embedded entries found, use those
            if (embeddedEntries.entries.length > 0) {
                const newEntries: MinuteEntry[] = [];

                // Preface text (narrative before the first marker) becomes a NOTE
                if (embeddedEntries.preface) {
                    newEntries.push({
                        type: 'note',
                        number: '',
                        content: embeddedEntries.preface
                    });
                }

                newEntries.push(...embeddedEntries.entries);

                section.minuteEntries = newEntries;
                section.minuteType = newEntries[0].type;
                section.minuteNumber = newEntries[0].number;
                section.decision = newEntries[0].content;
                console.log(`[Parser] Found ${embeddedEntries.entries.length} embedded entries + ${embeddedEntries.preface ? 1 : 0} narrative note in section ${orderNumber}`);
            }
            // No markers at all: entire text becomes a NOTE
            else if (cleanedContent) {
                section.minuteEntries = [{
                    type: 'note',
                    number: '',
                    content: cleanedContent
                }];
                section.minuteType = 'note';
                section.minuteNumber = '';
                section.decision = cleanedContent;
                console.log(`[Parser] Section ${orderNumber} has no markers - saved as NOTE.`);
            }

            sections.push(section);
            console.log(`[Parser] Added section: "${section.title}" with ${section.minuteEntries.length} entries, decision length: ${section.decision?.length || 0}`);
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
 * Parse embedded RÉSOLUTION, COMMENTAIRE, NOTE and DÉCISION entries within content.
 * Returns an array of MinuteEntry objects found in the text.
 *
 * AI output formats handled:
 *   **RÉSOLUTION 16-02**
 *   **COMMENTAIRE 16-B :** texte...
 *   **DÉCISION :** texte...
 *   **NOTE :** texte...
 */
function parseEmbeddedEntries(
    content: string,
    meetingNumber: number | string | undefined,
    autoNumber: boolean,
    usedResolutionNumbers: string[],
    usedCommentNumbers: string[]
): { preface: string; entries: MinuteEntry[] } {

    // Single unified regex that catches all marker types in one pass.
    // Handles: **RÉSOLUTION 16-02**, **COMMENTAIRE 16-A :**, **DÉCISION :**, **NOTE :**
    // The key: ** can wrap the whole keyword+number, and number comes BEFORE closing **.
    const markerRegex = /(?:\*\*|__)?(?:R[ÉE]SOLUTION|COMMENTAIRE|D[ÉE]CISION|NOTE)\s*(?:\d{1,2}-(?:\d+|[A-Z]))?(?:\*\*|__)?[\s:.\-*]*/g;

    // Type detection tests (applied to each match string)
    const resolutionTest = /R[ÉE]SOLUTION/;
    const commentaireTest = /COMMENTAIRE/;
    const decisionTest = /D[ÉE]CISION/;
    // NOTE is the fallback

    const numberExtract = /(\d{1,2}-(?:\d+|[A-Z]))/;

    const allMatches = [...content.matchAll(markerRegex)];

    // Collect all markers with their positions
    interface Marker {
        type: 'resolution' | 'comment' | 'note';
        number: string;
        position: number;
        fullMatch: string;
    }

    const markers: Marker[] = [];

    for (const match of allMatches) {
        const text = match[0];
        let type: 'resolution' | 'comment' | 'note';

        if (resolutionTest.test(text)) {
            type = 'resolution';
        } else if (commentaireTest.test(text) || decisionTest.test(text)) {
            type = 'comment';
        } else {
            type = 'note';
        }

        const numMatch = text.match(numberExtract);
        const number = numMatch ? numMatch[1] : '';

        markers.push({
            type,
            number,
            position: match.index || 0,
            fullMatch: text
        });
    }

    // Sort by position
    markers.sort((a, b) => a.position - b.position);

    if (markers.length === 0) {
        return { preface: cleanContent(content), entries: [] };
    }

    console.log(`[Parser] Found ${markers.length} embedded markers: ${markers.map(m => `${m.type}(${m.number})`).join(', ')}`);

    // Extract the preface (discussion before the first marker)
    let preface = content.substring(0, markers[0].position).trim();
    preface = cleanContent(preface);

    // Extract content for each marker
    const entries: MinuteEntry[] = [];
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
            } else if (marker.type === 'comment') {
                entryNumber = generateNextCommentNumber(meetingNumber, usedCommentNumbers);
                usedCommentNumbers.push(entryNumber);
            }
            // Notes ne sont pas numérotées automatiquement
            console.log(`[Parser] Auto-numbered embedded ${marker.type}: ${entryNumber}`);
        }

        entries.push({
            type: marker.type,
            number: entryNumber,
            content: entryContent
        });
    }

    return { preface, entries };
}

/**
 * Determine entry type from title keywords.
 */
function determineEntryType(title: string): 'resolution' | 'comment' | 'none' {
    const lower = title.toLowerCase();

    // Exceptions - never resolution or comment (just informational text, no numbering)
    // Note: "Levée de l'assemblée" is a resolution, NOT an exception
    if (lower.includes('ouverture') ||
        lower.includes('bienvenue') ||
        lower.includes('varia')) {
        return 'none';
    }

    // "Levée de l'assemblée" is always a resolution
    if (lower.includes('levée')) {
        return 'resolution';
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
 * Clean content by removing marker headers and delimiters.
 * Does NOT strip narrative text — only removes the label lines themselves.
 */
function cleanContent(content: string): string {
    if (!content) return '';

    let cleaned = content;

    // Remove marker headers (RÉSOLUTION, COMMENTAIRE, NOTE, DÉCISION with optional ** and numbers)
    cleaned = cleaned.replace(/(?:\*\*|__)?(?:R[ÉE]SOLUTION|COMMENTAIRE|D[ÉE]CISION|NOTE)\s*(?:\d{1,2}-(?:\d+|[A-Z]))?(?:\*\*|__)?[\s:.\-*]*/g, '');

    // Remove ## headers
    cleaned = cleaned.replace(/^##\s+.+$/gm, '');

    // Remove ---
    cleaned = cleaned.replace(/^---+$/gm, '');

    // Clean up extra newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}
