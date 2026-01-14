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

// Best model for structured extraction
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // Llama 3.3 70B - excellent for structured JSON extraction

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
            titre?: string; // Title extracted from bold text above resolution
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
    // Format agenda items as reference with explicit IDs
    const hasODJ = agendaItems.length > 0;
    const odjCount = agendaItems.length;

    // Build ODJ section with explicit IDs for better AI matching
    const odjSection = hasODJ
        ? `## ORDRE DU JOUR OFFICIEL (${odjCount} points - TU DOIS EN RETOURNER EXACTEMENT ${odjCount})
${agendaItems.map((item, i) => `POINT ${i + 1} (ordre_du_jour_id: "${i + 1}"): ${item.title}`).join('\n')}`
        : '## NOTE: Aucun ordre du jour fourni. Identifie CHAQUE point discuté dans le PV comme un point séparé.';

    // Constraint section for exact point matching
    const constraintSection = hasODJ ? `
## ⚠️ CONTRAINTE CRITIQUE - NOMBRE DE POINTS
- Tu DOIS retourner EXACTEMENT ${odjCount} objets dans "points_traites"
- Chaque objet correspond à UN point de l'ODJ ci-dessus
- NE CRÉE JAMAIS de nouveaux points - REGROUPE tout sous les ${odjCount} points existants
- Si du contenu ne correspond pas clairement à un point, place-le dans "Varia" (ou le dernier point)
` : '';

    return `Tu es un extracteur de données VERBATIM pour procès-verbaux municipaux. Ton travail est CRUCIAL.
${constraintSection}
## RÈGLES ABSOLUES (NE JAMAIS DÉROGER)

### 1. EXTRACTION DES PRÉSENCES
- Extrait TOUS les noms mentionnés dans "ÉTAIENT PRÉSENTES/PRÉSENTS" ou "ÉTAIENT AUSSI PRÉSENT"
- Identifie leur rôle si mentionné (présidente, vice-président, secrétaire, conseiller, membre)
- Extrait aussi les absents si mentionnés

### 2. INTERDICTION ABSOLUE DE TRONQUER OU RÉSUMER
⛔ TU NE DOIS JAMAIS :
- Résumer un texte
- Raccourcir une phrase
- Omettre des paragraphes
- Utiliser "..." ou "[...]" pour indiquer du texte omis
- Dire "Le texte continue..." ou "etc."

✅ TU DOIS TOUJOURS :
- Copier MOT POUR MOT chaque phrase du document
- Inclure TOUS les paragraphes, même s'ils sont longs
- Préserver chaque intervention de chaque personne

### 3. TITRES DES RÉSOLUTIONS ET COMMENTAIRES (CRITIQUE)
- CHAQUE résolution et commentaire a un TITRE SPÉCIFIQUE
- Le titre est généralement EN GRAS, situé JUSTE AU-DESSUS du numéro "RÉSOLUTION XX-XX" ou "COMMENTAIRE XX-X"
- OBLIGATOIRE : Extrait ce titre et place-le dans le champ "titre" de chaque résolution/commentaire
- Le titre décrit LE SUJET TRAITÉ (pas le numéro ODJ)

🔍 COMMENT TROUVER LE TITRE :
- Regarde 1-3 lignes AU-DESSUS de "RÉSOLUTION XX-XX"
- C'est souvent une phrase courte descriptive (ex: "Interdiction bouteilles d'eau", "Élection du président")
- Si pas de titre explicite, utilise le sujet principal du dispositif (IL EST RÉSOLU de...)

📋 EXEMPLES DE TITRES :
- "Recommandation visant à interdire l'achat de bouteilles d'eau" → titre de RÉSOLUTION 03-07
- "Élection d'une présidente et d'un vice-président" → titre de RÉSOLUTION 03-05
- "Discussion sur les ruches de Goldex" → titre de COMMENTAIRE 03-A

### 4. UN POINT ODJ = PLUSIEURS RÉSOLUTIONS/COMMENTAIRES POSSIBLES
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

### 6. RAISONNEMENT POUR ASSOCIER RÉSOLUTIONS À L'ODJ (IMPORTANT)
Utilise ton raisonnement pour associer chaque RÉSOLUTION et COMMENTAIRE au bon point de l'ODJ :
- Si le titre ODJ correspond directement au sujet → association évidente.
- Si le titre ne correspond pas exactement → raisonne sur le CONTENU de la résolution/commentaire.
- Exemple: "COMMENTAIRE 03-A" parle d'élection de président → associe-le au point "Élection d'une présidente" même s'il apparaît juste après "Renouvellement des mandats".
- RÈGLE: Analyse le texte du dispositif (IL EST RÉSOLU) pour comprendre le sujet réel.
- Regroupe les résolutions/commentaires sous le point ODJ le plus pertinent sémantiquement.

### 7. ORDRE DES RÉSOLUTIONS ET COMMENTAIRES (CRITIQUE)
- Les résolutions et commentaires doivent apparaître dans leur ORDRE CHRONOLOGIQUE (par numéro de code).
- 03-03 avant 03-04 avant 03-05, etc.
- 03-A avant 03-B avant 03-C, etc.
- Si un commentaire (03-A) apparaît entre deux résolutions (03-04 et 03-05), place-le dans l'ordre correct.

### 8. TOUS LES POINTS ODJ DOIVENT AVOIR DU CONTENU
- NE JAMAIS laisser un point ODJ vide (discussion_verbatim: "").
- Si un point n'a pas de résolution formelle, copie quand même TOUT le texte de discussion.
- Même "Mots de bienvenue" ou "Levée de l'assemblée" ont du contenu à extraire.
- Points comme "Varia" peuvent avoir plusieurs sujets → extrait TOUT.

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
          "titre": "Renouvellement des mandats des membres du CCE",
          "type": "resolution",
          "considerants": ["CONSIDÉRANT que le comité consultatif en environnement n'a eu aucune assemblée en plus d'un an...(TEXTE COMPLET)"],
          "dispositif": "IL EST RÉSOLU de recommander au Conseil de Ville...(TEXTE COMPLET)",
          "tableaux": "| SIÈGE | NOM | DÉBUT MANDAT | FIN MANDAT |\\n| 1 | BOSSÉ, Luc | 2022-06-09 | 2024-06-09 |",
          "proposer": "",
          "seconder": "",
          "vote": ""
        },
        {
          "code": "03-A",
          "titre": "Élection d'une présidente et d'un vice-président",
          "type": "comment",
          "contenu": "[TEXTE COMPLET du commentaire - tous les paragraphes de M. Turcotte, Mme Larochelle, etc.]"
        },
        {
          "code": "03-05",
          "titre": "Élection d'une présidente et d'un vice-président",
          "type": "resolution",
          "considerants": ["CONSIDÉRANT que...(TEXTE COMPLET)"],
          "dispositif": "IL EST RÉSOLU d'élire madame Patricia Boutin...(TEXTE COMPLET)",
          "proposer": "",
          "seconder": "",
          "vote": ""
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
 * Simple string similarity score (0-1) based on common words
 */
const calculateSimilarity = (str1: string, str2: string): number => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüç0-9\s]/g, '').split(/\s+/);
    const words1 = new Set(normalize(str1));
    const words2 = new Set(normalize(str2));
    const intersection = [...words1].filter(w => words2.has(w) && w.length > 2);
    const union = new Set([...words1, ...words2]);
    return intersection.length / union.size;
};

/**
 * Find the best matching agenda item for a point
 */
const findBestMatch = (
    point: { ordre_du_jour_id: string; titre: string },
    items: AgendaItem[]
): { item: AgendaItem | null; index: number; matchType: string } => {
    // Priority 1: Match by ID
    const idIndex = parseInt(point.ordre_du_jour_id) - 1;
    if (idIndex >= 0 && idIndex < items.length) {
        return { item: items[idIndex], index: idIndex, matchType: 'id' };
    }

    // Priority 2: Fuzzy match by title
    let bestScore = 0;
    let bestIndex = -1;
    for (let i = 0; i < items.length; i++) {
        const score = calculateSimilarity(point.titre, items[i].title);
        if (score > bestScore && score > 0.3) { // Minimum 30% similarity
            bestScore = score;
            bestIndex = i;
        }
    }
    if (bestIndex >= 0) {
        return { item: items[bestIndex], index: bestIndex, matchType: `fuzzy(${(bestScore * 100).toFixed(0)}%)` };
    }

    // Priority 3: Fallback to "Varia" or last item
    const variaIndex = items.findIndex(item =>
        item.title.toLowerCase().includes('varia') ||
        item.title.toLowerCase().includes('divers')
    );
    if (variaIndex >= 0) {
        return { item: items[variaIndex], index: variaIndex, matchType: 'varia-fallback' };
    }

    // Ultimate fallback: last item
    const lastIndex = items.length - 1;
    return { item: items[lastIndex], index: lastIndex, matchType: 'last-fallback' };
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

    // Track which items have been updated to allow merging
    const itemEntriesMap = new Map<number, MinuteEntry[]>();

    for (const point of aiData.points_traites) {
        // Find matching agenda item using intelligent matching
        const { item: matchedItem, index: matchedIndex, matchType } = findBestMatch(
            { ordre_du_jour_id: point.ordre_du_jour_id, titre: point.titre },
            updatedItems
        );

        if (!matchedItem) {
            console.warn(`[groqService] No agenda item found for point ${point.ordre_du_jour_id} - "${point.titre}"`);
            continue;
        }

        if (matchType !== 'id') {
            console.log(`[groqService] Point ${point.ordre_du_jour_id} matched to "${matchedItem.title}" via ${matchType}`);
        }

        // Build MinuteEntries from resolutions and comments
        const minuteEntries: MinuteEntry[] = [];

        // Add resolutions
        if (point.resolutions) {
            for (const res of point.resolutions) {
                let content = '';

                // Add title if present (extracted from bold text above resolution)
                if (res.titre) {
                    content += `**${res.titre}**\n\n`;
                }

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
                    // For comments stored as resolutions - still prepend title
                    content = res.titre ? `**${res.titre}**\n\n${res.contenu}` : res.contenu;
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

        // Update the agenda item - merge entries if already updated
        const existingEntries = itemEntriesMap.get(matchedIndex) || [];
        const mergedEntries = [...existingEntries, ...minuteEntries];
        itemEntriesMap.set(matchedIndex, mergedEntries);

        updatedItems[matchedIndex] = {
            ...matchedItem,
            minuteEntries: mergedEntries,
            decision: point.discussion_verbatim || matchedItem.decision,
            minuteType: mergedEntries[0]?.type,
            minuteNumber: mergedEntries[0]?.number
        };

        console.log(`[groqService] Updated item ${matchedIndex + 1}: "${matchedItem.title}" with ${mergedEntries.length} entries`);
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
