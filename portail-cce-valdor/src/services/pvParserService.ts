import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { type AgendaItem, type MinuteEntry } from '../types/meeting.types';
import { extractTextFromPDF } from './ocrService';
import { extractPVWithGroq, mapAIExtractedToAgendaItems } from './groqService';

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
    onProgress?: (message: string) => void,
    existingAgendaItems: AgendaItem[] = []
): Promise<ParsedPVData> => {
    // Use the OCR service which handles both native and scanned PDFs
    const result = await extractTextFromPDF(file, onProgress);

    if (!result.success || !result.text) {
        throw new Error(result.error || 'Impossible d\'extraire le texte du PDF');
    }

    // AI PATH: If we have agenda items, use the AI (much more robust)
    if (existingAgendaItems.length > 0) {
        try {
            if (onProgress) onProgress('Analyse par l\'IA en cours (double validation)...');

            const aiResult = await extractPVWithGroq(result.text, existingAgendaItems);

            if (aiResult.success && aiResult.data) {
                // Map AI result to agenda items (this handles the fuzzy matching/ID matching)
                const mappedItems = mapAIExtractedToAgendaItems(aiResult.data, existingAgendaItems);

                return {
                    agendaItems: mappedItems,
                    wasScanned: result.isScanned,
                    // Parse attendees from text manually or via regex if needed, 
                    // or maybe the AI extracted it? (Current prompt focuses on points)
                    // We can fallback to regex for attendees:
                    attendees: extractAttendeesFromText(result.text)
                };
            }
        } catch (e) {
            console.warn('AI parsing failed, falling back to Regex:', e);
            if (onProgress) onProgress('Échec IA, passage au mode Regex...');
        }
    }

    // REGEX FALLBACK (Historical logic)
    const parsed = parseRawTextToPV(result.text);

    return {
        ...parsed,
        wasScanned: result.isScanned
    };
};

// Helper for attendees (since regex parser does it inside)
const extractAttendeesFromText = (text: string): string[] => {
    const attendees: string[] = [];
    const lines = text.split('\n');
    let capturing = false;

    for (const line of lines) {
        if (/^(ÉTAIENT|SONT)\s+(PRÉSENTS|PRESENTES)/i.test(line)) {
            capturing = true;
            continue;
        }
        if (capturing) {
            if (/^(ÉTAIENT|SONT)\s+(ABSENTS|ABSENTES)/i.test(line) || /^[A-Z0-9]/.test(line)) {
                capturing = false;
            } else {
                const names = line.split(',').map(n => n.trim()).filter(n => n.length > 3);
                attendees.push(...names);
            }
        }
    }
    return attendees;
};

// ... keep regex logic below ...

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
// Intermediate structure
interface ParsedSection {
    title: string;
    content: string[];
    entries: {
        type: 'resolution' | 'comment';
        number: string;
        content: string[];
        proposer?: string;
        seconder?: string;
    }[];
}

