import * as pdfjsLib from 'pdfjs-dist';
import { type AgendaItem } from '../types/meeting.types';

// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
}

export const parseAgendaPDF = async (file: File): Promise<ParsedMeetingData> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    // Extract text from all pages
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join('\n');
        fullText += pageText + '\n';
    }

    const result: ParsedMeetingData = {
        agendaItems: []
    };

    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // 1. Extract Date
    // Improved Regex: Look for Day(optional) + Number + Month + Year
    // We search across newlines because sometimes text extraction splits them
    const dateRegex = /(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)?\s*(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i;
    const dateMatch = fullText.replace(/\n/g, ' ').match(dateRegex);

    if (dateMatch) {
        const months: { [key: string]: string } = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        // match[1] is day, match[2] is month, match[3] is year
        const day = dateMatch[1].padStart(2, '0');
        const monthStr = dateMatch[2].toLowerCase();
        const year = dateMatch[3];
        const month = months[monthStr];

        if (month) {
            result.date = `${year}-${month}-${day}T17:00`;
        }
    }

    // 2. Extract Title
    // Look for "ASSEMBLÉE" and walk upwards to capture header
    const titleIndex = lines.findIndex(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleIndex !== -1) {
        let fullTitle = lines[titleIndex];
        // Walk upwards up to 3 lines
        for (let i = 1; i <= 3; i++) {
            if (titleIndex - i < 0) break;
            const prevLine = lines[titleIndex - i];

            // Allow lines that are uppercase OR start with a digit (e.g. "13e")
            const isHeaderLine = prevLine === prevLine.toUpperCase() || /^\d/.test(prevLine);

            if (isHeaderLine && prevLine) {
                fullTitle = prevLine + '\n' + fullTitle;
            } else {
                break; // Stop if we hit a non-header line
            }
        }
        result.title = fullTitle;
    }

    // 3. Extract Agenda Items
    let currentItem: Partial<AgendaItem> | null = null;
    let itemOrder = 1;

    for (const line of lines) {
        // Strict Regex for Agenda Items
        const itemMatch = line.match(/^(\d+)[.)]\s+(.*)/);
        const isNumberOnly = line.match(/^(\d+)[.)]\s*$/);

        if (itemMatch && !isNumberOnly && itemMatch[2].length > 0) {
            // New Item detected
            if (currentItem && currentItem.title) {
                result.agendaItems?.push(currentItem as AgendaItem);
            }

            const order = parseInt(itemMatch[1]);
            currentItem = {
                id: `imported-${Date.now()}-${order}`,
                order: order,
                title: itemMatch[2],
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Information',
                decision: ''
            };
            itemOrder++;
        } else if (isNumberOnly) {
            // New Item with empty title on first line
            if (currentItem && currentItem.title) {
                result.agendaItems?.push(currentItem as AgendaItem);
            }

            const order = parseInt(isNumberOnly[1]);
            currentItem = {
                id: `imported-${Date.now()}-${order}`,
                order: order,
                title: 'Point sans titre',
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Information',
                decision: ''
            };
            itemOrder++;
        } else if (currentItem) {
            // Append continuation line
            if (currentItem.title === '') {
                currentItem.title = line;
            } else {
                // Heuristic for word merging:
                // Join WITHOUT space if:
                // 1. Current line starts with lowercase (and isn't common short word)
                // 2. Previous part does NOT end with a connector (de, à, le...)
                // 3. Previous part does NOT look like an ordinal (13e, 1er)
                // 4. Previous part ends with hyphen (always join)

                const currentTitle = currentItem.title || '';
                const startsWithLower = /^[a-z]/.test(line);
                const isCommonWord = /^(de|le|la|les|des|du|en|un|une|et|à|au|aux|sur|par|pour|dans)\b/i.test(line);
                const endsWithHyphen = currentTitle.trim().endsWith('-');

                // Regex for connectors at end of string: " de", " le" etc.
                const endsWithConnector = /(?:^|\s)(de|le|la|les|des|du|en|un|une|et|à|au|aux|sur|par|pour|dans)$/i.test(currentTitle.trim());

                // Regex for ordinals: 13e, 1er.
                const endsWithOrdinal = /\d+(?:e|er|ère|eme|ème)$/i.test(currentTitle.trim());

                if (endsWithHyphen) {
                    currentItem.title = currentTitle.trim().replace(/-$/, '') + line;
                } else if (startsWithLower && !isCommonWord && !endsWithConnector && !endsWithOrdinal) {
                    // likely a split word like "Ado" + "ption"
                    currentItem.title = currentTitle + line;
                } else {
                    currentItem.title = currentTitle + ' ' + line;
                }
            }
        }
    }
    // Push last item
    if (currentItem && currentItem.title) {
        result.agendaItems?.push(currentItem as AgendaItem);
    }

    return result;
};
