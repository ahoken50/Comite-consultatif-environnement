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

    // 1. Extract Date (Look for patterns like "Jeudi 9 juin 2022")
    // Regex for French date: DayName Day Month Year
    const dateRegex = /(\w+)\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i;
    const dateMatch = fullText.match(dateRegex);
    if (dateMatch) {
        // Attempt to parse date. For simplicity, we might just return the string or try to format it.
        // Here we'll try to create a valid ISO string if possible, or just leave it for the user to verify if complex.
        // A robust implementation would map French month names to numbers.
        const months: { [key: string]: string } = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const day = dateMatch[2].padStart(2, '0');
        const monthStr = dateMatch[3].toLowerCase();
        const year = dateMatch[4];
        const month = months[monthStr];

        if (month) {
            // Default time to 19:00 (7 PM) as it's common for committees
            result.date = `${year}-${month}-${day}T19:00`;
        }
    }

    // 2. Extract Title
    // Look for "ASSEMBLÉE"
    const titleLine = lines.find(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleLine) {
        result.title = titleLine;
    }

    // 3. Extract Agenda Items
    // Look for lines starting with a number followed by a dot (e.g., "1. ")
    let currentItem: Partial<AgendaItem> | null = null;
    let itemOrder = 1;

    for (const line of lines) {
        const itemMatch = line.match(/^(\d+)\.\s+(.+)/);
        if (itemMatch) {
            // New item found
            if (currentItem && currentItem.title) {
                result.agendaItems?.push(currentItem as AgendaItem);
            }

            const order = parseInt(itemMatch[1]);
            // Simple check to ensure we are following a sequence (optional, but good for noise reduction)
            // if (order === itemOrder) {
            currentItem = {
                id: `imported-${Date.now()}-${order}`,
                order: order,
                title: itemMatch[2],
                duration: 15, // Default
                presenter: 'Coordonnateur', // Default
                objective: 'Information', // Default
                decision: ''
            };
            itemOrder++;
            // }
        } else if (currentItem) {
            // Append to current item title if it looks like continuation
            // We assume that if a line doesn't start with a number and we are inside an item, it belongs to that item.
            // We join with a space.
            currentItem.title += ' ' + line;
        }
    }
    // Push last item
    if (currentItem && currentItem.title) {
        result.agendaItems?.push(currentItem as AgendaItem);
    }

    return result;
};
