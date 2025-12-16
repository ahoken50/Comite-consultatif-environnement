import mammoth from 'mammoth';
import { type AgendaItem } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
    meetingNumber?: string;
}

/**
 * Parsed item from PV document - contains a section title and its resolution/comment data
 */
interface ParsedPVItem {
    sectionTitle: string;        // The title line ending with semicolon (e.g., "Adoption de l'ordre du jour...")
    minuteType: 'resolution' | 'comment';
    minuteNumber: string;        // e.g., "09-35" or "09-A"
    decision: string;            // Full CONSIDÉRANT/IL EST RÉSOLU content
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

    // Helper to extract text with proper newlines from HTML
    const extractTextWithNewlines = (element: Element): string => {
        let text = '';
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BR'];

        element.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as Element;
                if (blockTags.includes(el.tagName)) {
                    text += '\n';
                }
                text += extractTextWithNewlines(el);
                if (blockTags.includes(el.tagName) && !text.endsWith('\n')) {
                    text += '\n';
                }
            }
        });
        return text;
    };

    const fullText = extractTextWithNewlines(doc.body);
    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // ============================================================
    // 1. Extract Date
    // ============================================================
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
    const titleLine = lines.find(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleLine) {
        parsedResult.title = titleLine;
        const meetingNumMatch = titleLine.match(/(\d+)\s*[eè]/i);
        if (meetingNumMatch) {
            parsedResult.meetingNumber = meetingNumMatch[1].padStart(2, '0');
        }
    }

    // ============================================================
    // 3. Parse sections with their RÉSOLUTION/COMMENTAIRE
    // ============================================================
    // Strategy: Track potential title lines and use look-back when finding RÉSOLUTION/COMMENTAIRE

    const resolutionRegex = /^R[ÉE]SOLUTION\s+(\d{2})-(\d+)/i;
    const commentaireRegex = /^COMMENTAIRE\s+(\d{2})-([A-Za-z])/i;
    const formalLanguageRegex = /^(CONSID[ÉE]RANT|ATTENDU|RECONNAISSANT|IL EST R[ÉE]SOLU|QUE\s)/i;

    const parsedItems: ParsedPVItem[] = [];
    let currentSectionTitle = '';
    let lastPotentialTitle = ''; // Track lines that could be section titles
    let currentItem: ParsedPVItem | null = null;
    let currentContent: string[] = [];

    // Skip header lines (before the first section)
    const skipPatterns = [
        /^COMITÉ CONSULTATIF/i,
        /^PROCÈS-VERBAL/i,
        /^ASSEMBLÉE/i,
        /^ÉTAIENT PRÉSENTS/i,
        /^ÉTAIENT AUSSI PRÉSENTS/i,
        /^ÉTAIT ABSENT/i,
        /^\d{1,2}\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/i,
        /^Mardi|^Lundi|^Mercredi|^Jeudi|^Vendredi/i,
        /^Salle /i,
    ];

    const isSkipLine = (line: string): boolean => {
        return skipPatterns.some(pattern => pattern.test(line));
    };

    // Check if a line could be a section title
    const isPotentialTitle = (line: string): boolean => {
        // Not formal language
        if (formalLanguageRegex.test(line)) return false;
        // Not too short or too long
        if (line.length < 15 || line.length > 200) return false;
        // Not a meta/header line
        if (isSkipLine(line)) return false;
        // Not a signature line
        if (/^_{3,}|^Président|^Secrétaire|^PATRICIA|^MICHA[EË]L/i.test(line)) return false;
        // Not a resolution/comment line
        if (resolutionRegex.test(line) || commentaireRegex.test(line)) return false;
        return true;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip header/meta lines
        if (isSkipLine(line)) {
            continue;
        }

        // Track potential title lines (lines that could be section headers)
        // These are used when we encounter a RÉSOLUTION/COMMENTAIRE with no current section
        if (isPotentialTitle(line) && !currentItem) {
            lastPotentialTitle = line;
        }

        // Check if this is a section title (ends with semicolon but NOT formal resolution language)
        // Section titles are lines like "Adoption de l'ordre du jour de la 9e assemblée ordinaire du CCE;"
        if (line.endsWith(';') && line.length > 10 && line.length < 200 && !formalLanguageRegex.test(line)) {
            // Save previous item if exists
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
                currentItem = null;
                currentContent = [];
            }

            currentSectionTitle = line;
            lastPotentialTitle = line; // Also update lastPotentialTitle
            console.log('[docxParser] Found section title (semicolon):', currentSectionTitle);
            continue;
        }

        // Check for RÉSOLUTION
        const resMatch = line.match(resolutionRegex);
        if (resMatch) {
            // Save previous item if exists
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
            }

            // Use currentSectionTitle if set, otherwise use lastPotentialTitle
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

        // Check for COMMENTAIRE
        const comMatch = line.match(commentaireRegex);
        if (comMatch) {
            // Save previous item if exists
            if (currentItem) {
                currentItem.decision = currentContent.join('\n').trim();
                parsedItems.push(currentItem);
            }

            // Use currentSectionTitle if set, otherwise use lastPotentialTitle
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

        // If we're in an item, collect content
        if (currentItem) {
            // Check for CONSIDÉRANT/IL EST RÉSOLU/ATTENDU
            // Check for formal language (CONSIDÉRANT/IL EST RÉSOLU/ATTENDU) - add to content
            if (formalLanguageRegex.test(line)) {
                currentContent.push(line);
                continue;
            }

            // Skip signature lines and other meta content
            if (!line.match(/^_{3,}/) &&
                !line.match(/^PATRICIA BOUTIN/i) &&
                !line.match(/^MICHA[EË]L ROSS/i) &&
                !line.match(/^Président/i) &&
                !line.match(/^Secrétaire/i)) {
                currentContent.push(line);
            }
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
    // Each parsed item becomes an agenda item with its section title
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
    // 5. Fallback: If no items found, try ordered lists
    // ============================================================
    if (!parsedResult.agendaItems || parsedResult.agendaItems.length === 0) {
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

    // ============================================================
    // 6. Fallback: Table parsing
    // ============================================================
    if (!parsedResult.agendaItems || parsedResult.agendaItems.length === 0) {
        const tables = doc.querySelectorAll('table');

        tables.forEach((table) => {
            if (parsedResult.agendaItems && parsedResult.agendaItems.length > 0) return;

            const rows = table.querySelectorAll('tr');
            if (rows.length < 2) return;

            const headerRow = rows[0];
            const headers = Array.from(headerRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim().toUpperCase() || '');
            const sujetIndex = headers.findIndex(h => h.includes('SUJET'));

            if (sujetIndex !== -1) {
                parsedResult.agendaItems = [];
                for (let i = 1; i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length <= sujetIndex) continue;

                    const rawTitle = cells[sujetIndex]?.textContent?.trim() || '';
                    if (!rawTitle) continue;

                    parsedResult.agendaItems.push({
                        id: `imported-docx-table-${Date.now()}-${i}`,
                        order: i - 1,
                        title: rawTitle,
                        duration: 15,
                        presenter: 'Coordonnateur',
                        objective: 'Information',
                        decision: '',
                        description: ''
                    });
                }
            }
        });
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

        return matchRatio >= 0.5; // At least 50% of significant words match
    };

    // Try to match each PV item to an agenda item
    for (const pvItem of pvItems) {
        for (const agendaItem of agendaItems) {
            if (titlesMatch(pvItem.title, agendaItem.title)) {
                matchMap.set(agendaItem.id, pvItem);
                console.log('[matchPVToAgenda] Matched:', pvItem.title, '->', agendaItem.title);
                break;
            }
        }
    }

    return matchMap;
};
