/**
 * Groq AI Service for PV Parsing
 * 
 * Uses Groq's fast inference API (free tier available) to extract
 * structured data from Procès-Verbaux documents.
 * 
 * @see https://console.groq.com/docs/quickstart
 */

import type { AgendaItem, MinuteEntry } from '../types/meeting.types';
import JSON5 from 'json5';

// Groq API configuration
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Best model for structured extraction
const GROQ_MODEL = 'qwen/qwen3-32b'; // Qwen3 32B - good reasoning and structured output

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

### 3. STRUCTURE DES TITRES (CRITIQUE)

📌 DISTINCTION IMPORTANTE :
- **TITRE ODJ** = Le titre du point de l'ordre du jour (ex: "Mot de bienvenue", "Renouvellement des mandats")
  → C'est le titre PRINCIPAL fourni dans l'ODJ ci-dessus
  → Place-le dans "titre" au niveau du point ("points_traites.titre")

- **SOUS-TITRE** = Le titre spécifique d'une résolution ou commentaire (en gras AU-DESSUS de RÉSOLUTION XX-XX)
  → C'est le sujet SPÉCIFIQUE de cette résolution (ex: "Élection du président", "Bouteilles d'eau")
  → Place-le dans le champ "titre" DE LA RÉSOLUTION ("resolutions[].titre")

🔍 COMMENT TROUVER LE SOUS-TITRE :
- Regarde 1-3 lignes AU-DESSUS de "RÉSOLUTION XX-XX" ou "COMMENTAIRE XX-X"
- C'est généralement en **gras** dans le document
- Si pas de sous-titre explicite, laisse le champ "titre" vide pour la résolution

📋 EXEMPLE CONCRET :
Point ODJ #3 : "Renouvellement des mandats" (titre ODJ)
  ├─ RÉSOLUTION 03-04 → sous-titre: "Reconduction des membres sortants"
  ├─ COMMENTAIRE 03-A → sous-titre: "Discussion sur les absences"
  └─ RÉSOLUTION 03-05 → sous-titre: "Élection d'une présidente"

### 4. UN POINT ODJ = PLUSIEURS RÉSOLUTIONS/COMMENTAIRES POSSIBLES
- IMPORTANT: Un seul point de l'ordre du jour peut contenir PLUSIEURS résolutions ET commentaires.
- Exemple: Le point "Renouvellement des mandats" peut contenir RÉSOLUTION 03-04, COMMENTAIRE 03-A, ET RÉSOLUTION 03-05.
- Regroupe-les tous sous le même point ODJ dans le JSON.

