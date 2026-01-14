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
        titre_reunion?: string;
    };
    presences: {
        presents: Array<{
            nom: string;
            role?: string; // président, vice-président, secrétaire, membre, conseiller, etc.
        }>;
        absents?: Array<{
            nom: string;
            role?: string;
        }>;
    };
    points_traites: Array<{
        ordre_du_jour_id: string;
        titre: string;
        discussion_verbatim: string;
        // Un seul point ODJ peut contenir PLUSIEURS résolutions et commentaires
        resolutions: Array<{
            code: string;
            type: 'resolution' | 'comment';
            considerants?: string[];
            dispositif?: string;
            contenu?: string; // For comments or raw text
            tableaux?: string; // Tables as formatted text (markdown-style)
            proposer?: string;
            seconder?: string;
            vote?: string;
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

### 1. EXTRACTION DES PRÉSENCES
- Extrait TOUS les noms mentionnés dans "ÉTAIENT PRÉSENTES/PRÉSENTS" ou "ÉTAIENT AUSSI PRÉSENT"
- Identifie leur rôle si mentionné (présidente, vice-président, secrétaire, conseiller, membre)
- Extrait aussi les absents si mentionnés

### 2. EXTRACTION INTÉGRALE VERBATIM
- Copie TOUT le texte de chaque section. Ne résume JAMAIS.
- Chaque phrase, chaque intervenant, chaque détail doit être préservé EXACTEMENT.

### 3. UN POINT ODJ = PLUSIEURS RÉSOLUTIONS/COMMENTAIRES POSSIBLES
- IMPORTANT: Un seul point de l'ordre du jour peut contenir PLUSIEURS résolutions ET commentaires.
- Exemple: Le point "Renouvellement des mandats" peut contenir RÉSOLUTION 03-04, COMMENTAIRE 03-A, ET RÉSOLUTION 03-05.
- Regroupe-les tous sous le même point ODJ dans le JSON.

### 4. TABLEAUX
- Si une résolution contient un tableau (ex: liste de mandats), convertis-le en texte formaté.
- Utilise le format: "| Colonne1 | Colonne2 |" ou une liste à puces.
- Place le tableau dans le champ "tableaux" de la résolution.

### 5. CONSIDÉRANTS ET DISPOSITIF
- Liste COMPLÈTE de tous les CONSIDÉRANT/ATTENDU.
- Le dispositif complet après "IL EST RÉSOLU".

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
  "presences": {
    "presents": [
      {"nom": "Patricia Boutin", "role": "présidente"},
      {"nom": "Donald Ratté", "role": "vice-président"},
      {"nom": "Michaël Ross", "role": "secrétaire"},
      {"nom": "Benjamin Turcotte", "role": "conseiller responsable"},
      {"nom": "Luc Bossé", "role": "membre"}
    ],
    "absents": []
  },
  "points_traites": [
    {
      "ordre_du_jour_id": "3",
      "titre": "Renouvellement des mandats des membres du CCE",
      "discussion_verbatim": "[Texte de discussion AVANT les résolutions]",
      "resolutions": [
        {
          "code": "03-04",
          "type": "resolution",
          "considerants": ["CONSIDÉRANT que..."],
          "dispositif": "IL EST RÉSOLU...",
          "tableaux": "| SIÈGE | NOM | DÉBUT MANDAT | FIN MANDAT |\\n| 1 | BOSSÉ, Luc | 2022-06-09 | 2024-06-09 |",
          "proposer": "",
          "seconder": "",
          "vote": ""
        },
        {
          "code": "03-05",
          "type": "resolution",
          "considerants": ["CONSIDÉRANT que..."],
          "dispositif": "IL EST RÉSOLU d'élire...",
          "proposer": "",
          "seconder": "",
          "vote": ""
        }
      ],
      "commentaires": [
        {
          "code": "03-A",
          "contenu": "[TEXTE COMPLET du commentaire - PLUSIEURS paragraphes]"
        }
      ]
    }
  ]
}

## RAPPEL FINAL
- Le JSON doit contenir L'INTÉGRALITÉ du texte du PV.
- Ne tronque AUCUN contenu.
- Un point ODJ peut avoir 0, 1, 2 ou PLUSIEURS résolutions et commentaires.
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

                // Add table content if present
                if (res.tableaux) {
                    content += '\n\n' + res.tableaux;
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
): Promise<{
    success: boolean;
    agendaItems?: AgendaItem[];
    attendees?: Array<{ name: string; role?: string; isPresent: boolean }>;
    error?: string
}> => {
    // Step 1: Extract with AI
    const extraction = await extractPVWithGroq(rawText, existingAgendaItems);

    if (!extraction.success || !extraction.data) {
        return { success: false, error: extraction.error };
    }

    // Step 2: Map to AgendaItems
    const agendaItems = mapAIExtractedToAgendaItems(extraction.data, existingAgendaItems);

    // Step 3: Map presences to attendees format
    const attendees: Array<{ name: string; role?: string; isPresent: boolean }> = [];
    if (extraction.data.presences) {
        for (const p of extraction.data.presences.presents || []) {
            attendees.push({ name: p.nom, role: p.role, isPresent: true });
        }
        for (const a of extraction.data.presences.absents || []) {
            attendees.push({ name: a.nom, role: a.role, isPresent: false });
        }
    }

    console.log(`[groqService] Extracted ${attendees.length} attendees`);

    return { success: true, agendaItems, attendees };
};
