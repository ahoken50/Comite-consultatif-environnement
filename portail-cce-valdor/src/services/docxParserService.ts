import mammoth from 'mammoth';
import { type AgendaItem, type MinuteEntry, type Attendee } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
    meetingNumber?: string;
    attendees?: Attendee[]; // Parsed attendance info
    rawText?: string;
}



export const parseAgendaDOCX = async (file: File): Promise<ParsedMeetingData> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    if (result.messages.length > 0) {
        console.warn('Mammoth messages:', result.messages);
    }

    const parsedResult: ParsedMeetingData = {
        agendaItems: []
    };

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // ============================================================
    // 1. Extract Date
    // ============================================================
    const fullText = doc.body.textContent || '';
    // Regex for French date: Optional DayName, Day, Month, Year
    // Added replace newlines with space to handle dates split across lines
    const dateRegex = /(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)?\s*(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i;
    const dateMatch = fullText.replace(/\n/g, ' ').match(dateRegex);

    if (dateMatch) {
        const months: { [key: string]: string } = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const day = dateMatch[1].padStart(2, '0');
        const monthStr = dateMatch[2].toLowerCase();
        const year = dateMatch[3];
        const month = months[monthStr];

        if (month) {
            parsedResult.date = `${year}-${month}-${day}T17:00`;
        }
    }

    // ============================================================
    // 2. Extract Title and Meeting Number
    // ============================================================
    const titleMatch = fullText.match(/(\d+)\s*[eè]\s*ASSEMBL[ÉE]E/i);
    if (titleMatch) {
        parsedResult.meetingNumber = titleMatch[1].padStart(2, '0');
    }
    const titleLine = fullText.match(/PROCÈS-VERBAL[^.]+\./)?.[0];
    if (titleLine) {
        parsedResult.title = titleLine;
    }

    // ============================================================
    // 2.5 Extract Attendance Information
    // ============================================================
    const attendees: Attendee[] = [];
    let attendeeIdCounter = 0;

    // Role patterns to detect - ORDER MATTERS! More specific patterns first
    const rolePatterns = [
        { pattern: /vice[- ]pr[ée]sidente?/i, role: 'Vice-président(e)' },  // Must be before président
        { pattern: /pr[ée]sidente?/i, role: 'Président(e)' },
        { pattern: /secr[ée]taire/i, role: 'Secrétaire' },
        { pattern: /conseill[ie](?:[eè]re?)?\s+responsable/i, role: 'Conseiller responsable' },
        { pattern: /conseill[ie](?:[eè]re?)?/i, role: 'Conseiller' }
    ];

    // Parse a text block containing names with optional roles
    // Format: "M. Luc Bossé, Mme Patricia Boutin, présidente, M. Sébastien Brodeur-Girard..."
    const parseNamesWithRoles = (text: string): Array<{ name: string, role: string }> => {
        const results: Array<{ name: string, role: string }> = [];

        // First, normalize the text
        let normalized = text
            .replace(/\s+/g, ' ')  // Normalize spaces
            .replace(/\s+et\s+/gi, ', ')  // Replace "et" with comma
            .trim();

        console.log('[docxParser] Normalized text:', normalized);

        // Use regex to find all M./Mme. Name patterns with optional role
        // The key is to use lookahead to stop at next M./Mme. or end
        const personRegex = /(?:M\.|Mme\.?)\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[\s\-][A-ZÀ-Ÿ][a-zà-ÿ\-]+)*?)(?:,\s*([^,M]+?))?(?=,?\s*(?:M\.|Mme\.)|$)/gi;

        let match;
        while ((match = personRegex.exec(normalized)) !== null) {
            const name = match[1].trim();
            const roleTextRaw = match[2] ? match[2].trim().toLowerCase() : '';

            // Determine role from the captured text
            let role = 'Membre';
            if (roleTextRaw) {
                // Check each role pattern - order matters (more specific first)
                for (const rp of rolePatterns) {
                    if (rp.pattern.test(roleTextRaw)) {
                        role = rp.role;
                        break;
                    }
                }
            }

            if (name.length > 2) {
                results.push({ name, role });
                console.log('[docxParser] Parsed person:', name, 'with role:', role);
            }
        }

        return results;
    };

    // ÉTAIENT PRÉSENTS - capture until ÉTAIENT AUSSI or ÉTAIT ABSENT
    const presentsRegex = /[ÉE]TAIENT\s+PR[ÉE]SENTS?\s+([\s\S]+?)(?=[ÉE]TAIENT\s+AUSSI|[ÉE]TAI(?:T|ENT)\s+ABSENT)/i;
    const presentsMatch = fullText.match(presentsRegex);
    if (presentsMatch) {
        const capturedText = presentsMatch[1].trim();
        console.log('[docxParser] ÉTAIENT PRÉSENTS raw text:', capturedText);
        const parsedPeople = parseNamesWithRoles(capturedText);
        console.log('[docxParser] Found ÉTAIENT PRÉSENTS:', parsedPeople.length, 'people');
        for (const person of parsedPeople) {
            attendees.push({
                id: `attendee-${Date.now()}-${attendeeIdCounter++}`,
                name: person.name,
                role: person.role,
                isPresent: true
            });
        }
    } else {
        console.log('[docxParser] No ÉTAIENT PRÉSENTS match found');
    }

    // ÉTAIENT AUSSI PRÉSENTS - capture until ÉTAIT ABSENT or end
    const alsoPresentsRegex = /[ÉE]TAIENT\s+AUSSI\s+PR[ÉE]SENTS?\s+([\s\S]+?)(?=[ÉE]TAI(?:T|ENT)\s+ABSENT|ORDRE\s+DU\s+JOUR|\d+\.\s|$)/i;
    const alsoPresentsMatch = fullText.match(alsoPresentsRegex);
    if (alsoPresentsMatch) {
        const capturedText = alsoPresentsMatch[1].trim();
        console.log('[docxParser] ÉTAIENT AUSSI PRÉSENTS raw text:', capturedText);
        const parsedPeople = parseNamesWithRoles(capturedText);
        console.log('[docxParser] Found ÉTAIENT AUSSI PRÉSENTS:', parsedPeople.length, 'people');
        for (const person of parsedPeople) {
            attendees.push({
                id: `attendee-${Date.now()}-${attendeeIdCounter++}`,
                name: person.name,
                role: person.role,
                isPresent: true
            });
        }
    } else {
        console.log('[docxParser] No ÉTAIENT AUSSI PRÉSENTS match found');
    }

    // ÉTAIT ABSENT(E)(S) - use a different approach
    // Find the section, then extract only M./Mme. + Prénom + Nom (exactly 2 capitalized words)
    const absentsSectionRegex = /[ÉE]TAI(?:T|ENT)\s+ABSENTE?S?\s+([^\n]+)/i;
    const absentsMatch = fullText.match(absentsSectionRegex);
    if (absentsMatch) {
        const sectionText = absentsMatch[1].trim();
        console.log('[docxParser] ÉTAIT ABSENT raw section:', sectionText);

        // Extract only: M./Mme. + exactly 2 capitalized words (Prénom Nom)
        const absentPersonRegex = /(?:M\.|Mme\.?)\s+([A-ZÀ-Ÿ][a-zà-ÿ]+)\s+([A-ZÀ-Ÿ][a-zà-ÿ]+)/g;
        let absentMatch;
        while ((absentMatch = absentPersonRegex.exec(sectionText)) !== null) {
            const name = `${absentMatch[1]} ${absentMatch[2]}`;
            console.log('[docxParser] Parsed absent person:', name);
            attendees.push({
                id: `attendee-${Date.now()}-${attendeeIdCounter++}`,
                name: name,
                role: 'Membre',
                isPresent: false
            });
        }
        console.log('[docxParser] Found ÉTAIT ABSENT(E)(S): parsed');
    } else {
        console.log('[docxParser] No ÉTAIT ABSENT match found');
    }

    if (attendees.length > 0) {
        parsedResult.attendees = attendees;
        console.log('[docxParser] Total attendees parsed:', attendees.length);
    }

    // ============================================================
    // 3. Parse HTML structure for sections and resolutions
    // ============================================================

    // Intermediate structure to capture sections and their inner entries
    interface ParsedSection {
        title: string;
        content: string[]; // General content (preamble or info item text)
        entries: {
            type: 'resolution' | 'comment';
            number: string;
            content: string[];
            proposer?: string;
            seconder?: string;
        }[];
    }

    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentEntry: ParsedSection['entries'][0] | null = null;

    // Regex - Relaxed for better matching (handle NBSP, dashes, etc.)
    const resolutionRegex = /^R[ÉE]SOLUTION[\s\u00A0]*(\d{2})?[-–—.]?(\d+)?/i; // Made numbers optional for detection purposes
    const commentaireRegex = /^COMMENTAIRE[\s\u00A0]*(\d{2})?[-–—.]?([A-Z])?/i;
    const formalLanguageRegex = /^(CONSID[ÉE]RANT|ATTENDU|RECONNAISSANT|IL EST R[ÉE]SOLU)/i;
    // Updated Blacklist: Now includes resolution keywords and table headers found in logs
    const titleBlacklistRegex = /^(PROCES-VERBAL|PROCÈS-VERBAL|ORDRE DU JOUR|COMITÉ CONSULTATIF|R[ÉE]SOLUTION|COMMENTAIRE|NOM|MANDAT|SIÈGE|DÉBUT DU|FIN DU)/i;

    // Get all block elements
    const elements = doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');

    // Helper to close current section
    const closeCurrentSection = () => {
        if (currentSection) {
            sections.push(currentSection);
            currentSection = null;
            currentEntry = null;
        }
    };

    // Helper to start a new section
    const startNewSection = (title: string) => {
        closeCurrentSection();
        currentSection = {
            title: title || 'Sans titre',
            content: [],
            entries: []
        };
        console.log('[docxParser] Started new section:', title);
    };

    for (const element of elements) {
        // Skip content inside tables (they often contain metadata headers like "NOM", "MANDAT")
        if (element.closest('table')) continue;

        const text = element.textContent?.trim() || '';
        if (!text) continue;

        const tagName = element.tagName;

        // --- 1. DETECT SECTION TITLES (H1) ---
        if (tagName === 'H1') {
            // Extra safety: Check against resolution regex too, in case formatting is weird
            if (!titleBlacklistRegex.test(text) && !resolutionRegex.test(text) && !commentaireRegex.test(text)) {
                startNewSection(text);
                continue;
            }
        }

        // --- 2. DETECT VISUAL TITLES (Bold P) ---
        // If not H1, check if it's a bold paragraph that looks like a title
        const strongElement = element.querySelector('strong');
        const isBoldParagraph = strongElement && strongElement.textContent?.trim() === text;
        const isSuspiciouslyShort = text.length < 100;
        const isNotMetadata = !titleBlacklistRegex.test(text) && !/^\d{4}/.test(text); // Don't match years alone

        if (tagName === 'P' && isBoldParagraph && isSuspiciouslyShort && isNotMetadata) {
            // Heuristics: Not a resolution, not formal language, not a list item
            if (!resolutionRegex.test(text) && !commentaireRegex.test(text) &&
                !formalLanguageRegex.test(text) && !/^\d+[\.\)]/.test(text)) {

                // Treat as section title
                startNewSection(text);
                continue;
            }
        }

        // --- 3. DETECT RESOLUTIONS / COMMENTS ---
        const resMatch = text.match(/^R[ÉE]SOLUTION[\s\u00A0]*(\d{2})[-–—.](\d+)/i); // Strict regex for extraction
        const comMatch = text.match(/^COMMENTAIRE[\s\u00A0]*(\d{2})[-–—.]?([A-Z])/i); // Strict regex for extraction

        // Handling Resolution
        if (resMatch) {
            if (!currentSection) {
                startNewSection('Point sans titre'); // Fallback if resolution appears before any title
            }

            // Create new entry
            currentEntry = {
                type: 'resolution',
                number: `${resMatch[1]}-${resMatch[2]}`,
                content: []
            };
            currentSection!.entries.push(currentEntry);
            console.log('[docxParser] Found resolution:', currentEntry.number);
            continue;
        }

        // Handling Comment
        if (comMatch) {
            if (!currentSection) {
                startNewSection('Point sans titre');
            }

            currentEntry = {
                type: 'comment',
                number: `${comMatch[1]}-${comMatch[2].toUpperCase()}`,
                content: []
            };
            currentSection!.entries.push(currentEntry);
            console.log('[docxParser] Found comment:', currentEntry.number);
            continue;
        }

        // --- 4. DETECT LEVÉE (Special Case) ---
        if (/lev[ée]e\s+de\s+l['’]?\s*assembl[ée]e/i.test(text)) {
            closeCurrentSection();
            currentSection = {
                title: text,
                content: ['Levée de l\'assemblée'], // Dummy content
                entries: []
            };
            continue;
        }

        // --- 5. CAPTURE CONTENT ---
        // If we are here, it's regular content
        if (currentSection) {
            // Skip metadata/signatures
            if (/^(M\.|Mme|Président|Secrétaire|_)/.test(text) && text.length < 50) continue;

            // If we have an active entry (Resolution/Comment), add to it
            if (currentEntry) {
                currentEntry.content.push(text);
            } else {
                // Otherwise add to generic section content
                currentSection.content.push(text);
            }
        }
    }

    // Close last section
    closeCurrentSection();

    // ============================================================
    // 4. Convert Parsed Sections to AgendaItems
    // ============================================================
    parsedResult.agendaItems = sections.map((section, index) => {

        // Map entries to MinuteEntry
        const minuteEntries: MinuteEntry[] = section.entries.map(e => ({
            type: e.type,
            number: e.number,
            content: e.content.join('\n').trim(),
            proposer: '', // TODO: Could extract from content if needed
            seconder: ''
        }));

        // Determine if decision or info
        const hasResolution = section.entries.some(e => e.type === 'resolution');

        // If no entries, the section content IS the "decision" or description
        // For compatibility with UI that expects 'decision' to show text
        const mainDecisionText = hasResolution
            ? minuteEntries.find(e => e.type === 'resolution')?.content || ''
            : section.content.join('\n').trim();

        // Legacy support: Populate top-level fields from first entry if available
        const primaryEntry = section.entries[0];

        return {
            id: `imported-pv-${Date.now()}-${index}`,
            order: index + 1,
            title: section.title,
            duration: 15,
            presenter: 'Coordonnateur',
            objective: hasResolution ? 'Décision' : 'Information',
            description: '', // Could put preamble here

            minuteEntries: minuteEntries,

            // Legacy/Top-level fields
            decision: mainDecisionText,
            minuteType: primaryEntry?.type,
            minuteNumber: primaryEntry?.number,
            proposer: '',
            seconder: ''
        } as AgendaItem;
    });

    console.log('[docxParser] Created', parsedResult.agendaItems.length, 'agenda items from sections');

    // ============================================================
    // 5. Fallbacks (if no items found)
    // ============================================================
    // ============================================================
    // 5. Fallbacks (if no items found or very few)
    // ============================================================

    // Check if we found a Levée item in the main loop
    const leveeItem = parsedResult.agendaItems?.find(item =>
        /lev[ée]e\s+de\s+l['’]?\s*assembl[ée]e/i.test(item.title)
    );

    // Check if we found better items via other methods
    // If we only found 1-2 items and they look like titles, we might have missed the real list
    if (!parsedResult.agendaItems || parsedResult.agendaItems.length < 3) {
        let fallbackItems: AgendaItem[] = [];

        // STRATEGY A: Check for Tables (Common in some ODJ formats)
        // Look for rows with numbered items or specific columns
        const tables = doc.querySelectorAll('table');
        if (tables.length > 0) {
            console.log('[docxParser] Found tables:', tables.length);
            tables.forEach((table) => {
                const rows = table.querySelectorAll('tr');
                rows.forEach((row, rIndex) => {
                    // Skip header rows (usually first row, often bold)
                    if (rIndex === 0 && rows.length > 1) {
                        const headerText = row.textContent?.toLowerCase() || '';
                        if (headerText.includes('sujet') || headerText.includes('item')) return;
                    }

                    // Try to find the "Subject" cell
                    // It's usually the widest cell, or the second cell if numbered
                    const cells = row.querySelectorAll('td');
                    if (cells.length === 0) return;

                    let subjectText = '';
                    let itemNumber = '';
                    let duration = 15;
                    let presenter = 'Coordonnateur'; // Default
                    let objective = 'Information'; // Default

                    // Heuristic: If cell starts with number, it might be the number column + text
                    // Or first column is number, second is text

                    for (const cell of Array.from(cells)) {
                        const cellText = cell.textContent?.trim() || '';
                        if (!cellText) continue;

                        // Check for numbering (e.g. "1.", "2.")
                        const numMatch = cellText.match(/^(\d+)\.?\s*$/);
                        if (numMatch) {
                            itemNumber = numMatch[1];
                            continue;
                        }

                        // Check combined "1. Subject"
                        const combinedMatch = cellText.match(/^(\d+)\.?\s+(.+)/);
                        if (combinedMatch && combinedMatch[2].length > 5) {
                            itemNumber = combinedMatch[1];
                            subjectText = combinedMatch[2].trim();
                            break; // specific match found
                        }

                        // Otherwise, potential subject if long enough
                        if (!subjectText && cellText.length > 10) {
                            subjectText = cellText;
                        }

                        // Detect duration
                        if (cellText.match(/\d+\s*(?:min|h)/i)) {
                            // simple parse duration
                            const digits = cellText.match(/(\d+)/);
                            if (digits) duration = parseInt(digits[1]);
                        }

                        // Detect presenter (M. Name)
                        if (cellText.match(/(?:M\.|Mme)\s+[A-Z]/)) {
                            presenter = cellText.replace(/\n/g, ' ').trim();
                        }
                        // Detect objective
                        if (cellText.match(/Information|D[ée]cision|Adoption/i)) {
                            objective = cellText.trim();
                        }
                    }

                    if (subjectText && (itemNumber || fallbackItems.length > 0 || subjectText.length > 20)) {
                        // Filter out "Ouverture", "Levée" if desired, but usually we keep them
                        if (!subjectText.toLowerCase().includes('sujet') && !subjectText.match(/^temps$/i)) {
                            fallbackItems.push({
                                id: `imported-docx-table-${Date.now()}-${fallbackItems.length}`,
                                order: fallbackItems.length,
                                title: subjectText,
                                duration: duration,
                                presenter: presenter,
                                objective: objective,
                                decision: '',
                                description: '',
                                minuteEntries: [],
                                minuteNumber: itemNumber
                            });
                        }
                    }
                });
            });
        }

        // Use table items if found significant number
        if (fallbackItems.length >= 2) {
            console.log('[docxParser] Using Table fallback items:', fallbackItems.length);
            parsedResult.agendaItems = fallbackItems;
        } else {
            // STRATEGY B: Ordered Lists (Existing fallback)
            const orderedLists = doc.querySelectorAll('ol');
            let mainList: HTMLOListElement | null = null;
            let maxItems = 0;

            orderedLists.forEach((ol: HTMLOListElement) => {
                const items = ol.querySelectorAll('li');
                if (items.length > maxItems) {
                    maxItems = items.length;
                    mainList = ol;
                }
            });

            if (mainList && maxItems >= 3) {
                const listItems = (mainList as HTMLOListElement).querySelectorAll('li');
                // Only replace if we have significantly more items or existing was near empty
                console.log('[docxParser] Using List fallback items:', maxItems);
                parsedResult.agendaItems = [];
                listItems.forEach((li: HTMLLIElement, index: number) => {
                    const text = li.textContent?.trim() || "";
                    if (text) {
                        parsedResult.agendaItems?.push({
                            id: `imported-docx-auto-${Date.now()}-${index}`,
                            order: index,
                            title: text,
                            duration: 15,
                            presenter: 'Coordonnateur',
                            objective: 'Information',
                            decision: '',
                            description: '',
                            minuteEntries: []
                        });
                    }
                });
            }
        }

        // RE-INJECT LEVEE IF LOST
        // If we switched to fallback items, we might have lost the Levée item found in the main loop
        if (leveeItem && parsedResult.agendaItems) {
            const hasLevee = parsedResult.agendaItems.some(item =>
                /lev[ée]e\s+de\s+l['’]?\s*assembl[ée]e/i.test(item.title)
            );
            if (!hasLevee) {
                console.log('[docxParser] Re-injecting lost Levée item');
                // Adjust order to be last
                leveeItem.order = parsedResult.agendaItems.length;
                parsedResult.agendaItems.push(leveeItem);
            }
        }
    }

    // Include raw text for document type detection
    parsedResult.rawText = fullText;

    console.log('[docxParserService] Final parsed result:', parsedResult);
    return parsedResult;
};

/**
 * Match parsed PV items to existing agenda items by title similarity
 * Uses Levenshtein distance for robust "fuzzy" matching
 */
export const matchPVToAgenda = (
    pvItems: AgendaItem[],
    agendaItems: AgendaItem[]
): Map<string, AgendaItem> => {
    const matchMap = new Map<string, AgendaItem>();

    // Synonym groups for common equivalent titles
    const synonymGroups = [
        ['ouverture', 'mot de bienvenue', 'mots de bienvenue', 'bienvenue', 'début'],
        ['levée', 'clôture', 'fin de la réunion', 'fin de l\'assemblée', 'ajournement'],
        ['varia', 'divers', 'points divers', 'autres sujets'],
        ['adoption ordre du jour', 'adoption de l\'ordre du jour', 'approbation ordre du jour'],
    ];

    // Helper to normalize title for comparison
    const normalizeTitle = (title: string): string => {
        return title
            .toLowerCase()
            .replace(/^\d+[\.\)\-]?\s*/, '') // Remove leading numbers
            .replace(/[;:,.]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    };

    // Calculate Levenshtein distance between two strings
    const levenshteinDistance = (a: string, b: string): number => {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        Math.min(
                            matrix[i][j - 1] + 1, // insertion
                            matrix[i - 1][j] + 1 // deletion
                        )
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    };

    // Check if two titles are synonyms
    const areSynonyms = (norm1: string, norm2: string): boolean => {
        for (const group of synonymGroups) {
            const match1 = group.some(syn => norm1.includes(syn));
            const match2 = group.some(syn => norm2.includes(syn));
            if (match1 && match2) {
                return true;
            }
        }
        return false;
    };



    // Track which agenda items have been matched to avoid duplicates
    const matchedAgendaIds = new Set<string>();

    // Try to match each PV item to an agenda item
    for (const pvItem of pvItems) {
        let bestMatch: AgendaItem | null = null;
        let bestScore = 0;

        for (const agendaItem of agendaItems) {
            // Skip if this agenda item is already matched
            if (matchedAgendaIds.has(agendaItem.id)) continue;

            const normPV = normalizeTitle(pvItem.title);
            const normAgenda = normalizeTitle(agendaItem.title);

            // Exact match or Inclusion
            if (normPV.includes(normAgenda) || normAgenda.includes(normPV) || areSynonyms(normPV, normAgenda)) {
                bestMatch = agendaItem;
                bestScore = 1.0;
                break; // Found a high-confidence match
            }

            // Levenshtein Score
            const distance = levenshteinDistance(normPV, normAgenda);
            const maxLength = Math.max(normPV.length, normAgenda.length);
            const similarity = 1 - (distance / maxLength);

            if (similarity > 0.6 && similarity > bestScore) {
                bestMatch = agendaItem;
                bestScore = similarity;
            }
        }

        if (bestMatch) {
            matchMap.set(bestMatch.id, pvItem);
            matchedAgendaIds.add(bestMatch.id);
            console.log('[matchPVToAgenda] Matched:', pvItem.title, '->', bestMatch.title, `(Score: ${bestScore})`);
        }
    }

    return matchMap;
};
