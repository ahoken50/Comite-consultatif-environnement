import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';
import { generateNextResolutionNumber, generateNextCommentNumber } from '../utils/resolutionUtils';

interface ParsedPVSection {
    title: string;
    orderNumber: number; // Extracted from "## N." format
    content: string;
    entryType: 'resolution' | 'comment' | 'none'; // Determined from header
    minuteEntries: MinuteEntry[];
    // Legacy fields
    minuteType?: 'resolution' | 'comment';
    minuteNumber?: string;
    decision?: string;
    proposer?: string;
    seconder?: string;
}

interface ParseOptions {
    meetingNumber?: number | string; // For auto-numbering (e.g., 10, 11, 12)
    autoNumber?: boolean; // Enable auto-numbering for empty numbers
}

/**
 * Parses the raw AI-generated PV draft into structured Agenda Items.
 * 
 * Format expected:
 * - `## N. Title` starts a new section (N is the order number)
 * - `---` ends the current section
 * - Text between header and `---` is the content
 * - "Décision" in header = resolution
 * - "Information" or "Consultation" in header = comment
 * - "Ouverture", "Levée", "Bienvenue" = neither (just text)
 * 
 * @param draftContent - The raw AI-generated text
 * @param options - Optional settings including meetingNumber for auto-numbering
 */
export const parseMinutesDraft = (
    draftContent: string,
    options: ParseOptions = {}
): { items: AgendaItem[], intro: string } => {
    const { meetingNumber, autoNumber = true } = options;

    // Split content by section delimiter (---)
    const rawSections = draftContent.split(/^---+$/m);

    const sections: ParsedPVSection[] = [];
    let intro = '';

    // Regex for section headers: ## N. Title or ## TITLE (like ÉTAIENT PRÉSENTS)
    const sectionHeaderRegex = /^##\s*(\d+)?\.\s*(.+)$/im;
    const standaloneHeaderRegex = /^##\s+(.+)$/im;

    // Track used numbers for auto-numbering
    const usedResolutionNumbers: string[] = [];
    const usedCommentNumbers: string[] = [];

    for (const rawSection of rawSections) {
        const trimmed = rawSection.trim();
        if (!trimmed) continue;

        // Check if this section has a numbered header (## N. Title)
        const numberedMatch = trimmed.match(sectionHeaderRegex);

        if (numberedMatch) {
            const orderNumber = numberedMatch[1] ? parseInt(numberedMatch[1], 10) : 0;
            const fullTitle = numberedMatch[2].trim();

            // Extract content (everything after the header line)
            const headerLine = numberedMatch[0];
            let content = trimmed.slice(trimmed.indexOf(headerLine) + headerLine.length).trim();

            // Clean content: remove any RÉSOLUTION XX-X or COMMENTAIRE XX-X headers
            content = cleanContent(content);

            // Determine entry type from title
            const entryType = determineEntryType(fullTitle);

            const section: ParsedPVSection = {
                title: `${orderNumber}. ${fullTitle}`,
                orderNumber,
                content,
                entryType,
                minuteEntries: []
            };

            // Create minute entry if applicable and content exists
            if (entryType !== 'none' && content) {
                let entryNumber = '';

                // Auto-number if meetingNumber is provided
                if (autoNumber && meetingNumber) {
                    if (entryType === 'resolution') {
                        entryNumber = generateNextResolutionNumber(meetingNumber, usedResolutionNumbers);
                        usedResolutionNumbers.push(entryNumber);
                    } else if (entryType === 'comment') {
                        entryNumber = generateNextCommentNumber(meetingNumber, usedCommentNumbers);
                        usedCommentNumbers.push(entryNumber);
                    }
                    console.log(`[Parser] Auto-generated ${entryType} number: ${entryNumber}`);
                }

                section.minuteEntries.push({
                    type: entryType,
                    number: entryNumber,
                    content: content
                });

                // Legacy fields
                section.minuteType = entryType;
                section.minuteNumber = entryNumber;
                section.decision = content;
            }

            sections.push(section);
        } else {
            // Check for standalone header (## ÉTAIENT PRÉSENTS, ## PROCÈS-VERBAL, etc.)
            const standaloneMatch = trimmed.match(standaloneHeaderRegex);

            if (standaloneMatch) {
                const title = standaloneMatch[1].trim();
                const headerLine = standaloneMatch[0];
                let content = trimmed.slice(trimmed.indexOf(headerLine) + headerLine.length).trim();

                // Clean content
                content = cleanContent(content);

                // These are typically intro sections (PROCÈS-VERBAL, ÉTAIENT PRÉSENTS)
                // or special sections without numbers
                if (title.toUpperCase().includes('PRÉSENTS') ||
                    title.toUpperCase().includes('PROCÈS-VERBAL') ||
                    title.toUpperCase().includes('FIN DU')) {
                    // Add to intro
                    if (!intro) {
                        intro = `## ${title}\n\n${content}`;
                    } else {
                        intro += `\n\n## ${title}\n\n${content}`;
                    }
                } else {
                    // Create a section without order number
                    sections.push({
                        title: title,
                        orderNumber: 0,
                        content,
                        entryType: 'none',
                        minuteEntries: []
                    });
                }
            } else {
                // No header found - this is intro text or orphan content
                if (!intro) {
                    intro = cleanContent(trimmed);
                } else if (trimmed) {
                    intro += '\n\n' + cleanContent(trimmed);
                }
            }
        }
    }

    // Convert sections to AgendaItems
    const items = sections.map((sec, idx) => {
        return {
            id: `draft-parsed-${Date.now()}-${idx}`,
            order: sec.orderNumber || idx,
            title: sec.title,
            duration: 10,
            presenter: '',
            objective: sec.entryType === 'resolution' ? 'Décision' :
                sec.entryType === 'comment' ? 'Information' : '',
            description: '',
            minuteEntries: sec.minuteEntries,
            // Legacy fields
            minuteType: sec.minuteType,
            minuteNumber: sec.minuteNumber || (sec.minuteEntries[0]?.number || ''),
            decision: sec.decision || sec.content,
            proposer: sec.proposer || '',
            seconder: sec.seconder || ''
        };
    });

    return { items, intro };
};

