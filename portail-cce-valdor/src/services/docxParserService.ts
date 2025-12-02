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

    // Helper to extract text with newlines from HTML
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

    // Strategy C: Table Parsing (Specific columns: Sujet, TEMPS, Responsable, Objectif)
    const tables = doc.querySelectorAll('table');
    let foundTable = false;

    tables.forEach((table) => {
        if (foundTable) return;

        const rows = table.querySelectorAll('tr');
        if (rows.length < 2) return; // Need at least header and one data row

        // Check headers
        const headerRow = rows[0];
        const headers = Array.from(headerRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim().toUpperCase() || '');

        const sujetIndex = headers.findIndex(h => h.includes('SUJET'));
        const tempsIndex = headers.findIndex(h => h.includes('TEMPS') || h.includes('DURÉE'));
        const respIndex = headers.findIndex(h => h.includes('RESPONSABLE'));
        const objIndex = headers.findIndex(h => h.includes('OBJECTIF') || h.includes('NOTE') || h.includes('DÉCISION'));

        if (sujetIndex !== -1) {
            foundTable = true;
            // Clear previous strategy results if table is found, as it's likely more accurate
            parsedResult.agendaItems = [];

            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].querySelectorAll('td');
                if (cells.length <= sujetIndex) continue;

                const rawTitle = cells[sujetIndex]?.textContent?.trim() || '';
                if (!rawTitle) continue;

                // Extract numbering if present (e.g., "1. Mot de bienvenue")
                const titleMatch = rawTitle.match(/^(\d+)[.)]?\s+(.*)/);
                const isNumberOnly = rawTitle.match(/^(\d+)[.)]?\s*$/);

                let title = rawTitle;

                if (titleMatch) {
                    // Use extracted number for ordering if needed, currently using array index
                    // order = parseInt(titleMatch[1]) - 1; 
                    title = titleMatch[2];
                } else if (isNumberOnly) {
                    // Skip rows that are just numbers without text, or handle differently?
                    // For now, let's assume it's a valid item with empty title if that happens, or skip.
                    // Actually, user said "Le sujet est dans la colonne sujet et est numéroté."
                    continue;
                }

                const durationStr = tempsIndex !== -1 ? cells[tempsIndex]?.textContent?.trim() : '15';
                const duration = parseInt(durationStr || '15') || 15;

                const presenter = respIndex !== -1 ? cells[respIndex]?.textContent?.trim() : 'Coordonnateur';

                // Map Objectif column to decision/note or objective
                const rawObjective = objIndex !== -1 ? cells[objIndex]?.textContent?.trim() : 'Information';
                // Heuristic to categorize objective
                let objective = 'Information';
                if (rawObjective?.toUpperCase().includes('DÉCISION')) objective = 'Décision';
                else if (rawObjective?.toUpperCase().includes('CONSULTATION')) objective = 'Consultation';

                parsedResult.agendaItems.push({
                    id: `imported-docx-table-${Date.now()}-${i}`,
                    order: parsedResult.agendaItems.length, // Use sequential order
                    title: title,
                    duration: duration,
                    presenter: presenter || 'Coordonnateur',
                    objective: objective,
                    decision: rawObjective || '', // Store full text in decision/note field
                    description: ''
                });
            }
        }
    });

    if (foundTable) {
        return parsedResult;
    }

    return parsedResult;
};
