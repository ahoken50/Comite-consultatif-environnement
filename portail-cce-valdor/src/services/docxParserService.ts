import mammoth from 'mammoth';
import { type AgendaItem } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
}

export const parseAgendaDOCX = async (file: File): Promise<ParsedMeetingData> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const fullText = result.value;
    const messages = result.messages; // Warnings, etc.

    if (messages.length > 0) {
        console.warn('Mammoth messages:', messages);
    }

    const parsedResult: ParsedMeetingData = {
        agendaItems: []
    };

    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

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
    // Look for "ASSEMBLÉE"
    const titleLine = lines.find(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleLine) {
        parsedResult.title = titleLine;
    }

    // 3. Extract Agenda Items
    let currentItem: Partial<AgendaItem> | null = null;
    let itemOrder = 1;

    for (const line of lines) {
        // Regex for item starting with number and dot (e.g. "1. Title")
        const itemMatch = line.match(/^(\d+)[.)]?\s*(.*)/);
        const isNumberOnly = line.match(/^(\d+)[.)]?\s*$/);

        if (itemMatch && !isNumberOnly && itemMatch[2].length > 0) {
            if (currentItem && currentItem.title) {
                parsedResult.agendaItems?.push(currentItem as AgendaItem);
            }

            const order = parseInt(itemMatch[1]);
            currentItem = {
                id: `imported-docx-${Date.now()}-${order}`,
                order: order,
                title: itemMatch[2],
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Information',
                decision: ''
            };
            itemOrder++;
        } else if (isNumberOnly) {
            if (currentItem && currentItem.title) {
                parsedResult.agendaItems?.push(currentItem as AgendaItem);
            }

            const order = parseInt(isNumberOnly[1]);
            currentItem = {
                id: `imported-docx-${Date.now()}-${order}`,
                order: order,
                title: '',
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Information',
                decision: ''
            };
            itemOrder++;
        } else if (currentItem) {
            if (currentItem.title === '') {
                currentItem.title = line;
            } else {
                currentItem.title += ' ' + line;
            }
        }
    }

    if (currentItem && currentItem.title) {
        parsedResult.agendaItems?.push(currentItem as AgendaItem);
    }

    return parsedResult;
};
