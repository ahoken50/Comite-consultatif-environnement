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

    // 1. Extract Date (Look for patterns like "Jeudi 9 juin 2022" or "Mardi 25 février 2025")
    // Regex for French date: DayName Day Month Year
    const dateRegex = /(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)?\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i;
    const dateMatch = fullText.match(dateRegex);
    if (dateMatch) {
        // Attempt to parse date. For simplicity, we might just return the string or try to format it.
        // Here we'll try to create a valid ISO string if possible, or just leave it for the user to verify if complex.
        // A robust implementation would map French month names to numbers.
        const months: { [key: string]: string } = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const day = dateMatch[1].padStart(2, '0');
        const monthStr = dateMatch[2].toLowerCase();
        const year = dateMatch[3];
        const month = months[monthStr];

        if (month) {
            // Default time to 17:00 (5 PM) as per user preference
            result.date = `${year}-${month}-${day}T17:00`;
        }
    }

    // 2. Extract Title
    // Look for "ASSEMBLÉE"
    const titleLine = lines.find(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleLine) {
        result.title = titleLine;
    }

    // 3. Extract Agenda Items
    // Look for lines starting with a number followed by a dot or space (e.g., "1. ", "2 ")
    let currentItem: Partial<AgendaItem> | null = null;
    let itemOrder = 1;

    for (const line of lines) {
        // Relaxed regex: Number, optional dot/paren, optional whitespace, then content
        // Also supports lines ending in semicolon
        const itemMatch = line.match(/^(\d+)[.)]?\s*(.*)/);

        // Check if it's a "pure" number line (e.g. "1." or "1") which suggests the text is on the next line
        const isNumberOnly = line.match(/^(\d+)[.)]?\s*$/);

        if (itemMatch && !isNumberOnly && itemMatch[2].length > 0) {
            // Standard case: "1. Title"
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
            // Case: "1." on its own line. Prepare for next line to be the title.
            if (currentItem && currentItem.title) {
                result.agendaItems?.push(currentItem as AgendaItem);
            }

            const order = parseInt(isNumberOnly[1]);
            currentItem = {
                id: `imported-${Date.now()}-${order}`,
                order: order,
                title: '', // Will be filled by next line
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Information',
                decision: ''
            };
            itemOrder++;
        } else if (currentItem) {
            // Append to current item title if it looks like continuation
            // If the title is empty (from NumberOnly case), this line IS the title.
            if (currentItem.title === '') {
                currentItem.title = line;
            } else {
                currentItem.title += ' ' + line;
            }
        }
    }
    // Push last item
    if (currentItem && currentItem.title) {
        result.agendaItems?.push(currentItem as AgendaItem);
    }

    return result;
};
