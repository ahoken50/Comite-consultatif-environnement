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
    // 1. Text Cleanup / Normalization
    // Fix weird PDF spacing in numbers (e.g. "0 7 - 3 1" -> "07-31")
    let cleanText = text.replace(/R[ÉE]SOLUTION\s+((?:\d\s*)+)-((?:\s*\d)+)/gi, (match, p1, p2) => {
        return `RÉSOLUTION ${p1.replace(/\s/g, '')}-${p2.replace(/\s/g, '')}`;
    });
    cleanText = cleanText.replace(/COMMENTAIRE\s+((?:\d\s*)+)-((?:\s*[A-Z])+)/gi, (match, p1, p2) => {
        return `COMMENTAIRE ${p1.replace(/\s/g, '')}-${p2.replace(/\s/g, '')}`;
    });

    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l);

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

    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentEntry: ParsedSection['entries'][0] | null = null;
    let recentLines: string[] = []; // To capture titles that appeared before we realized (e.g. Resolution detected)

    // Regex Definitions
    const resolutionRegex = /^R[ÉE]SOLUTION\s*[\d\s]*(\d{2})[-–—.](\d+)/i;
    // Allow flexible spacing after Commentaire
    const commentaireRegex = /^COMMENTAIRE\s*[\d\s]*(\d{2})[-–—.]?([A-Z])/i;

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

        // Capitalized start but not a sentence ending with dot
        if (/^[A-Z]/.test(line)) {
            if (line.endsWith('.')) return false;
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
        const resMatch = line.match(resolutionRegex);
        const comMatch = line.match(commentaireRegex);

        if (resMatch) {
            // If no current section, try to recover a title
            if (!currentSection) {
                const fallbackTitle = recentLines.length > 0 ? recentLines[recentLines.length - 1] : 'Point sans titre';
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
                const fallbackTitle = recentLines.length > 0 ? recentLines[recentLines.length - 1] : 'Point sans titre';
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

            const isStrongTitle = numberedTitleMatch ||
                /^(Adoption|Retour|Présentation|Varia|Mot de bienvenue)/i.test(line);

            if (isStrongTitle) {
                startNewSection(line);
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
            continue;
        }
        if (secMatch && currentSection) {
            if (currentEntry) currentEntry.seconder = secMatch[1].trim();
            continue;
        }

        // --- 5. CONTENT ---
        if (currentSection) {
            // Filter noise (page numbers)
            if (/^page \d+/i.test(line)) continue;

            if (currentEntry) {
                currentEntry.content.push(line);
            } else {
                currentSection.content.push(line);
            }
        }

        recentLines.push(line);
        if (recentLines.length > 3) recentLines.shift();
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
        const mainDecisionText = hasResolution
            ? minuteEntries.find(e => e.type === 'resolution')?.content || ''
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
