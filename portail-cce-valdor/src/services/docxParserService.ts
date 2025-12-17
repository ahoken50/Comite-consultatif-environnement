import mammoth from 'mammoth';
import { type AgendaItem, type MinuteEntry, type Attendee } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
    meetingNumber?: string;
    attendees?: Attendee[]; // Parsed attendance info
}

interface ParsedPVItem {
    sectionTitle: string;
    minuteType: 'resolution' | 'comment';
    minuteNumber: string;
    decision: string;
    proposer?: string;
    seconder?: string;
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
    const dateRegex = /(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i;
    const dateMatch = fullText.match(dateRegex);
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
            parsedResult.date = `${year}-${month}-${day}T19:00`;
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
    // Strategy: 
    // - Bold text (<strong>) that's a standalone paragraph = section title
    // - <h2> with RÉSOLUTION = resolution marker
    // - <strong> with COMMENTAIRE = comment marker

    const parsedItems: ParsedPVItem[] = [];
    let currentSectionTitle = '';
    let lastPotentialTitle = ''; // Track last non-formal paragraph as potential title
    let currentItem: ParsedPVItem | null = null;
    let currentContent: string[] = [];

    const resolutionRegex = /^R[ÉE]SOLUTION\s+(\d{2})-(\d+)/i;
    const commentaireRegex = /^COMMENTAIRE\s+(\d{2})-([A-Za-z])/i;
    const formalLanguageRegex = /^(CONSID[ÉE]RANT|ATTENDU|RECONNAISSANT|IL EST R[ÉE]SOLU)/i;

    // Get all block elements
    const elements = doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');

    for (const element of elements) {
        const text = element.textContent?.trim() || '';
        if (!text) continue;

        const tagName = element.tagName;

        // ============================================================
        // PRIORITY 1: Detect H1 as section titles (Titre 1 in Word)
        // ============================================================
        if (tagName === 'H1') {
            // Save previous item if exists
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
                currentItem = null;
                currentContent = [];
            }

            currentSectionTitle = text;
            lastPotentialTitle = text;
            console.log('[docxParser] Found section title (H1):', currentSectionTitle);
            continue;
        }

        // Check for RÉSOLUTION - can be in h4, h2, bold text, or regular paragraph
        const resMatch = text.match(resolutionRegex);
        if (resMatch) {
            // Save previous item
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
            }

            // Use currentSectionTitle if set, otherwise fall back to lastPotentialTitle
            const titleToUse = currentSectionTitle || lastPotentialTitle;

            currentItem = {
                sectionTitle: titleToUse,
                minuteType: 'resolution',
                minuteNumber: `${resMatch[1]}-${resMatch[2]}`,
                decision: ''
            };
            currentContent = [];
            console.log('[docxParser] Found resolution:', currentItem.minuteNumber, 'for section:', titleToUse);
            continue;
        }

        // Check for COMMENTAIRE - can be in bold text or regular paragraph
        const comMatch = text.match(commentaireRegex);
        if (comMatch) {
            // Save previous item
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
            }

            // Use currentSectionTitle if set, otherwise fall back to lastPotentialTitle
            const titleToUse = currentSectionTitle || lastPotentialTitle;

