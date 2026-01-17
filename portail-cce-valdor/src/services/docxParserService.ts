import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { type AgendaItem, type MinuteEntry, type Attendee } from '../types/meeting.types';
import { isGroqConfigured, parsePVWithGroq } from './groqService';

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



    // Regex - Relaxed for better matching (handle NBSP, dashes, etc.)
    const resolutionRegex = /^R[ÉE]SOLUTION[\s\u00A0]*(\d{2})?[-–—.]?(\d+)?/i; // Made numbers optional for detection purposes
    const commentaireRegex = /^COMMENTAIRE[\s\u00A0]*(\d{2})?[-–—.]?([A-Z])?/i;
    const formalLanguageRegex = /^(CONSID[ÉE]RANT|ATTENDU|RECONNAISSANT|IL EST R[ÉE]SOLU)/i;
    // Updated Blacklist: Now includes resolution keywords and table headers found in logs
    const titleBlacklistRegex = /^(PROCES-VERBAL|PROCÈS-VERBAL|ORDRE DU JOUR|COMITÉ CONSULTATIF|R[ÉE]SOLUTION|COMMENTAIRE|NOM|MANDAT|SIÈGE|DÉBUT DU|FIN DU)/i;

    // 1. Get all elements (including potentially inside tables if flattened)
    const elements = doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, tr');

    // ============================================================
    // 2. BLOCK EXTRACTION & CLASSIFICATION (The "Engine Overhaul")
    // ============================================================

    interface Block {
        type: 'TITLE' | 'RESOLUTION' | 'COMMENT' | 'CONTENT' | 'LEVEE';
        text: string;
        metadata?: { number?: string; type?: string };
    }

    const blocks: Block[] = [];

    // Keyword Regex for "Implicit Titles" (e.g. "Recommandation...")
    const titleKeywordsRegex = /^(RECOMMANDATION|ADOPTION|D[ÉE]MISSION|NOMINATION|RAPPORT|PR[ÉE]SENTATION|DEMANDE|LISTE|CORRESPONDANCE|DIVERS|VARIA|SUIVI|LETTRE|AVIS)/i;

    for (const element of elements) {
        let text = element.textContent?.trim() || '';
        if (!text) continue;

        // Normalize: Fix NBSP
        text = text.replace(/\u00A0/g, ' ');

        // Check if element is inside a table (table content should NOT become titles)
        const isInsideTable = element.closest('table') !== null || element.tagName === 'TR';

        // A. Detect Resolution/Comment (Highest Priority Anchor) - Works even in tables
        const resMatch = text.match(resolutionRegex);
        const comMatch = text.match(commentaireRegex);

        if (resMatch) {
            console.log(`[docxParser] RESOLUTION detected: "${text.substring(0, 40)}..." -> Number: ${resMatch[1] || resMatch[2]}`);
            blocks.push({
                type: 'RESOLUTION',
                text: text,
                metadata: { number: resMatch[1] || resMatch[2] || resMatch[0], type: 'resolution' }
            });
            continue;
        }

        if (comMatch) {
            console.log(`[docxParser] COMMENT detected: "${text.substring(0, 40)}..." -> Number: ${comMatch[1] || comMatch[2]}`);
            blocks.push({
                type: 'COMMENT',
                text: text,
                metadata: { number: comMatch[1] || comMatch[2] || comMatch[0], type: 'comment' }
            });
            continue;
        }

        // If inside a table, skip title detection - just add as content
        if (isInsideTable) {
            // Skip very short table cells (headers like "NOM", "MANDAT")
            if (text.length > 20) {
                blocks.push({ type: 'CONTENT', text: text });
            }
            continue;
        }

        const tagName = element.tagName;

        // B. Detect Titles

        // B1. Keyword Start
        const isKeywordTitle = titleKeywordsRegex.test(text) && text.length < 200;

        // B2. Explicit H1
        const isH1 = tagName === 'H1';

        // B3. Visual Bold Title
        const isBoldParagraph = tagName === 'P' && (
            element.querySelector('strong') !== null ||
            element.querySelector('b') !== null
        ) && text.length < 150;

        // B4. All Caps Title
        const isAllCaps = text.length > 5 && text === text.toUpperCase() && text.length < 100;

        const isPotentialTitle = isH1 || isKeywordTitle || isBoldParagraph || isAllCaps;
        const isBlacklisted = titleBlacklistRegex.test(text) || /^\d+$/.test(text);

        if (isPotentialTitle && !isBlacklisted && !resolutionRegex.test(text) && !commentaireRegex.test(text) && !formalLanguageRegex.test(text)) {
            console.log(`[docxParser] TITLE detected: "${text.substring(0, 50)}..." (H1:${isH1}, Keyword:${isKeywordTitle}, Bold:${isBoldParagraph}, Caps:${isAllCaps})`);
            blocks.push({ type: 'TITLE', text: text });
            continue;
        }

        // C. Default: Content
        blocks.push({ type: 'CONTENT', text: text });
    }

    // ============================================================
    // 3. GROUPING BLOCKS INTO SECTIONS (The "Cluster" Logic)
    // ============================================================

    // Debug: Show block count by type
    const blockSummary = blocks.reduce((acc, b) => { acc[b.type] = (acc[b.type] || 0) + 1; return acc; }, {} as Record<string, number>);
    console.log(`[docxParser] Extracted ${blocks.length} blocks:`, blockSummary);
    console.log(`[docxParser] First 5 TITLE blocks:`, blocks.filter(b => b.type === 'TITLE').slice(0, 5).map(b => b.text.substring(0, 50)));


    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentEntry: { type: 'resolution' | 'comment', number: string, content: string[] } | null = null;

    const startSection = (title: string) => {
        const cleanTitle = title.replace(/^[\d.\s-]+/g, '').trim();

        currentSection = {
            title: cleanTitle,
            content: [],
            entries: []
        };
        sections.push(currentSection);
        currentEntry = null;
        console.log(`[docxParser] Started Section: ${cleanTitle}`);
    };

    if (blocks.length > 0 && blocks[0].type !== 'TITLE') {
        startSection("Ouverture / Préambule");
    }

    blocks.forEach(block => {
        if (block.type === 'TITLE') {
            startSection(block.text);
        } else if (block.type === 'LEVEE') {
            startSection(block.text);
        }
        else if (block.type === 'RESOLUTION' || block.type === 'COMMENT') {
            if (!currentSection) startSection("Section Inconnue");

            let num = block.metadata!.number!;

            currentEntry = {
                type: block.metadata!.type! as 'resolution' | 'comment',
                number: num,
                content: []
            };
            currentSection!.entries.push(currentEntry);

            if (block.text.length > 50) {
                currentEntry.content.push(block.text);
            }
        }
        else if (block.type === 'CONTENT') {
            if (currentEntry) {
                currentEntry.content.push(block.text);
            } else if (currentSection) {
                currentSection.content.push(block.text);
            }
        }
    });




    // ============================================================
    // 4. Convert Parsed Sections to AgendaItems
    // ============================================================
    parsedResult.agendaItems = sections.map((section, index) => {

        // Map entries to MinuteEntry
        const minuteEntries: MinuteEntry[] = section.entries.map(e => ({
            type: e.type as 'resolution' | 'comment', // Keep lowercase to match interface
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
            ? minuteEntries.map(e => e.content).join('\n\n') // Join all entry contents
            : section.content.join('\n').trim();

        // Legacy support: Populate top-level fields from first entry if available
        const primaryEntry = minuteEntries[0];

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
            // MERGE: Create a new object preserving Agenda Item info but injecting PV data
            const mergedItem: AgendaItem = {
                ...bestMatch,
                // Inject PV data
                minuteEntries: pvItem.minuteEntries, // List of Res/Comments
                decision: pvItem.decision,           // Aggregated text
                minuteType: pvItem.minuteType,       // Legacy Type
                minuteNumber: pvItem.minuteNumber,   // Legacy Num
                // objective: pvItem.objective,      // Don't overwrite objective usually
            };

            matchMap.set(bestMatch.id, mergedItem);
            matchedAgendaIds.add(bestMatch.id);
            console.log('[matchPVToAgenda] Matched & Merged:', pvItem.title, '->', bestMatch.title, `(Score: ${bestScore})`);
        }
    }

    return matchMap;
};

// ============================================================
// AI-POWERED PARSING (Using Groq)
// ============================================================

/**
 * Parse DOCX using AI (Groq) for more robust extraction
 * Falls back to regex parser if Groq is not configured
 * 
 * @param file - The DOCX file to parse
 * @param existingAgendaItems - Optional existing agenda items to use as reference
 * @returns Parsed meeting data with agenda items
 */
export const parseAgendaDOCXWithAI = async (
    file: File,
    existingAgendaItems?: AgendaItem[]
): Promise<ParsedMeetingData> => {
    // Convert DOCX to Markdown to preserve bold text (**) for better AI title detection
    const arrayBuffer = await file.arrayBuffer();

    // 1. Convert DOCX -> HTML (preserves formatting like bold, tables)
    const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
    const html = htmlResult.value;

    if (htmlResult.messages.length > 0) {
        console.warn('[docxParser] Mammoth warnings:', htmlResult.messages);
    }

    // 2. Convert HTML -> Markdown (AI understands **bold** syntax)
    const turndownService = new TurndownService({
        headingStyle: 'atx',      // ## headings
        bulletListMarker: '-',
        codeBlockStyle: 'fenced'
    });

    // Configure turndown for better table handling
    turndownService.addRule('tableCell', {
        filter: ['th', 'td'],
        replacement: (content: string) => ` ${content.trim()} |`
    });
    turndownService.addRule('tableRow', {
        filter: 'tr',
        replacement: (content: string) => `|${content}\n`
    });

    const rawText = turndownService.turndown(html);

    console.log(`[docxParser] AI Mode - Converted DOCX to Markdown: ${rawText.length} chars`);
    console.log('[docxParser] Bold text preserved with ** syntax for AI title detection');

    // Check if Groq is configured
    if (!isGroqConfigured()) {
        console.warn('[docxParser] Groq not configured, falling back to regex parser');
        return parseAgendaDOCX(file);
    }

    // If no existing agenda items, first use regex parser to get structure
    let referenceItems = existingAgendaItems || [];
    if (referenceItems.length === 0) {
        console.log('[docxParser] No reference items, extracting structure first...');
        const regexResult = await parseAgendaDOCX(file);
        referenceItems = regexResult.agendaItems || [];
    }

    // Use Groq to parse the PV
    const aiResult = await parsePVWithGroq(rawText, referenceItems);

    if (!aiResult.success || !aiResult.agendaItems) {
        console.error('[docxParser] AI parsing failed:', aiResult.error);
        console.log('[docxParser] Falling back to regex parser...');
        return parseAgendaDOCX(file);
    }

    console.log(`[docxParser] AI parsed ${aiResult.agendaItems.length} agenda items successfully`);

    // Build the result using AI-parsed agenda items
    const parsedResult: ParsedMeetingData = {
        agendaItems: aiResult.agendaItems,
        rawText: rawText
    };

    // Also extract date and meeting number from raw text
    const dateRegex = /(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)?\s*(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i;
    const dateMatch = rawText.match(dateRegex);

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
            parsedResult.date = `${year}-${month}-${day}`;
        }
    }

    // Extract meeting number
    const meetingMatch = rawText.match(/(?:séance(?:\s+n[°o])?\s*(\d+)|réunion(?:\s+n[°o])?\s*(\d+)|Assemblée\s+n[°o]?\s*(\d+))/i);
    if (meetingMatch) {
        parsedResult.meetingNumber = meetingMatch[1] || meetingMatch[2] || meetingMatch[3];
    }

    return parsedResult;
};

/**
 * Check if AI parsing is available
 */
export const isAIParsingAvailable = (): boolean => {
    return isGroqConfigured();
};
