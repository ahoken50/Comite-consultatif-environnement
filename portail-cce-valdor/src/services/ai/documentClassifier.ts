/**
 * Document Classifier Service (#4.4)
 * Uses AI to automatically categorize documents based on their content
 */

import type { DocumentCategory } from '../../types/document.types';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

interface ClassificationResult {
    success: boolean;
    category?: DocumentCategory;
    confidence?: number;
    error?: string;
}

/**
 * Check if classifier is configured
 */
export const isClassifierConfigured = (): boolean => {
    return !!GROQ_API_KEY;
};

/**
 * Classify a document based on its name and content
 */
export const classifyDocument = async (
    fileName: string,
    textContent: string
): Promise<ClassificationResult> => {
    if (!isClassifierConfigured()) {
        return {
            success: false,
            error: 'Classificateur non configuré'
        };
    }

    // First try to classify by filename patterns
    const fileNameLower = fileName.toLowerCase();

    if (fileNameLower.includes('pv') || fileNameLower.includes('procès-verbal') || fileNameLower.includes('proces-verbal')) {
        return { success: true, category: 'pv', confidence: 0.95 };
    }
    if (fileNameLower.includes('résolution') || fileNameLower.includes('resolution')) {
        return { success: true, category: 'resolution', confidence: 0.95 };
    }
    if (fileNameLower.includes('odj') || fileNameLower.includes('ordre du jour')) {
        return { success: true, category: 'odj', confidence: 0.95 };
    }
    if (fileNameLower.includes('présentation') || fileNameLower.includes('presentation') || fileNameLower.endsWith('.pptx')) {
        return { success: true, category: 'presentation', confidence: 0.90 };
    }
    if (fileNameLower.includes('rapport') || fileNameLower.includes('report')) {
        return { success: true, category: 'report', confidence: 0.90 };
    }
    if (fileNameLower.includes('annexe') || fileNameLower.includes('attachment')) {
        return { success: true, category: 'annexe', confidence: 0.85 };
    }
    if (fileNameLower.includes('permis') || fileNameLower.includes('certificat')) {
        return { success: true, category: 'permit', confidence: 0.90 };
    }
    if (fileNameLower.includes('contrat') || fileNameLower.includes('entente')) {
        return { success: true, category: 'contract', confidence: 0.90 };
    }

    // If no clear pattern, use AI classification
    if (!textContent || textContent.length < 50) {
        return { success: true, category: 'other', confidence: 0.5 };
    }

    const prompt = `Tu es un assistant qui classe des documents municipaux.

Catégories disponibles:
- pv: Procès-verbal de réunion
- resolution: Résolution officielle
- odj: Ordre du jour
- presentation: Présentation (slides)
- report: Rapport ou étude
- annexe: Document annexe ou pièce jointe
- permit: Permis ou certificat
- contract: Contrat ou entente
- other: Autre type de document

Fichier: ${fileName}
Extrait du contenu (premiers 500 caractères):
${textContent.substring(0, 500)}

Réponds UNIQUEMENT avec la catégorie (un seul mot parmi la liste) et un score de confiance entre 0 et 1, au format:
CATÉGORIE|SCORE

Exemple: pv|0.85`;

    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 50
            })
        });

        if (!response.ok) {
            return { success: true, category: 'other', confidence: 0.3 };
        }

        const data = await response.json();
        const result = data.choices?.[0]?.message?.content?.trim();

        if (result) {
            const [category, scoreStr] = result.split('|');
            const score = parseFloat(scoreStr) || 0.5;
            const validCategories: DocumentCategory[] = [
                'pv', 'resolution', 'odj', 'presentation', 'report',
                'annexe', 'permit', 'contract', 'other'
            ];

            if (validCategories.includes(category as DocumentCategory)) {
                return {
                    success: true,
                    category: category as DocumentCategory,
                    confidence: Math.min(1, Math.max(0, score))
                };
            }
        }

        return { success: true, category: 'other', confidence: 0.3 };
    } catch (error) {
        console.error('Classification error:', error);
        return { success: true, category: 'other', confidence: 0.3 };
    }
};

/**
 * Get human-readable label for a document category
 */
export const getCategoryLabel = (category: DocumentCategory): string => {
    const labels: Record<DocumentCategory, string> = {
        pv: 'Procès-verbal',
        resolution: 'Résolution',
        odj: 'Ordre du jour',
        presentation: 'Présentation',
        report: 'Rapport',
        annexe: 'Annexe',
        permit: 'Permis/Certificat',
        contract: 'Contrat',
        other: 'Autre'
    };
    return labels[category] || 'Autre';
};

/**
 * Get color for a document category chip
 */
export const getCategoryColor = (category: DocumentCategory): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    const colors: Record<DocumentCategory, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
        pv: 'primary',
        resolution: 'success',
        odj: 'info',
        presentation: 'secondary',
        report: 'warning',
        annexe: 'default',
        permit: 'error',
        contract: 'warning',
        other: 'default'
    };
    return colors[category] || 'default';
};
