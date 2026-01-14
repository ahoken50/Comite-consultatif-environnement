import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';
import { extractTextFromPDF } from './ocrService';

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
    wasScanned?: boolean; // Indicates if OCR was used
}

// ============================================================================
// PDF PARSING LOGIC FOR PV (with automatic OCR for scanned PDFs)
// ============================================================================
export const parseMinutesPDF = async (
    file: File,
    onProgress?: (message: string) => void
): Promise<ParsedPVData> => {
    // Use the OCR service which handles both native and scanned PDFs
    const result = await extractTextFromPDF(file, onProgress);

    if (!result.success || !result.text) {
        throw new Error(result.error || 'Impossible d\'extraire le texte du PDF');
    }

    const parsed = parseRawTextToPV(result.text);

    return {
        ...parsed,
        wasScanned: result.isScanned
    };
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

    let currentMinuteEntry: MinuteEntry | null = null;
    let recentLines: string[] = []; // Track recent lines to use as implicit titles

    for (const line of lines) {
        // 1. Detect New Agenda Item (Numbered)
        const itemMatch = line.match(itemStartRegex);
        // Ignore simple dates or page numbers
        const isDate = /^\d{1,2}\s+[a-z]+\s+\d{4}/i.test(line);
        const isPageNum = /^\d+$/.test(line);

        // Explicit Numbered Item
        if (itemMatch && !isDate && !isPageNum && itemMatch[2].length > 5) {
            // Push previous item
            if (currentItem && currentItem.title) {
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
            recentLines = [];
            continue;
        }

        // 1.5 Special Case: Levée de l'assemblée (Unnumbered)
        const isLevee = /lev[ée]e\s+de\s+l['’]?\s*assembl[ée]e/i.test(line);
        if (isLevee) {
            if (currentItem && currentItem.title) {
                if (currentMinuteEntry) {
                    if (!currentItem.minuteEntries) currentItem.minuteEntries = [];
                    currentItem.minuteEntries.push(currentMinuteEntry);
                    currentMinuteEntry = null;
                }
                agendaItems.push(currentItem as AgendaItem);
            }

            currentItem = {
                id: `pv-import-${Date.now()}-${agendaItems.length}`,
                order: agendaItems.length + 1,
                title: line.trim(),
                minuteEntries: [],
                decision: '',
                duration: 5,
                presenter: ''
            };
            recentLines = [];
            continue;
        }

        // 2. Detect Resolution
        const resMatch = line.match(resolutionRegex);
        if (resMatch) {
            // CRITICAL FIX: If we found a resolution but have no currentItem (failed to detect title),
            // OR if the current item is very old, try to creating a new one from context.
            if (!currentItem) {
                // Try to use the last significant line as a title
                const fallbackTitle = recentLines.length > 0
                    ? recentLines[recentLines.length - 1]
                    : 'Point sans titre';

                currentItem = {
                    id: `pv-import-${Date.now()}-${agendaItems.length}`,
                    order: agendaItems.length + 1,
                    title: fallbackTitle,
                    minuteEntries: [],
                    decision: '',
                };
            }

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

        // 3. Detect Proposer/Seconder
        const propMatch = line.match(proposerRegex);
        const secMatch = line.match(seconderRegex);

        if (propMatch && currentItem) {
            // Applies to the *current resolution* if exists, or the item
            if (currentMinuteEntry) {
                currentMinuteEntry.proposer = propMatch[1].trim();
            } else {
                currentItem.proposer = propMatch[1].trim();
            }
        }
        if (secMatch && currentItem) {
            if (currentMinuteEntry) {
                currentMinuteEntry.seconder = secMatch[1].trim();
            } else {
                currentItem.seconder = secMatch[1].trim();
            }
        }

        // 4. Capture Content for Resolution
        if (currentMinuteEntry) {
            // Stop capturing if we hit metadat keywords
            if (!propMatch && !secMatch && !line.match(/R[ÉE]SOLU/)) {
                currentMinuteEntry.content += (currentMinuteEntry.content ? '\n' : '') + line;
            }
        } else {
            // Keep track of lines that might be titles for the NEXT item
            // Only keep if it looks like a title (short-ish)
            if (line.length < 150 && !isDate && !isPageNum) {
                recentLines.push(line);
                if (recentLines.length > 3) recentLines.shift(); // Keep last 3
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
