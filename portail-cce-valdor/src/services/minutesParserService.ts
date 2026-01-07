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

    // Regex helpers - Updated to handle Markdown bold (** or __) and various formats
    const resolutionRegex = /(?:\*\*|__)?R[ÉE]SOLUTION(?:\*\*|__)?\s+(\d{2}|[A-Z]{3,})-(\d+)/i;
    // FIXED: Now captures number format "XX-Y" or "XX-YY" after COMMENTAIRE with space/colon
    // Test cases: "COMMENTAIRE 25-A", "COMMENTAIRE: 09-B", "**COMMENTAIRE** 25-C"
    const commentaireRegex = /(?:\*\*|__)?COMMENTAIRE(?:\*\*|__)?[\s:]*(\d{2}-[A-Za-z0-9]+)?/i;
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

    // Helper to check if a title is a sub-title of the current section
    const isSubTitle = (titleLine: string, currentSectionTitle: string | undefined): boolean => {
        if (!currentSectionTitle) return false;

        // Extract numbers from titles (e.g., "4. Revue..." -> "4", "4.1 Amenagement" -> "4.1")
        const currentMatch = currentSectionTitle.match(/^(\d+(?:[.-]\d+)*)/);
        const newMatch = titleLine.match(/^(\d+(?:[.-]\d+)*)/);

        if (!currentMatch || !newMatch) return false;

        const currentNum = currentMatch[1];
        const newNum = newMatch[1];

        // It is a sub-title if it starts with the current section number AND is longer
        // e.g. "4.1" starts with "4" -> TRUE
        // e.g. "5" starts with "4" -> FALSE
        // e.g. "4" starts with "4" -> FALSE (same level)
        return newNum.startsWith(currentNum) && newNum.length > currentNum.length;
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
            // CLEANUP: Strip the "RÉSOLUTION XX-XX" header from the content
            let resolutionText = line.replace(resolutionRegex, '').trim();
            // Remove leading separator chars like ": " or "- "
            resolutionText = resolutionText.replace(/^[:\s-]+/, '');

            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j].trim();
                let shouldBreak = false;

                // Check for hard breaks
                if (resolutionRegex.test(nextLine) || commentaireRegex.test(nextLine)) {
                    shouldBreak = true;
                }
                // Check for title breaks (UNLESS it's a sub-title of the current section)
                else if (numberedTitleRegex.test(nextLine)) {
                    // If we are deep inside a content block attached to section "4.", 
                    // and we see "4.1", we should treat it as text content, not a new section.
                    const isSub = currentSection ? isSubTitle(nextLine, currentSection.title) : false;
                    if (!isSub) {
                        shouldBreak = true;
                    }
                }

                if (shouldBreak) {
                    break;
                }
                if (resolutionText) {
                    resolutionText += '\n' + lines[j];
                } else {
                    resolutionText = lines[j]; // If first line was empty after strip
                }
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
            // If number captured, use it.
            let capturedNumber = comMatch[1] ? comMatch[1] : '';

            // CLEANUP: Strip header from the current line
            let commentText = line.replace(commentaireRegex, '').trim();
            commentText = commentText.replace(/^[:\s-]+/, ''); // remove separators

            // Advanced Clean: If line 1 was JUST the header, check line 2 for the number "25-B"
            // Case: 
            // **COMMENTAIRE**
            // 25-B
            // Content...
            let j = i + 1;

            // Peek at next line if we didn't catch a number yet, or if text is empty
            if (j < lines.length && (!commentText || !capturedNumber)) {
                let nextPeek = lines[j].trim();
                console.log('[Parser Debug] Peeking next line for number:', nextPeek);

                // CLEANUP MARKDOWN from nextPeek to handle "**25-A**" or "__25-A__"
                // remove only surrounding * or _ but keep content
                const cleanNextPeek = nextPeek.replace(/^[*_]+|[*_]+$/g, '').trim();
                console.log('[Parser Debug] Cleaned peek:', cleanNextPeek);

                // Simple regex to catch standalone number "DD-L" or "DD-LL" or "DD-D"
                // e.g. "09-35" or "09-A" or "25-B"
                const standaloneNumberMatch = cleanNextPeek.match(/^(\d{2}-[A-Z0-9]+)$/i);

                if (standaloneNumberMatch) {
                    if (!capturedNumber) capturedNumber = standaloneNumberMatch[1];
                    // Skip this line as it is just the number
                    j++;
                }
                // Also check if next line is just "25-B :" 
                else if (/^(\d{2}-[A-Z0-9]+)\s*[:.-]/.test(cleanNextPeek)) {
                    const match = cleanNextPeek.match(/^(\d{2}-[A-Z0-9]+)/);
                    if (match) {
                        if (!capturedNumber) capturedNumber = match[1];
                        // Strip the number from this next line, but keep the rest
                        const remaining = cleanNextPeek.replace(/^(\d{2}-[A-Z0-9]+)\s*[:.-]?\s*/, '');
                        if (remaining) {
                            // If there was text after the number on the clean line, use it.
                            commentText = remaining;
                            j++; // consume line
                        } else {
                            j++; // pure number line
                        }
                    }
                }
            }

            const minuteNumber = capturedNumber || '';

            while (j < lines.length) {
                const nextLine = lines[j].trim();
                let shouldBreak = false;

                // Check for hard breaks
                if (resolutionRegex.test(nextLine) || commentaireRegex.test(nextLine)) {
                    shouldBreak = true;
                }
                // Check for title breaks (UNLESS it's a sub-title)
                else if (numberedTitleRegex.test(nextLine)) {
                    const isSub = currentSection ? isSubTitle(nextLine, currentSection.title) : false;
                    if (!isSub) {
                        shouldBreak = true;
                    }
                }

                if (shouldBreak) {
                    break;
                }
                if (commentText) {
                    commentText += '\n' + lines[j];
                } else {
                    commentText = lines[j];
                }
                j++;
            }
            i = j - 1;

            if (currentSection) {
                // MERGE LOGIC: If last entry was also a comment and we just parsed another comment...
                // The user says "ce commentaire ne devrait en être qu'un".
                // If it's a "broken" comment (multiple headers for same point), we merge.
                // UNLESS the number is different?
                const lastEntry = currentSection.minuteEntries[currentSection.minuteEntries.length - 1];

                if (lastEntry && lastEntry.type === 'comment' && (!minuteNumber || minuteNumber === lastEntry.number)) {
                    // It's likely a continuation broken by a header
                    lastEntry.content += '\n\n' + commentText.trim();
                } else {
                    currentSection.minuteEntries.push({
                        type: 'comment',
                        number: minuteNumber,
                        content: commentText.trim()
                    });
                }

                // Legacy support
                if (!currentSection.minuteType) {
                    currentSection.minuteType = 'comment';
                    currentSection.minuteNumber = minuteNumber;
                    currentSection.decision = commentText.trim();
                }
            } else {
                currentSection = {
                    title: "Section Sans Titre",
                    content: "",
                    minuteEntries: [{
                        type: 'comment',
                        number: minuteNumber,
                        content: commentText.trim()
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
    const items = sections.map((sec, idx) => {
        // PER USER REQUEST:
        // If a section has content but NO explicit entries (Resolution/Comment), it is implied to be a COMMENT.
        // Exceptions: "Mot de bienvenue", "Ouverture", "Levée", "Varia" (if empty/simple).

        let finalMinuteEntries = [...sec.minuteEntries];
        let finalMinuteType = sec.minuteType;
        let finalMinuteNumber = sec.minuteNumber;
        let finalDecision = sec.decision || sec.content;

        const lowerTitle = sec.title.toLowerCase();
        const isException = lowerTitle.includes('bienvenue') ||
            lowerTitle.includes('ouverture') ||
            lowerTitle.includes('levée') ||
            (lowerTitle.includes('varia') && (!sec.content || sec.content.length < 50));

        if (finalMinuteEntries.length === 0 && sec.content.trim() && !isException) {
            // Create implicit comment entry
            finalMinuteEntries.push({
                type: 'comment',
                number: '', // No number for implicit comment unless we parse it from content? User said number in box. 
                // If implicit, we don't have a number. Leave empty.
                content: sec.content.trim()
            });
            finalMinuteType = 'comment';
            finalDecision = sec.content.trim();
        }

        return {
            id: `draft-parsed-${Date.now()}-${idx}`,
            order: idx,
            title: sec.title,
            duration: 10,
            presenter: '',
            objective: finalMinuteEntries.some(e => e.type === 'resolution') ? 'Décision' : 'Information',
            description: '',
            minuteEntries: finalMinuteEntries,
            // Legacy
            minuteType: finalMinuteType,
            minuteNumber: finalMinuteNumber,
            decision: finalDecision,
            proposer: sec.proposer || '',
            seconder: sec.seconder || ''
        };
    });

    return { items, intro };
};
