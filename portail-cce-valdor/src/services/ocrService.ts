/**
 * OCR Service using Gemini Vision for scanned PDFs
 * Uses Gemini 2.0 Flash (cheapest option with vision capabilities)
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

// Set worker source
if (typeof window !== 'undefined' && (pdfjsLib as any).GlobalWorkerOptions) {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;
}

// Environment variable for Gemini API key
const GEMINI_API_KEY = import.meta.env.VITE_GOOGLE_AI_API;

// Gemini Flash endpoint (cheapest with vision)
const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface OCRResult {
    success: boolean;
    text?: string;
    pageCount?: number;
    isScanned?: boolean;
    error?: string;
}

/**
 * Check if API is configured
 */
export const isOCRConfigured = (): boolean => {
    return !!GEMINI_API_KEY;
};

/**
 * Analyze extracted text quality to determine if PDF is usable native or needs OCR
 * Returns true if text appears to be real, readable content
 */
const analyzeTextQuality = (text: string, pageCount: number): { isUsable: boolean; reason: string } => {
    const cleanText = text.trim();

    // Check 1: Minimum total length
    if (cleanText.length < 50) {
        return { isUsable: false, reason: 'Texte trop court' };
    }

    // Check 2: Count actual words (3+ letters)
    const words = cleanText.match(/[a-zA-ZàâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]{3,}/g) || [];
    const wordCount = words.length;
    const avgWordsPerPage = wordCount / pageCount;

    // Less than 10 real words per page = likely scanned or garbage
    if (avgWordsPerPage < 10) {
        return { isUsable: false, reason: `Seulement ${avgWordsPerPage.toFixed(1)} mots/page` };
    }

    // Check 3: Look for common French words (indicates real text)
    const commonFrenchWords = ['de', 'la', 'le', 'les', 'des', 'du', 'et', 'en', 'un', 'une', 'que', 'qui', 'pour', 'dans', 'sur', 'par', 'est', 'sont', 'avec', 'au', 'aux'];
    const lowerText = cleanText.toLowerCase();
    const frenchWordCount = commonFrenchWords.filter(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        return (lowerText.match(regex) || []).length > 0;
    }).length;

    // If less than 5 common French words found, suspicious
    if (frenchWordCount < 5) {
        return { isUsable: false, reason: 'Peu de mots français détectés' };
    }

    // Check 4: Character/word ratio (real text is ~5-8 chars/word, garbage is often higher or lower)
    const avgCharsPerWord = cleanText.length / wordCount;
    if (avgCharsPerWord < 2 || avgCharsPerWord > 15) {
        return { isUsable: false, reason: 'Ratio caractères/mots anormal' };
    }

    // Check 5: Punctuation presence (real documents have some)
    const punctuationCount = (cleanText.match(/[.,;:!?]/g) || []).length;
    if (punctuationCount < 2) {
        return { isUsable: false, reason: 'Pas de ponctuation détectée' };
    }

    return { isUsable: true, reason: 'Texte valide' };
};

/**
 * Extract text from a PDF file, with automatic OCR fallback for scanned PDFs
 * 
 * Flow:
 * 1. Try to extract text using pdfjs-dist
 * 2. If text is too short relative to page count, assume it's scanned
 * 3. Convert pages to images and use Gemini Vision for OCR
 */
export const extractTextFromPDF = async (
    file: File,
    onProgress?: (message: string) => void
): Promise<OCRResult> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        // @ts-ignore
        const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
        const pageCount = pdf.numPages;

        onProgress?.(`Analyse du PDF (${pageCount} page${pageCount > 1 ? 's' : ''})...`);

        // Step 1: Try standard text extraction
        let fullText = '';
        for (let i = 1; i <= pageCount; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
        }

        // Step 2: Analyze text quality to determine if it's a scanned PDF
        // Simple char count is not enough - scanned PDFs can have invisible text or metadata
        const textQuality = analyzeTextQuality(fullText, pageCount);

        if (textQuality.isUsable) {
            // Regular PDF with extractable, usable text
            onProgress?.('Texte extrait avec succès (PDF natif)');
            return {
                success: true,
                text: fullText,
                pageCount,
                isScanned: false
            };
        }

        // Step 3: Scanned PDF - Use Gemini Vision OCR
        onProgress?.('PDF scanné détecté - OCR en cours avec IA...');

        if (!GEMINI_API_KEY) {
            return {
                success: false,
                error: 'Clé API Gemini non configurée. L\'OCR des PDF scannés nécessite une API.',
                isScanned: true
            };
        }

        // Convert pages to images and OCR
        const ocrText = await ocrPDFWithGemini(pdf, pageCount, onProgress);

        return {
            success: true,
            text: ocrText,
            pageCount,
            isScanned: true
        };

    } catch (error) {
        console.error('PDF extraction error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur d\'extraction du PDF'
        };
    }
};

/**
 * Convert PDF pages to images and OCR using Gemini Vision
 */
const ocrPDFWithGemini = async (
    pdf: any,
    pageCount: number,
    onProgress?: (message: string) => void
): Promise<string> => {
    const allText: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
        onProgress?.(`OCR page ${i}/${pageCount}...`);

        const page = await pdf.getPage(i);

        // Render page to canvas
        const scale = 2; // Higher resolution for better OCR
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('Impossible de créer le contexte canvas');
        }

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        // Convert to base64 JPEG (smaller than PNG)
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];

        // Send to Gemini Vision for OCR
        const pageText = await geminiOCR(imageBase64, i, pageCount);
        allText.push(pageText);

        // Clean up
        canvas.remove();
    }

    return allText.join('\n\n---\n\n');
};

/**
 * Call Gemini Vision API for OCR on a single image
 */
const geminiOCR = async (
    imageBase64: string,
    pageNum: number,
    totalPages: number
): Promise<string> => {
    const prompt = `Tu es un système OCR de haute précision. Extrait TOUT le texte visible de cette image de document scanné.

RÈGLES :
1. Transcris le texte EXACTEMENT comme il apparaît (y compris les en-têtes, numéros, dates)
2. Préserve la structure (titres, paragraphes, listes)
3. Si un tableau est présent, formate-le clairement
4. Ignore les artefacts de scan (taches, lignes parasites)
5. Si une partie est illisible, indique [illisible]

Page ${pageNum} sur ${totalPages}.

Retourne uniquement le texte extrait, sans commentaires.`;

    const response = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: imageBase64
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1, // Low temperature for accuracy
                maxOutputTokens: 4096
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `Erreur API Gemini: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        return `[Page ${pageNum} - Aucun texte détecté]`;
    }

    return text;
};

/**
 * OCR a single image file (not PDF)
 */
export const ocrImage = async (file: File): Promise<OCRResult> => {
    if (!GEMINI_API_KEY) {
        return { success: false, error: 'Clé API Gemini non configurée' };
    }

    try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const text = await geminiOCR(base64, 1, 1);

        return {
            success: true,
            text,
            pageCount: 1,
            isScanned: true
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur OCR'
        };
    }
};
