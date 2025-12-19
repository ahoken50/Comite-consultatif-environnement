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
    // Look for "ASSEMBLÉE" and potentially the line before (e.g., "COMITÉ...")
    const titleIndex = lines.findIndex(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleIndex !== -1) {
        let fullTitle = lines[titleIndex];
        // Check if previous line exists and looks like a header (uppercase)
        if (titleIndex > 0) {
            const prevLine = lines[titleIndex - 1];
            // If prev line is mostly uppercase and not a date
            if (prevLine === prevLine.toUpperCase() && !prevLine.match(/^\d/)) {
                fullTitle = prevLine + '\n' + fullTitle;
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
                title: '',
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
                // Heuristic: If line starts with lowercase letter (and isn't a common stop word like 'de', 'le'),
                // OR if the current title ends with a hyphen,
                // assume it's a word split and join WITHOUT space.
                // Otherwise join WITH space.

                const startsWithLower = /^[a-z]/.test(line);
                const isCommonWord = /^(de|le|la|les|des|du|en|un|une|et|à|au|aux|sur|par|pour|dans)\b/i.test(line);
                const currentTitle = currentItem.title || '';
                const endsWithHyphen = currentTitle.trim().endsWith('-');

                if (endsWithHyphen) {
                    // Remove hyphen if it looks like a soft hyphen? No, just keep hyphen logic simple for now
                    // Usually "environne-\nment" -> "environnement"
                    currentItem.title = currentTitle.trim().replace(/-$/, '') + line;
                } else if (startsWithLower && !isCommonWord) {
                    // likely a split word like "Ado" + "ption" or "Rev" + "u"
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