            currentItem = {
                sectionTitle: titleToUse,
                minuteType: 'comment',
                minuteNumber: `${comMatch[1]}-${comMatch[2].toUpperCase()}`,
                decision: ''
            };
            currentContent = [];
            console.log('[docxParser] Found comment:', currentItem.minuteNumber, 'for section:', titleToUse);
            continue;
        }

        // Check for bold text - could be section title
        const strongElement = element.querySelector('strong');
        const isBoldParagraph = strongElement && strongElement.textContent?.trim() === text;

        if (isBoldParagraph) {
            // If not formal language and not too short, it could be a section title
            if (!formalLanguageRegex.test(text) && text.length > 15 && text.length < 250) {
                // Don't treat RÉSOLUTION/COMMENTAIRE as section titles
                if (!resolutionRegex.test(text) && !commentaireRegex.test(text)) {
                    // Check if it's a numbered sub-section (1., 2., 3., etc.)
                    const numberedItemRegex = /^\d+\.\s+/;

                    // Only treat as section title if NOT a numbered item
                    if (!numberedItemRegex.test(text)) {
                        // Save previous item if exists
                        if (currentItem) {
                            currentItem.decision = currentContent.join('\n').trim();
                            parsedItems.push(currentItem);
                            currentItem = null;
                            currentContent = [];
                        }

                        currentSectionTitle = text;
                        lastPotentialTitle = text; // Also update potential title
                        console.log('[docxParser] Found section title (bold):', currentSectionTitle);
                        continue;
                    }
                    // Numbered items fall through to content collection below
                }
            }
        }

        // Track potential titles: non-formal, non-marker text that could be a section header
        // These get used when we encounter a resolution/comment with no current section
        // Exclude numbered items (1., 2., 3., etc.) - they should not be section titles
        const numberedItemPattern = /^\d+\.\s+/;
        if (!currentItem && !formalLanguageRegex.test(text) &&
            !resolutionRegex.test(text) && !commentaireRegex.test(text) &&
            !numberedItemPattern.test(text) &&
            text.length > 10 && text.length < 300 && !text.startsWith('Sur une proposition')) {
            lastPotentialTitle = text;
        }

        // If we're in an item, collect content
        if (currentItem) {
            // Skip signature lines
            if (/^_{3,}|^PATRICIA BOUTIN|^MICHA[EË]L ROSS|^Président|^Secrétaire/i.test(text)) {
                continue;
            }
            currentContent.push(text);
        }
    }

    // Don't forget the last item
    if (currentItem) {
        currentItem.decision = currentContent.join('\n').trim();
        parsedItems.push(currentItem);
    }

    console.log('[docxParser] Total parsed items:', parsedItems.length);

    // ============================================================
    // 4. Convert ParsedPVItems to AgendaItems (grouped by section)
    // ============================================================
    // Group parsed items by section title to support multiple resolutions/comments per item
    const groupedBySectionTitle = new Map<string, ParsedPVItem[]>();

    for (const item of parsedItems) {
        const title = item.sectionTitle || 'Sans titre';
        if (!groupedBySectionTitle.has(title)) {
            groupedBySectionTitle.set(title, []);
        }
        groupedBySectionTitle.get(title)!.push(item);
    }

    console.log('[docxParser] Grouped into', groupedBySectionTitle.size, 'sections');

    // Convert grouped items to AgendaItems with minuteEntries arrays
    let order = 0;
    parsedResult.agendaItems = [];

    for (const [sectionTitle, items] of groupedBySectionTitle) {
        // Create minuteEntries from all items in this section
        const minuteEntries: MinuteEntry[] = items.map(item => ({
            type: item.minuteType,
            number: item.minuteNumber,
            content: item.decision,
            proposer: item.proposer,
            seconder: item.seconder
        }));

        // Determine objective based on whether there are resolutions
        const hasResolution = items.some(i => i.minuteType === 'resolution');

        // Keep legacy fields for backward compatibility (use first item's data)
        const firstItem = items[0];

        const agendaItem: AgendaItem = {
            id: `imported-pv-${Date.now()}-${order}`,
            order: order++,
            title: sectionTitle,
            duration: 15,
            presenter: 'Coordonnateur',
            objective: hasResolution ? 'Décision' : 'Information',
            description: '',
            // NEW: Array of all resolutions/comments for this section
            minuteEntries: minuteEntries,
            // Legacy fields (kept for backward compatibility)
            minuteType: firstItem.minuteType,
            minuteNumber: firstItem.minuteNumber,
            decision: firstItem.decision,
            proposer: firstItem.proposer || '',
            seconder: firstItem.seconder || ''
        };

        parsedResult.agendaItems.push(agendaItem);
        console.log('[docxParser] Created agenda item:', sectionTitle, 'with', minuteEntries.length, 'entries');
    }

    // ============================================================
    // 5. Fallbacks (if no items found)
    // ============================================================
    if (!parsedResult.agendaItems || parsedResult.agendaItems.length === 0) {
        // Try ordered lists
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
                        description: ''
                    });
                }
            });
        }
    }

    console.log('[docxParserService] Final parsed result:', parsedResult);
    return parsedResult;
};

/**
 * Match parsed PV items to existing agenda items by title similarity
 */
export const matchPVToAgenda = (
    pvItems: AgendaItem[],
    agendaItems: AgendaItem[]
): Map<string, AgendaItem> => {
    const matchMap = new Map<string, AgendaItem>();

    // Helper to normalize title for comparison
    const normalizeTitle = (title: string): string => {
        return title
            .toLowerCase()
            .replace(/[;:,.]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    };

    // Helper to check if titles are similar enough
    const titlesMatch = (pvTitle: string, agendaTitle: string): boolean => {
        const normalPV = normalizeTitle(pvTitle);
        const normalAgenda = normalizeTitle(agendaTitle);

        // Check if one contains the other
        if (normalPV.includes(normalAgenda) || normalAgenda.includes(normalPV)) {
            return true;
        }

        // Check if they share significant words
        const pvWords = normalPV.split(' ').filter(w => w.length > 3);
        const agendaWords = normalAgenda.split(' ').filter(w => w.length > 3);

        const sharedWords = pvWords.filter(w => agendaWords.includes(w));
        const matchRatio = sharedWords.length / Math.min(pvWords.length, agendaWords.length);

        return matchRatio >= 0.5;
    };

    // Track which agenda items have been matched to avoid duplicates
    const matchedAgendaIds = new Set<string>();

    // Try to match each PV item to an agenda item
    for (const pvItem of pvItems) {
        for (const agendaItem of agendaItems) {
            // Skip if this agenda item is already matched
            if (matchedAgendaIds.has(agendaItem.id)) continue;

            if (titlesMatch(pvItem.title, agendaItem.title)) {
                matchMap.set(agendaItem.id, pvItem);
                matchedAgendaIds.add(agendaItem.id);
                console.log('[matchPVToAgenda] Matched:', pvItem.title, '->', agendaItem.title);
                break;
            }
        }
    }

    return matchMap;
};
