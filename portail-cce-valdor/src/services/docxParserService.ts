import mammoth from 'mammoth';
import { type AgendaItem } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
}

export const parseAgendaDOCX = async (file: File): Promise<ParsedMeetingData> => {
    const arrayBuffer = await file.arrayBuffer();
    // Use convertToHtml to preserve list structure (auto-numbering becomes <ol>)
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;
    const messages = result.messages;

    if (messages.length > 0) {
        console.warn('Mammoth messages:', messages);
    }

    const parsedResult: ParsedMeetingData = {
        agendaItems: []
    };

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const fullText = doc.body.textContent || "";

    // 1. Extract Date (Look for patterns like "Jeudi 9 juin 2022")
    // Regex for French date: DayName Day Month Year
    const dateRegex = /(\w+)\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i;
    const dateMatch = fullText.match(dateRegex);
    if (dateMatch) {
        const months: { [key: string]: string } = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const day = dateMatch[2].padStart(2, '0');
        const monthStr = dateMatch[3].toLowerCase();
        const year = dateMatch[4];
        const month = months[monthStr];

        if (month) {
            parsedResult.date = `${year}-${month}-${day}T19:00`;
        }
    }

    // 2. Extract Title
    // Look for "ASSEMBLÉE" in the text
    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const titleLine = lines.find(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleLine) {
        parsedResult.title = titleLine;
    }

    // 3. Extract Agenda Items
    // Strategy A: Look for <ol> elements (Auto-numbered lists)
    const orderedLists = doc.querySelectorAll('ol');
    let foundAutoList = false;

    // Find the longest ordered list, assuming it's the agenda
    let mainList: HTMLOListElement | null = null;
    let maxItems = 0;

    orderedLists.forEach((ol: HTMLOListElement) => {
        const items = ol.querySelectorAll('li');
        if (items.length > maxItems) {
            maxItems = items.length;
            mainList = ol;
        }
    });

    if (mainList && maxItems >= 3) { // Threshold to consider it a valid agenda
        foundAutoList = true;
        const listItems = (mainList as HTMLOListElement).querySelectorAll('li');
        listItems.forEach((li: HTMLLIElement, index: number) => {
            const text = li.textContent?.trim() || "";
            if (text) {
                parsedResult.agendaItems?.push({
                    id: `imported-docx-auto-${Date.now()}-${index}`,
                    order: index + 1,
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

    // Strategy B: Fallback to text parsing (Manual numbering "1. Title")
    if (!foundAutoList || parsedResult.agendaItems?.length === 0) {
        let currentItem: Partial<AgendaItem> | null = null;
        let itemOrder = 1;

        for (const line of lines) {
            // Regex for item starting with number and dot (e.g. "1. Title")
            const itemMatch = line.match(/^(\d+)[.)]?\s+(.*)/); // Require space after dot
            const isNumberOnly = line.match(/^(\d+)[.)]?\s*$/);

            if (itemMatch && !isNumberOnly && itemMatch[2].length > 0) {
                if (currentItem && currentItem.title) {
                    parsedResult.agendaItems?.push(currentItem as AgendaItem);
                }

                const order = parseInt(itemMatch[1]);

                currentItem = {
                    id: `imported-docx-manual-${Date.now()}-${order}`,
                    order: order,
                    title: itemMatch[2],
                    duration: 15,
                    presenter: 'Coordonnateur',
                    objective: 'Information',
                    decision: '',
                    description: ''
                };
                itemOrder++;
            } else if (isNumberOnly) {
                if (currentItem && currentItem.title) {
                    parsedResult.agendaItems?.push(currentItem as AgendaItem);
                }

                const order = parseInt(isNumberOnly[1]);
                currentItem = {
                    id: `imported-docx-manual-${Date.now()}-${order}`,
                    order: order,
                    title: '',
                    duration: 15,
                    presenter: 'Coordonnateur',
                    objective: 'Information',
                    decision: '',
                    description: ''
                };
                itemOrder++;
            } else if (currentItem) {
                // Append continuation lines
                // Avoid appending Date or Title lines if they appear inside
                if (!line.toUpperCase().includes('ASSEMBLÉE') && !line.match(dateRegex)) {
                    if (currentItem.title === '') {
                        currentItem.title = line;
                    } else {
                        currentItem.title += ' ' + line;
                    }
                }
            }
        }

        if (currentItem && currentItem.title) {
            parsedResult.agendaItems?.push(currentItem as AgendaItem);
        }
    }

    return parsedResult;
};
