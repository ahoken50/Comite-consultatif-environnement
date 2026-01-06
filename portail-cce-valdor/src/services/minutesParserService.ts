import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';

interface ParsedPVSection {
    title: string;
    content: string;
    minuteEntries: MinuteEntry[];
    // Legacy fields
    minuteType?: 'resolution' | 'comment';
    minuteNumber?: string;
    decision?: string;
    proposer?: string;
    seconder?: string;
}

/**
 * Parses the raw text draft from Claude into structured Agenda Items.
 * Returns separately the intro text (before first item) and the parsed items.
 */
export const parseMinutesDraft = (draftContent: string): { items: AgendaItem[], intro: string } => {
    const lines = draftContent.split('\n');
    const sections: ParsedPVSection[] = [];
    let intro = '';

    let currentSection: ParsedPVSection | null = null;
    let buffer: string[] = [];

    // Regex helpers
    const resolutionRegex = /R[ÉE]SOLUTION\s+(\d{2}|[A-Z]{3,})-(\d+)/i;
    const commentaireRegex = /COMMENTAIRE\s+(\d{2}|[A-Z]{3,})-([A-Z0-9]+)/i;
    // Matches "1. Title", "3.1 Title", "10 - Title", "1) Title"
    const numberedTitleRegex = /^(\d+([.-]\d+)*)[.)-]?\s+(.+)$/;

    // Function to flush current section or intro
    const flushSection = () => {
        if (currentSection) {
            // Append remaining buffer to content if not empty
            if (buffer.length > 0) {
                const text = buffer.join('\n').trim();
                currentSection.content = currentSection.content ? currentSection.content + '\n' + text : text;
            }
            sections.push(currentSection);
        } else if (buffer.length > 0) {
            // If no section active, this is the intro
            const text = buffer.join('\n').trim();
            if (text) intro = text;
        }
    };

    // Iterate through lines to identify structure
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            buffer.push(line);
            continue;
        }

        // 1. Check for Resolution Start
        const resMatch = line.match(resolutionRegex);
        if (resMatch) {
            const minuteNumber = `${resMatch[1]}-${resMatch[2]}`;

            // We read ahead to capture the full resolution text until end of block
            let resolutionText = line;
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j].trim();
                if (numberedTitleRegex.test(nextLine) || resolutionRegex.test(nextLine) || commentaireRegex.test(nextLine)) {
                    break;
                }
                resolutionText += '\n' + lines[j];
                j++;
            }
            i = j - 1;

            if (currentSection) {
                currentSection.minuteEntries.push({
                    type: 'resolution',
                    number: minuteNumber,
                    content: resolutionText.trim()
                });

                // Legacy support (first one wins)
                if (!currentSection.minuteType) {
                    currentSection.minuteType = 'resolution';
                    currentSection.minuteNumber = minuteNumber;
                    currentSection.decision = resolutionText.trim();
                }
            } else {
                // Should ideally create a section, but if we are in intro, maybe start a section "Résolutions préliminaires"?
                currentSection = {
                    title: "Section Sans Titre",
                    content: "",
                    minuteEntries: [{
                        type: 'resolution',
                        number: minuteNumber,
                        content: resolutionText.trim()
                    }]
                };
            }
            buffer = [];
            continue;
        }

        // 2. Check for Comment Start
        const comMatch = line.match(commentaireRegex);
        if (comMatch) {
            const minuteNumber = `${comMatch[1]}-${comMatch[2]}`;

            let commentText = line;
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j].trim();
                if (numberedTitleRegex.test(nextLine) || resolutionRegex.test(nextLine) || commentaireRegex.test(nextLine)) {
                    break;
                }
                commentText += '\n' + lines[j];
                j++;
            }
            i = j - 1;

            const entryContent = commentText.replace(commentaireRegex, '').trim();

            if (currentSection) {
                currentSection.minuteEntries.push({
                    type: 'comment',
                    number: minuteNumber,
                    content: entryContent || commentText // Use full text if replacement empty
                });
                // Legacy support
                if (!currentSection.minuteType) {
                    currentSection.minuteType = 'comment';
                    currentSection.minuteNumber = minuteNumber;
                    currentSection.decision = entryContent || commentText;
                }
            } else {
                currentSection = {
                    title: "Section Sans Titre",
                    content: "",
                    minuteEntries: [{
                        type: 'comment',
                        number: minuteNumber,
                        content: entryContent || commentText
                    }]
                };
            }
            buffer = [];
            continue;
        }

        // 3. Identifiers for New Section (Numbered Titles)
        const titleMatch = line.match(numberedTitleRegex);
        if (titleMatch) {
            // New section detected.
            flushSection();

            // Start new section
            // Clean title structure (remove leading number if needed, or keep it consistent)
            // Currently we keep raw line as title, but maybe cleaner to normalize?
            // For now, let's keep it as is, but trim.
            currentSection = {
                title: line.trim(), // e.g., "3.1 Approbation du PV"
                content: "",
                minuteEntries: []
            };
            buffer = [];
            continue;
        }

        // 4. Default: Buffer text
        buffer.push(line);
    }

    // Flush last section
    flushSection();

    // Convert to AgendaItems
    const items = sections.map((sec, idx) => ({
        id: `draft-parsed-${Date.now()}-${idx}`,
        order: idx,
        title: sec.title,
        duration: 10,
        presenter: '',
        objective: sec.minuteEntries.some(e => e.type === 'resolution') ? 'Décision' : 'Information',
        description: '',
        minuteEntries: sec.minuteEntries,
        // Legacy
        minuteType: sec.minuteType,
        minuteNumber: sec.minuteNumber,
        decision: sec.decision || sec.content,
        proposer: sec.proposer || '',
        seconder: sec.seconder || ''
    }));

    return { items, intro };
};
