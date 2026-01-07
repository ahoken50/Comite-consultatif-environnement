import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';

// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

// Set worker source
if (typeof window !== 'undefined' && (pdfjsLib as any).GlobalWorkerOptions) {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;
}

interface ParsedPVData {
    agendaItems: AgendaItem[];
    attendees?: string[]; // Added to match MinutesEditor expectations
    globalNotes?: string;
}

// ============================================================================
// PDF PARSING LOGIC FOR PV
// ============================================================================
export const parseMinutesPDF = async (file: File): Promise<ParsedPVData> => {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join('\n');
        fullText += pageText + '\n';
    }

    return parseRawTextToPV(fullText);
};

// ============================================================================
// DOCX PARSING LOGIC FOR PV
// ============================================================================
export const parseMinutesDOCX = async (file: File): Promise<ParsedPVData> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    const fullText = result.value;

    return parseRawTextToPV(fullText);
};

// ============================================================================
// SHARED TEXT PARSING LOGIC (The Core "PV" Logic)
// ============================================================================
const parseRawTextToPV = (text: string): ParsedPVData => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const agendaItems: AgendaItem[] = [];
    let currentItem: Partial<AgendaItem> | null = null;

    // Regex Definitions specific to PV
    const itemStartRegex = /^(\d+(?:\.\d+)*)\.?\s+(.*)/; // "4.1 Titre"
    const resolutionRegex = /R[ÉE]SOLUTION\s+(\d{2}-\d+)/i; // "RÉSOLUTION 23-100"
    const proposerRegex = /(?:Propos[ée] par|Sur la proposition de)\s*[:\s](.*)/i;
    const seconderRegex = /(?:Appuy[ée] par|Et l['’]appui de)\s*[:\s](.*)/i;
    // const voteRegex = /(?:Adopt[ée] [àa] l['’]unanimit[ée]|Vote\s*:\s*(.*))/i;

    let currentMinuteEntry: MinuteEntry | null = null;

    for (const line of lines) {
        // 1. Detect New Agenda Item (e.g., "4.1 Adoption...")
        // Ignore simple numbers or dates
        const itemMatch = line.match(itemStartRegex);
        const isDate = /^\d{1,2}\s+[a-z]+\s+\d{4}/i.test(line);

        if (itemMatch && !isDate && itemMatch[2].length > 5) {
            // Push previous item
            if (currentItem && currentItem.title) {
                // Determine implicit decision if present
                if (currentMinuteEntry) {
                    if (!currentItem.minuteEntries) currentItem.minuteEntries = [];
                    currentItem.minuteEntries.push(currentMinuteEntry);
                    currentMinuteEntry = null;
                }
                agendaItems.push(currentItem as AgendaItem);
            }

            // Start new item
            currentItem = {
                id: `pv-import-${Date.now()}-${agendaItems.length}`,
                order: agendaItems.length + 1,
                title: itemMatch[2],
                minuteEntries: [],
                decision: '',
                duration: 10,
                presenter: ''
            };
            continue;
        }

        // 2. Detect Resolution
        const resMatch = line.match(resolutionRegex);
        if (resMatch && currentItem) {
            // If we had a previous entry pending, push it
            if (currentMinuteEntry) {
                if (!currentItem.minuteEntries) currentItem.minuteEntries = [];
                currentItem.minuteEntries.push(currentMinuteEntry);
            }

            // Start new resolution entry
            currentMinuteEntry = {
                type: 'resolution',
                number: resMatch[1],
                content: ''
            };
            continue;
        }

        // 3. Detect Proposer/Seconder (Metadata for the current resolution)
        const propMatch = line.match(proposerRegex);
        const secMatch = line.match(seconderRegex);

        if (propMatch && currentItem) {
            // Often stored on the item itself in legacy mode, or could be part of resolution content
            currentItem.proposer = propMatch[1].trim();
        }
        if (secMatch && currentItem) {
            currentItem.seconder = secMatch[1].trim();
        }

        // 4. Capture Content for Resolution
        if (currentMinuteEntry) {
            // Stop capturing if we hit metadata keywords
            if (!propMatch && !secMatch && !line.match(/R[ÉE]SOLU/)) {
                currentMinuteEntry.content += (currentMinuteEntry.content ? '\n' : '') + line;
            }
        }
    }

    // Push last item
    if (currentItem && currentItem.title) {
        if (currentMinuteEntry) {
            if (!currentItem.minuteEntries) currentItem.minuteEntries = [];
            currentItem.minuteEntries.push(currentMinuteEntry);
        }
        agendaItems.push(currentItem as AgendaItem);
    }

    return { agendaItems };
};