#### DÉTECTION DES SOUS-SECTIONS (CRITIQUE pour "Retour sur..." ou "Suivi")
- SOUVENT, un point comme "Retour sur la rencontre" contient plusieurs sujets distincts séparés par des titres en gras.
- MÊME SANS NUMÉRO "RÉSOLUTION/COMMENTAIRE", tu DOIS les séparer !
- Si tu vois un titre en gras suivi de texte, CRÉE une nouvelle entrée "comment" (ou "resolution" si c'est une décision).
- Utilise le titre en gras comme "resolutions[].titre".
- NE FUSIONNE PAS tout le texte en un seul bloc. Sépare chaque sujet distinct.

### 4. TABLEAUX
- Si une résolution contient un tableau (ex: liste de mandats), convertis-le en texte formaté.
- Utilise le format: "| Colonne1 | Colonne2 |" ou une liste à puces.
- Place le tableau dans le champ "tableaux" de la résolution.

### 5. CONSIDÉRANTS ET DISPOSITIF
- Liste COMPLÈTE de tous les CONSIDÉRANT/ATTENDU.
- Le dispositif complet après "IL EST RÉSOLU".

### 6. ASSOCIATION COMMENTAIRE → POINT ODJ (TRÈS IMPORTANT)

⚠️ Les COMMENTAIRES (ex: COMMENTAIRE 03-B) ne vont PAS dans Varia !
Chaque commentaire appartient au point ODJ dont il DISCUTE le sujet.

🔍 COMMENT DÉTERMINER LE BON POINT ODJ :
1. Lis le CONTENU du commentaire (les discussions)
2. Identifie LE SUJET discuté (ex: politique environnementale, ruches, bouteilles d'eau)
3. Associe au point ODJ qui traite CE SUJET

📋 EXEMPLES CONCRETS :
- COMMENTAIRE qui parle de "politique environnementale" → Point "Renouvellement de la politique environnementale"  
- COMMENTAIRE qui parle de "bouteilles d'eau" ou "plastique" → Point "Adoption recommandation bouteilles d'eau"
- COMMENTAIRE qui parle de "ruches" ou "abeilles" ou "apiculture" → Point "Projet ruches Goldex"
- COMMENTAIRE qui parle de "stations de lavage" ou "embarcations" → Point "Stations de lavage embarcations"

🚫 NE METS PAS dans Varia :
- Les discussions qui précèdent une résolution
- Les commentaires clairement liés à un sujet ODJ spécifique

✅ METS dans Varia SEULEMENT :
- Les sujets vraiment divers sans lien avec les autres points
- Les annonces générales

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
 * 2nd Pass: Validate and Refine Extraction
 * Helps correct misclassified items (e.g. comments in Varia instead of correct point)
 */
const refinePVWithGroq = async (
    initialData: AIExtractedPV,
    agendaItems: AgendaItem[]
): Promise<AIExtractedPV> => {
    console.log('[groqService] Starting 2nd pass validation...');

    // Create a simplified view for the AI to validate
    const odjList = agendaItems.map((item, i) => `${i + 1}. ${item.title}`).join('\n');

    const prompt = `
Tu es un EXPERT en validation de données de procès-verbaux (PV).
Voici une extraction JSON faite par une IA junior. Elle contient souvent des ERREURS DE GROUPEMENT.
Ta mission : CORRIGER les erreurs d'association entre résolutions/commentaires et les points de l'ordre du jour.

Voici l'ORDRE DU JOUR OFFICIEL :
${odjList}

Voici l'EXTRACTION À CORRIGER :
${JSON.stringify(initialData, null, 2)}

## ⚠️ ERREURS FRÉQUENTES À CORRIGER :
1. **COMMENTAIRES ORPHELINS** : Souvent placés dans "Varia" ou le mauvais point.
   - Si un commentaire parle de "ruches", il DOIT aller dans le point "Projet ruches".
   - Si un commentaire parle de "politique environnementale", il DOIT aller dans le point "Politique environnementale".
   - DÉPLACE-LES dans le bon "point_traite" et SUPPRIME-LES de l'ancien.

2. **VARIA** : Varia ne doit contenir QUE les sujets divers (non listés à l'ODJ).
   - Vide le Varia de tout ce qui correspond à un point ODJ spécifique.

3. **TITRES** : Vérifie que "resolutions[].titre" contient bien le SOUS-TITRE spécifique (ex: "Élection président") et non le titre global du point ODJ.

4. **FUSION ABUSIVE (Validation Granularité)** :
   - Vérifie si un commentaire contient en réalité PLUSIEURS sujets séparés par des titres.
   - SI OUI : DÉCOUPE-LE en plusieurs objets "comment" distincts.
   - Exemple: Un long commentaire qui parle de "Sujet A" puis "Sujet B" avec des titres internes doit devenir 2 commentaires.

## INSTRUCTIONS :
- Analyse le CONTENU sémantique de chaque résolution/commentaire.
- DÉPLACE les objets dans le tableau "points_traites" correspondant au bon ID.
- NE MODIFIE PAS le texte verbatim (contenu, considérants, dispositif).
- RETOURNE le JSON corrigé complet respectant la même structure.
`;

    try {
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
                        content: 'Tu es un validateur expert. Tu corriges les erreurs de groupement dans le JSON. Tu déplaces les items mal classés.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1, // Very strict for validation
                max_tokens: 32000,
                top_p: 0.95,
                reasoning_effort: 'default',
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            console.warn('[groqService] 2nd pass failed API call, using initial data');
            return initialData;
        }

        const jsonResponse = await response.json();
        const content = jsonResponse.choices[0]?.message?.content;

        if (!content) return initialData;

        // Parse with fail-safe
        try {
            const correctedData = JSON.parse(content) as AIExtractedPV;
            console.log('[groqService] 2nd pass successful - Data refined');
            return correctedData;
        } catch (e) {
            try {
                // Secondary try with JSON5
                const correctedData = JSON5.parse(content) as AIExtractedPV;
                return correctedData;
            } catch (e2) {
                console.warn('[groqService] 2nd pass returned invalid JSON, using initial data');
                return initialData;
            }
        }

    } catch (error) {
        console.warn('[groqService] Error during 2nd pass:', error);
        return initialData;
    }
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
                temperature: 0.1, // Qwen recommended temperature
                max_tokens: 32000, // Large to capture full verbatim content
                top_p: 0.95, // Qwen recommended top_p
                reasoning_effort: 'default', // Qwen3 reasoning mode
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

        // Parse the JSON response with fault-tolerant parsing
        let data: AIExtractedPV;
        try {
            // Try standard JSON.parse first (fastest)
            data = JSON.parse(content) as AIExtractedPV;
        } catch (parseError) {
            // Fallback to json5 for malformed JSON (trailing commas, unquoted keys, etc.)
            console.warn('[groqService] Standard JSON.parse failed, trying json5...');
            try {
                data = JSON5.parse(content) as AIExtractedPV;
                console.log('[groqService] json5 parsed successfully');
            } catch (json5Error) {
                console.error('[groqService] Both JSON parsers failed');
                throw new Error(`Erreur de parsing JSON: ${(parseError as Error).message}`);
            }
        }

        console.log(`[groqService] Successfully extracted ${data.points_traites?.length || 0} points`);

        // 2nd PASS: Validate and Refine
        // This drastically improves grouping accuracy (comments in Varia etc.)
        if (data.points_traites && data.points_traites.length > 0) {
            data = await refinePVWithGroq(data, agendaItems);
        }

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
/**
 * Enhanced similarity score (0-1) prioritizing meaningful words matches
 */
const calculateSimilarity = (str1: string, str2: string): number => {
    if (!str1 || !str2) return 0;

    // Normalize: lowercase, remove accents, keep only alphanum
    const normalize = (s: string) => s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim();

    const s1 = normalize(str1);
    const s2 = normalize(str2);

    if (s1.includes(s2) || s2.includes(s1)) return 1.0; // Direct inclusion

    const tokens1 = s1.split(/\s+/).filter(w => w.length > 3); // Ignore short words
    const tokens2 = s2.split(/\s+/).filter(w => w.length > 3);

    if (tokens1.length === 0 || tokens2.length === 0) return 0;

    let matchCount = 0;
    for (const t1 of tokens1) {
        if (tokens2.some(t2 => t2.includes(t1) || t1.includes(t2))) {
            matchCount++;
        }
    }

    // Weight by the ratio of matched meaningful words
    return matchCount / Math.max(tokens1.length, tokens2.length);
};

/**
 * Find the best matching agenda item for a point
 */
const findBestMatch = (
    point: { ordre_du_jour_id: string; titre: string; resolutions?: any[] },
    items: AgendaItem[]
): { item: AgendaItem | null; index: number; matchType: string } => {

    // 1. Try STRICT ID Match (only if ID is numeric and plausible)
    const idStr = point.ordre_du_jour_id.replace(/[^0-9]/g, '');
    if (idStr) {
        const idIndex = parseInt(idStr) - 1;
        if (idIndex >= 0 && idIndex < items.length) {
            // Confirm with title check - if completely different, suspicious
            const titleScore = calculateSimilarity(point.titre, items[idIndex].title);
            if (titleScore > 0.2) { // Low threshold just to prevent total mismatches
                return { item: items[idIndex], index: idIndex, matchType: 'id-verified' };
            }
        }
    }

    // 2. Fuzzy match by Title AND Resolution Content
    let bestScore = 0;
    let bestIndex = -1;

    // Build rich text for the point (title + sub-titles)
    const pointText = `${point.titre} ${point.resolutions?.map((r: any) => r.titre).join(' ') || ''}`;

    for (let i = 0; i < items.length; i++) {
        const itemTitle = items[i].title;
        // Check title similarity
        const titleScore = calculateSimilarity(point.titre, itemTitle);

        // Check content similarity (sub-titles vs item title)
        const contentScore = calculateSimilarity(pointText, itemTitle);

        const score = Math.max(titleScore, contentScore);

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    if (bestIndex >= 0 && bestScore > 0.3) {
        return {
            item: items[bestIndex],
            index: bestIndex,
            matchType: `content-match(${(bestScore * 100).toFixed(0)}%)`
        };
    }

    // 3. Absolute Fallback: Use ID even if title didn't match (better than Varia)
    if (idStr) {
        const idIndex = parseInt(idStr) - 1;
        if (idIndex >= 0 && idIndex < items.length) {
            return { item: items[idIndex], index: idIndex, matchType: 'id-fallback' };
        }
    }

    // 4. Last resort: Varia or last item
    const variaIndex = items.findIndex(item =>
        item.title.toLowerCase().includes('varia') ||
        item.title.toLowerCase().includes('divers')
    );
    if (variaIndex >= 0) {
        return { item: items[variaIndex], index: variaIndex, matchType: 'varia-fallback' };
    }

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
            {
                ordre_du_jour_id: point.ordre_du_jour_id,
                titre: point.titre,
                resolutions: point.resolutions
            },
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
