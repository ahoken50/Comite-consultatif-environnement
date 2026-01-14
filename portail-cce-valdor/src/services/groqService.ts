/**
 * Groq AI Service for PV Parsing
 * 
 * Uses Groq's fast inference API (free tier available) to extract
 * structured data from Procès-Verbaux documents.
 * 
 * @see https://console.groq.com/docs/quickstart
 */

import type { AgendaItem, MinuteEntry } from '../types/meeting.types';

// Groq API configuration
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Recommended model for structured output (fast and accurate)
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // Best for JSON extraction

/**
 * Response structure from AI extraction
 */
export interface AIExtractedPV {
    metadonnees: {
        ville?: string;
        date?: string;
        type?: string;
    };
    points_traites: Array<{
        ordre_du_jour_id: string;
        titre: string;
        discussion_verbatim: string;
        resolutions: Array<{
            code: string;
            type: 'resolution' | 'comment';
            considerants?: string[];
            dispositif?: string;
            contenu?: string;
            proposer?: string;
            seconder?: string;
        }>;
        commentaires?: Array<{
            code: string;
            contenu: string;
        }>;
    }>;
}

/**
 * Check if Groq API is configured
 */
export const isGroqConfigured = (): boolean => {
    return !!GROQ_API_KEY;
};

/**
 * Build the extraction prompt for PV parsing
 */
const buildPVExtractionPrompt = (
    rawText: string,
    agendaItems: AgendaItem[]
): string => {
    // Format agenda items as reference
    const odjList = agendaItems
        .map((item, i) => `${i + 1}. ${item.title}`)
        .join('\n');

    return `Tu es un extracteur de données rigoureux. Ton objectif est de structurer ce Procès-Verbal en JSON en utilisant l'Ordre du Jour comme structure de référence.

INSTRUCTIONS :
- Structure Maîtresse : Chaque entrée dans le JSON doit correspondre à un point de l'Ordre du Jour.
- Lien Hiérarchique : Pour chaque point, regroupe le contenu de la discussion et la résolution/commentaire associé.
- Fidélité Absolue : Ne reformule rien. Copie le texte intégral (Verbatim).
- Cas Spéciaux : Si un sujet de l'ordre du jour n'a pas été discuté, indique-le. Si un sujet est ajouté (ex: Varia), ajoute-le à la fin.
- Format : Produis uniquement du JSON pur, sans markdown.

## ORDRE DU JOUR (Structure de référence)
${odjList}

## TEXTE DU PROCÈS-VERBAL À ANALYSER
${rawText}

## FORMAT JSON ATTENDU (STRICT)
{
  "metadonnees": {
    "ville": "Val-d'Or",
    "date": "YYYY-MM-DD"
  },
  "points_traites": [
    {
      "ordre_du_jour_id": "1",
      "titre": "Titre du point",
      "discussion_verbatim": "Tout le texte de discussion verbatim...",
      "resolutions": [
        {
          "code": "03-07",
          "type": "resolution",
          "considerants": ["CONSIDÉRANT que...", "CONSIDÉRANT que..."],
          "dispositif": "IL EST RÉSOLU QUE...",
          "proposer": "Nom",
          "seconder": "Nom"
        }
      ],
      "commentaires": [
        {
          "code": "03-C",
          "contenu": "Texte verbatim du commentaire..."
        }
      ]
    }
  ]
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ni après.`;
};

/**
 * Extract structured PV data using Groq AI
 */
export const extractPVWithGroq = async (
    rawText: string,
    agendaItems: AgendaItem[]
): Promise<{ success: boolean; data?: AIExtractedPV; error?: string }> => {
    if (!GROQ_API_KEY) {
        return { success: false, error: 'Clé API Groq non configurée (VITE_GROQ_API_KEY)' };
    }

    if (!rawText || rawText.length < 100) {
        return { success: false, error: 'Texte du PV trop court ou vide' };
    }

    try {
        console.log('[groqService] Sending PV to Groq for extraction...');
        console.log(`[groqService] Text length: ${rawText.length} chars, ${agendaItems.length} agenda items`);

        const prompt = buildPVExtractionPrompt(rawText, agendaItems);

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'Tu es un assistant expert en extraction de données structurées. Tu retournes toujours du JSON valide.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1, // Low temperature for deterministic output
                max_tokens: 8000,
                response_format: { type: 'json_object' } // Force JSON output
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `Groq API error: ${response.status}`);
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('Réponse vide de Groq');
        }

        console.log('[groqService] Received response, parsing JSON...');

        // Parse the JSON response
        const data = JSON.parse(content) as AIExtractedPV;

        console.log(`[groqService] Successfully extracted ${data.points_traites?.length || 0} points`);

        return { success: true, data };

    } catch (error) {
        const err = error as Error;
        console.error('[groqService] Extraction error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Map AI-extracted PV to AgendaItems format
 * Merges extracted data with existing agenda items
 */
export const mapAIExtractedToAgendaItems = (
    aiData: AIExtractedPV,
    existingItems: AgendaItem[]
): AgendaItem[] => {
    console.log('[groqService] Mapping AI data to AgendaItems...');

    const updatedItems = [...existingItems];

    for (const point of aiData.points_traites) {
        // Find matching agenda item by ID or title similarity
        const itemIndex = parseInt(point.ordre_du_jour_id) - 1;
        const matchedItem = updatedItems[itemIndex];

        if (!matchedItem) {
            console.warn(`[groqService] No agenda item found for point ${point.ordre_du_jour_id}`);
            continue;
        }

        // Build MinuteEntries from resolutions and comments
        const minuteEntries: MinuteEntry[] = [];

        // Add resolutions
        if (point.resolutions) {
            for (const res of point.resolutions) {
                let content = '';

                if (res.considerants && res.considerants.length > 0) {
                    content += res.considerants.join('\n\n') + '\n\n';
                }

                if (res.dispositif) {
                    content += res.dispositif;
                }

                if (res.contenu) {
                    content = res.contenu; // For comments stored as resolutions
                }

                minuteEntries.push({
                    type: res.type || 'resolution',
                    number: res.code,
                    content: content.trim(),
                    proposer: res.proposer || '',
                    seconder: res.seconder || ''
                });
            }
        }

        // Add comments
        if (point.commentaires) {
            for (const com of point.commentaires) {
                minuteEntries.push({
                    type: 'comment',
                    number: com.code,
                    content: com.contenu,
                    proposer: '',
                    seconder: ''
                });
            }
        }

        // Update the agenda item
        updatedItems[itemIndex] = {
            ...matchedItem,
            minuteEntries: minuteEntries,
            decision: point.discussion_verbatim || matchedItem.decision,
            minuteType: minuteEntries[0]?.type,
            minuteNumber: minuteEntries[0]?.number
        };

        console.log(`[groqService] Updated item ${itemIndex + 1}: "${matchedItem.title}" with ${minuteEntries.length} entries`);
    }

    return updatedItems;
};

/**
 * Full parsing pipeline: Extract + Map
 */
export const parsePVWithGroq = async (
    rawText: string,
    existingAgendaItems: AgendaItem[]
): Promise<{ success: boolean; agendaItems?: AgendaItem[]; error?: string }> => {
    // Step 1: Extract with AI
    const extraction = await extractPVWithGroq(rawText, existingAgendaItems);

    if (!extraction.success || !extraction.data) {
        return { success: false, error: extraction.error };
    }

    // Step 2: Map to AgendaItems
    const agendaItems = mapAIExtractedToAgendaItems(extraction.data, existingAgendaItems);

    return { success: true, agendaItems };
};