const parseRawTextToPV = (text: string): ParsedPVData => {
    // 1. Text Cleanup / Normalization
    // Fix weird PDF spacing in numbers (e.g. "0 7 - 3 1" -> "07-31")
    let cleanText = text.replace(/R[ÉE]SOLUTION\s+((?:\d\s*)+)-((?:\s*\d)+)/gi, (_, p1, p2) => {
        return `RÉSOLUTION ${p1.replace(/\s/g, '')}-${p2.replace(/\s/g, '')}`;
    });
    cleanText = cleanText.replace(/COMMENTAIRE\s+((?:\d\s*)+)-((?:\s*[A-Z])+)/gi, (_, p1, p2) => {
        return `COMMENTAIRE ${p1.replace(/\s/g, '')}-${p2.replace(/\s/g, '')}`;
    });

    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l);

    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentEntry: ParsedSection['entries'][0] | null = null;
    let recentLines: string[] = []; // To capture titles that appeared before we realized (e.g. Resolution detected)

    // Improved Regex Definitions
    // Handle optional bullet points, spaces, and diverse separators
    const resolutionRegex = /^(?:[•-]\s*)?R[ÉE]SOLUTION[\s\.]*[\d\s]*(\d{2})[-–—.](\d+)/i;
    // Allow flexible spacing after Commentaire
    const commentaireRegex = /^(?:[•-]\s*)?COMMENTAIRE[\s\.]*[\d\s]*(\d{2})[-–—.]?([A-Z])/i;

    const proposerRegex = /(?:Propos[ée] par|Sur la proposition de)\s*[:\s](.*)/i;
    const seconderRegex = /(?:Appuy[ée] par|Et l['’]appui de)\s*[:\s](.*)/i;

    // Heuristics for Title Detection in Plain Text
    const isTitleCandidate = (line: string): boolean => {
        // Must be reasonably short
        if (line.length > 200) return false;

        // Should not start with metadata keywords
        if (/^(ÉTAIENT|ABSENT|PRÉSENT|PROCÈS|M\.|Mme|RÉSOLUTION|COMMENTAIRE)/i.test(line)) return false;

        // Strong indicators
        if (/^(Adoption|Retour|Suivi|Présentation|Varia|Mot de bienvenue|Levée)/i.test(line)) return true;

        // Numbered list item (e.g. "4.1 Some Title")
        if (/^(\d+(\.\d+)*)\.?\s+[A-ZÀ-Ÿ]/.test(line)) return true;

        // Capitalized start but not a sentence ending with dot
        // Also reject lines that look like a person's name (M. something) - handled above
        if (/^[A-ZÀ-Ÿ]/.test(line)) {
            if (line.endsWith('.')) return false;
            // Reject if it looks like just a date
            if (/^\d{1,2}\s+[a-zéû]+\s+\d{4}$/i.test(line)) return false;
            return true;
        }

        return false;
    };

    const closeCurrentSection = () => {
        if (currentSection) {
            sections.push(currentSection);
            currentSection = null;
            currentEntry = null;
        }
    };

    const startNewSection = (title: string) => {
        closeCurrentSection();
        currentSection = {
            title: title,
            content: [],
            entries: []
        };
    };

    for (const line of lines) {
        // --- 1. DETECT RESOLUTION / COMMENT ---
        // We trim start to ignore indentation
        const cleanLine = line.trimStart();
        const resMatch = cleanLine.match(resolutionRegex);
        const comMatch = cleanLine.match(commentaireRegex);

        if (resMatch) {
            // If no current section, try to recover a title
            if (!currentSection) {
                // Look for the best title candidate in recent lines
                // Prefer the line immediately preceding, unless it looks like noise
                let fallbackTitle = 'Point sans titre';
                if (recentLines.length > 0) {
                    // Check matching item in recent lines
                    const last = recentLines[recentLines.length - 1];
                    if (isTitleCandidate(last)) fallbackTitle = last;
                }
                startNewSection(fallbackTitle);
            }

            currentEntry = {
                type: 'resolution',
                number: `${resMatch[1]}-${resMatch[2]}`,
                content: []
            };
            currentSection!.entries.push(currentEntry);
            recentLines = [];
            continue;
        }

        if (comMatch) {
            if (!currentSection) {
                let fallbackTitle = 'Point sans titre';
                if (recentLines.length > 0) {
                    const last = recentLines[recentLines.length - 1];
                    if (isTitleCandidate(last)) fallbackTitle = last;
                }
                startNewSection(fallbackTitle);
            }

            currentEntry = {
                type: 'comment',
                number: `${comMatch[1]}-${comMatch[2].toUpperCase()}`,
                content: []
            };
            currentSection!.entries.push(currentEntry);
            recentLines = [];
            continue;
        }

        // --- 2. DETECT LEVÉE ---
        const isLevee = /lev[ée]e\s+de\s+l['’]?\s*assembl[ée]e/i.test(line);
        if (isLevee) {
            startNewSection(line.trim());
            recentLines = [];
            continue;
        }

        // --- 3. DETECT NEW SECTION (TITLE) ---
        if (isTitleCandidate(line)) {
            const numberedTitleMatch = line.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)/);

            // Prioritize strong keywords
            const isStrongTitle = numberedTitleMatch ||
                /^(Adoption|Retour|Présentation|Varia|Mot de bienvenue|Correspondance|Dépôt)/i.test(line);

            if (isStrongTitle) {
                // Verify we aren't inside a resolution block (resolutions rarely have titles inside them)
                // But sometimes a new point starts immediately. 
                // We'll trust strong titles.
                const titleText = numberedTitleMatch ? numberedTitleMatch[2] : line;
                startNewSection(titleText);
                recentLines = [];
                continue;
            }
            // Logic for weak titles: they stay candidates in recentLines
        }

        // --- 4. DATA EXTRACTION ---
        const propMatch = line.match(proposerRegex);
        const secMatch = line.match(seconderRegex);

        if (propMatch && currentSection) {
            if (currentEntry) currentEntry.proposer = propMatch[1].trim();
            // Don't continue, might contain other info
        }
        if (secMatch && currentSection) {
            if (currentEntry) currentEntry.seconder = secMatch[1].trim();
            // Don't continue
        }

        // --- 5. CONTENT ---
        if (currentSection) {
            const activeSection = currentSection as ParsedSection;
            // Filter noise (page numbers)
            if (/^page \d+/i.test(line)) continue;

            // Filter header repetition
            if (/^PROCES-VERBAL/i.test(line)) continue;

            if (currentEntry) {
                // Clean up proposer/seconder lines from content if they were just extracted
                if (!propMatch && !secMatch) {
                    currentEntry.content.push(line);
                }
            } else {
                activeSection.content.push(line);
            }
        }

        recentLines.push(line);
        if (recentLines.length > 5) recentLines.shift(); // Keep a bit more history
    }

    closeCurrentSection();

    // Conversion
    const agendaItems: AgendaItem[] = sections.map((section, index) => {
        const minuteEntries: MinuteEntry[] = section.entries.map(e => ({
            type: e.type,
            number: e.number,
            content: e.content.join('\n').trim(),
            proposer: e.proposer,
            seconder: e.seconder
        }));

        const hasResolution = section.entries.some(e => e.type === 'resolution');

        // Safe finding logic
        const resolutionEntry = minuteEntries.find(e => e.type === 'resolution');

        const mainDecisionText = hasResolution && resolutionEntry
            ? resolutionEntry.content
            : section.content.join('\n').trim();

        return {
            id: `pv-import-${Date.now()}-${index}`,
            order: index + 1,
            title: section.title,
            minuteEntries: minuteEntries,
            decision: mainDecisionText,
            duration: 10,
            presenter: 'Coordonnateur',
            objective: hasResolution ? 'Décision' : 'Information',
            description: '',
            minuteType: section.entries[0]?.type,
            minuteNumber: section.entries[0]?.number,
            proposer: section.entries[0]?.proposer || '',
            seconder: section.entries[0]?.seconder || ''
        } as AgendaItem;
    });

    return { agendaItems };
};
