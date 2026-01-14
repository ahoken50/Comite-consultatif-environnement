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
    // Format agenda items as reference (or note if none)
    const hasODJ = agendaItems.length > 0;
    const odjSection = hasODJ
        ? `## ORDRE DU JOUR (Structure de référence)
${agendaItems.map((item, i) => `${i + 1}. ${item.title}`).join('\n')}`
        : '## NOTE: Aucun ordre du jour fourni. Identifie CHAQUE point discuté dans le PV comme un point séparé.';

    return `Tu es un extracteur de données VERBATIM pour procès-verbaux municipaux. Ton travail est CRUCIAL.

## RÈGLES ABSOLUES (NE JAMAIS DÉROGER)

1. **EXTRACTION INTÉGRALE** : Copie TOUT le texte de chaque section. Ne résume JAMAIS.
2. **VERBATIM** : Chaque phrase, chaque intervenant, chaque détail doit être préservé EXACTEMENT.
3. **STRUCTURE** : Chaque RÉSOLUTION (ex: "RÉSOLUTION 03-07") et COMMENTAIRE (ex: "COMMENTAIRE 03-C") doit être extrait avec son contenu COMPLET.
4. **DISCUSSIONS** : Le champ "discussion_verbatim" contient TOUT le texte AVANT la résolution/commentaire.
5. **CONSIDÉRANTS** : Liste COMPLÈTE de tous les CONSIDÉRANT/ATTENDU.
6. **IL EST RÉSOLU** : Le dispositif complet après "IL EST RÉSOLU".

${odjSection}

## TEXTE DU PROCÈS-VERBAL (EXTRAIT INTÉGRAL REQUIS)
${rawText}

## FORMAT JSON ATTENDU
{
  "metadonnees": {
    "ville": "Val-d'Or",
    "date": "YYYY-MM-DD",
    "titre_reunion": "Titre extrait du document"
  },
  "points_traites": [
    {
      "ordre_du_jour_id": "1",
      "titre": "Titre exact du point",
      "discussion_verbatim": "[TEXTE COMPLET de toute la discussion sur ce sujet - plusieurs paragraphes si nécessaire]",
      "resolutions": [
        {
          "code": "03-07",
          "type": "resolution",
          "considerants": ["CONSIDÉRANT que...(texte complet)...", "CONSIDÉRANT que...(texte complet)..."],
          "dispositif": "IL EST RÉSOLU [texte complet du dispositif]",
          "proposer": "Nom du proposeur si mentionné",
          "seconder": "Nom du secondeur si mentionné",
          "vote": "Adopté à l'unanimité / Abstention: Nom"
        }
      ],
      "commentaires": [
        {
          "code": "03-C",
          "contenu": "[TEXTE COMPLET du commentaire - plusieurs paragraphes]"
        }
      ]
    }
  ]
}

## RAPPEL FINAL
- Le JSON doit contenir L'INTÉGRALITÉ du texte du PV.
- Ne tronque AUCUN contenu.
- Retourne UNIQUEMENT le JSON valide, sans markdown.`;
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
                max_tokens: 32000, // Large to capture full verbatim content
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