/**
 * Determines the entry type based on the section title/header.
 * - "Décision" -> resolution
 * - "Information" or "Consultation" -> comment
 * - "Ouverture", "Levée", "Bienvenue", "Varia" -> none
 */
function determineEntryType(title: string): 'resolution' | 'comment' | 'none' {
    const lowerTitle = title.toLowerCase();

    // Exceptions: these are never resolutions or comments
    if (lowerTitle.includes('ouverture') ||
        lowerTitle.includes('levée') ||
        lowerTitle.includes('bienvenue') ||
        lowerTitle.includes('varia') ||
        lowerTitle.includes('adoption') === false && lowerTitle.includes('ordre du jour')) {
        return 'none';
    }

    // Check for decision keywords
    if (lowerTitle.includes('décision') || lowerTitle.includes('decision')) {
        return 'resolution';
    }

    // Check for adoption (usually a resolution)
    if (lowerTitle.includes('adoption')) {
        return 'resolution';
    }

    // Check for information/consultation keywords
    if (lowerTitle.includes('information') || lowerTitle.includes('consultation')) {
        return 'comment';
    }

    // Default: if content exists but no keyword, treat as comment
    // This matches the user's request that most items are comments
    return 'comment';
}

/**
 * Cleans the content by removing:
 * - RÉSOLUTION XX-X headers
 * - COMMENTAIRE XX-X headers  
 * - Markdown delimiters (## and ---)
 * - Leading/trailing whitespace
 */
function cleanContent(content: string): string {
    if (!content) return '';

    let cleaned = content;

    // Remove RÉSOLUTION headers (with or without markdown bold)
    cleaned = cleaned.replace(/(?:\*\*|__)?R[ÉE]SOLUTION(?:\*\*|__)?[\s:]*(\d{2}-\d+)?[\s:.-]*/gi, '');

    // Remove COMMENTAIRE headers (with or without markdown bold)
    cleaned = cleaned.replace(/(?:\*\*|__)?COMMENTAIRE(?:\*\*|__)?[\s:]*(\d{2}-[A-Z])?[\s:.-]*/gi, '');

    // Remove standalone markdown headers (## Title)
    cleaned = cleaned.replace(/^##\s+.+$/gm, '');

    // Remove horizontal rules (---)
    cleaned = cleaned.replace(/^---+$/gm, '');

    // Remove "IL EST RÉSOLU" type headers (keep content after)
    // These are part of resolution text, not headers to strip

    // Clean up multiple consecutive newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim
    cleaned = cleaned.trim();

    return cleaned;
}
