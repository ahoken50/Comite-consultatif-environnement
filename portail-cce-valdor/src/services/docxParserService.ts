import mammoth from 'mammoth';
import { type AgendaItem } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
    meetingNumber?: string;
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
    // 3. Parse HTML structure for sections and resolutions
    // ============================================================
    // Strategy: 
    // - Bold text (<strong>) that's a standalone paragraph = section title
    // - <h2> with RÉSOLUTION = resolution marker
    // - <strong> with COMMENTAIRE = comment marker

    const parsedItems: ParsedPVItem[] = [];
    let currentSectionTitle = '';
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

        // Check for RÉSOLUTION - can be in h2, bold text, or regular paragraph
        const resMatch = text.match(resolutionRegex);
        if (resMatch) {
            // Save previous item
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
            }

            currentItem = {
                sectionTitle: currentSectionTitle,
                minuteType: 'resolution',
                minuteNumber: `${resMatch[1]}-${resMatch[2]}`,
                decision: ''
            };
            currentContent = [];
            console.log('[docxParser] Found resolution:', currentItem.minuteNumber, 'for section:', currentSectionTitle);
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

            currentItem = {
                sectionTitle: currentSectionTitle,
                minuteType: 'comment',
                minuteNumber: `${comMatch[1]}-${comMatch[2].toUpperCase()}`,
                decision: ''
            };
            currentContent = [];
            console.log('[docxParser] Found comment:', currentItem.minuteNumber, 'for section:', currentSectionTitle);
            continue;
        }

        // Check for bold text - could be section title
        const strongElement = element.querySelector('strong');
        const isBoldParagraph = strongElement && strongElement.textContent?.trim() === text;

        if (isBoldParagraph) {
            // If not formal language and not too short, it's likely a section title
            if (!formalLanguageRegex.test(text) && text.length > 15 && text.length < 250) {
                // Don't treat RÉSOLUTION/COMMENTAIRE as section titles
                if (!resolutionRegex.test(text) && !commentaireRegex.test(text)) {
                    // Save previous item if exists
                    if (currentItem) {
                        currentItem.decision = currentContent.join('\n').trim();
                        parsedItems.push(currentItem);
                        currentItem = null;
                        currentContent = [];
                    }

                    currentSectionTitle = text;
                    console.log('[docxParser] Found section title (bold):', currentSectionTitle);
                    continue;
                }
            }
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
    // 4. Convert ParsedPVItems to AgendaItems
    // ============================================================
    parsedResult.agendaItems = parsedItems.map((item, index) => ({
        id: `imported-pv-${Date.now()}-${index}`,
        order: index,
        title: item.sectionTitle || `Point ${index + 1}`,
        duration: 15,
        presenter: 'Coordonnateur',
        objective: item.minuteType === 'resolution' ? 'Décision' : 'Information',
        minuteType: item.minuteType,
        minuteNumber: item.minuteNumber,
        description: '',
        decision: item.decision,
        proposer: item.proposer || '',
        seconder: item.seconder || ''
    }));

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
