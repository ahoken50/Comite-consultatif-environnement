/**
 * PV Pipeline Prompts — Étapes 4 à 10
 *
 * Prompts IA spécialisés pour chaque étape du pipeline de génération de PV.
 * Chaque prompt est conçu pour produire du JSON parseable directement.
 */

import type { Meeting } from '../types/meeting.types';
import type {
  ODJAnalysisResult,
  ClassificationResult,
  CCENumbering,
} from '../types/pvAgent.types';
import { formatAttendeesList, formatAgendaList } from './minutesDraftPrompt';

// ============================================================================
// STEP 4 — ANALYSE ODJ : Mapping discussions → Points ordre du jour
// ============================================================================

export const getTopicExtractionPrompt = (
  transcriptionChunk: string
): string => {
  return `Tu es un assistant expert en analyse de réunions.
TÂCHE : Analyse ce segment de transcription et extrais les GRANDS SUJETS distincts discutés.
IMPORTANT : Regroupe les discussions autour d'un même grand thème (ex: un projet, un règlement) en un SEUL sujet riche et détaillé. 
Ne fragmente pas la conversation en de multiples micro-sujets s'ils concernent le même point global.

RÈGLES D'EXTRACTION :
1. Préserve les termes techniques exacts (numéros de règlements, montants, dates, noms de lieux).
2. Si un sujet change (ex: on passe des arbres à l'eau potable), crée un NOUVEAU topic.
3. Évite les titres vagues comme "Discussion diverse". Donne un titre précis.

TRANSCRIPTION (extrait) :
${transcriptionChunk.substring(0, 100000)}

FORMAT JSON ATTENDU :
{
  "topics": [
    {
      "title": "Titre du sujet discuté",
      "description": "Résumé détaillé de la discussion (arguments, décisions, points clés)",
      "speakers": ["Nom 1", "Nom 2"],
      "keywords": ["mot1", "mot2"]
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`;
};

export const getODJMappingPrompt = (
  meeting: Meeting,
  extractedTopics: any[],
  _speakerMapping?: Record<string, string>,
  maxDescriptionChars: number = 5000,
  anchors?: Map<string, { sentences: string[], confidence: 'exact' | 'strong' | 'weak' | 'procedural' }>
): string => {
  const odjList = meeting.agendaItems?.map((item, i) =>
    `${i + 1}. [ID: ${item.id}] ${item.title}${item.objective ? ` [Objectif: ${item.objective}]` : ''}`
  ).join('\n') || 'Aucun ordre du jour défini';

  let anchorsContext = "";
  if (anchors && anchors.size > 0) {
    anchorsContext = "\n\n## 🔗 ANCRES TEXTUELLES DÉTECTÉES (phrases exactes mentionnant chaque point ODJ) :\n";
    anchors.forEach((data, itemId) => {
      const item = meeting.agendaItems?.find((a: any) => a.id === itemId);
      if (item) {
        const emoji =
          data.confidence === 'exact' ? '✅' :
            data.confidence === 'procedural' ? '📋' :
              data.confidence === 'strong' ? '🟢' : '🟡';
        anchorsContext += `\n${emoji} **[Item ${item.id}] ${item.title}** (Confiance: ${data.confidence}) :\n`;
        data.sentences.forEach(s => anchorsContext += `  - "${s}"\n`);
      }
    });
  }

  /* Safe truncation of topic descriptions to avoid context overflow */
  const topicsContext = extractedTopics.map((t, i) => {
    const speakers = Array.isArray(t.speakers) ? t.speakers : (typeof t.speakers === 'string' ? [t.speakers] : []);

    return `SUJET #${i + 1}: ${t.title || 'Sans titre'}
     RESUMÉ: ${(t.description || '').substring(0, maxDescriptionChars)}
     INTERVENANTS: ${speakers.join(', ')}`;
  }).join('\n\n');

  return `Tu es un expert en procès-verba ux.
Voici l'ORDRE DU JOUR officiel de la réunion (${meeting.agendaItems?.length || 0} points) :
${odjList}
${anchorsContext}

Voici la LISTE DE ${extractedTopics.length} SUJETS discutés (extraits de la transcription) :
${topicsContext}

TÂCHE :
Associe les sujets discutés aux points de l'ordre du jour.
Tu as ${extractedTopics.length} sujets identifiés pour ${meeting.agendaItems?.length || 0} points à l'ODJ.
Tu DOIS regrouper les sujets qui concernent le même point.
RÈGLE D'OR : CHAQUE point de l'ordre du jour DOIT avoir du contenu.

INSTRUCTIONS :
1. Parcours TOUS les points de l'ODJ un par un.
2. Identifie les numéros des SUJETS (ex: Sujet #1, Sujet #5) qui correspondent à ce point.
3. Si le point n'a PAS été discuté, a été sauté, ou reporté :
   - Indique-le explicitement via le champ "status".
   - Status possibles: "discussed", "skipped", "postponed", "unknown".

🎯 CONSIGNES DE MAPPING (Agnostique):
- Si un sujet parle de "règlement", "normes" ou "zonage" → cherche un item dont le titre contient ces mots.
- Si un sujet parle de "balayures", "neige" ou "voirie" → cherche un item de gestion ou travaux publics.
- Si un sujet parle de "politique", "stratégie" ou "plan" → cherche un item de planification ou politique générale.
- Si un sujet parle de "projets spécifiques" (ex: OASIS, parc) → cherche le nom du projet dans les titres.
- Si un sujet parle de "mandat" ou "renouvellement" → cherche un item "Administration" ou "Membres".
⚠️ RÈGLE DE NON-DUPLICATION :
Un sujet (topicIndex) ne doit être associé qu'à UN SEUL point de l'ordre du jour. Ne place JAMAIS le même topicIndex dans plusieurs items. Choisis le PLUS pertinent.

INTERDICTION STRICTE : L'item 'Varia' ou 'Questions diverses' NE DOIT contenir QUE les sujets explicitement introduits comme tels à la fin de la réunion. TOUT AUTRE SUJET orphelin ou incertain DOIT aller dans le tableau "unmappedTopics". Si tu mets un sujet technique (règlement, aménagement, etc.) dans Varia, c'est une FAUTE GRAVE.
Si un sujet concerne un item existant (même vaguement, ex: aménagement d'un parc -> item réglementation ou item parc), map-le à cet item spécifique, PAS à Varia.

NE PAS mettre "topicIndices": [] SAUF si l'item est vraiment absent de la transcription.

⚠️ RÈGLES CRITIQUES SUR LE FORMAT :
1. PAS de <think>, PAS de commentaire, JUSTE le JSON.
2. Commence ta réponse directement par { "mappedItems": [
3. Tu DOIS mapper TOUS les items de l'ODJ (même si "topicIndices": [] pour items non discutés).
4. Format strict : {"mappedItems": [...objets...], "unmappedTopics": [...]}
5. Ferme TOUJOURS le JSON complètement.

FORMAT JSON ATTENDU :
{
  "mappedItems": [
    {
      "odjItemId": "id-du-point",
      "odjTitle": "Titre du point",
      "status": "discussed", // ou "skipped", "postponed"
      "topicIndices": [1, 5], // Liste des numéros des sujets associés (1-based)
      "reason": "Explication si sauté ou reporté"
    }
  ],
  "unmappedTopics": [2, 4] // Ids des sujets non utilisés
}

Réponds UNIQUEMENT avec le JSON.`;
};

// DEPRECATED - Kept for backward compatibility if needed, but replaced by 2-pass system
export const getODJAnalysisPrompt = (
  meeting: Meeting,
  cleanedTranscription: string,
  speakerMapping?: Record<string, string>
): string => {
  const odjList = meeting.agendaItems?.map((item, i) =>
    `${i + 1}. [ID: ${item.id}] ${item.title}${item.objective ? ` [Objectif: ${item.objective}]` : ''}${item.presenter ? ` [Resp: ${item.presenter}]` : ''}`
  ).join('\n') || 'Aucun ordre du jour défini';

  const speakerInfo = speakerMapping
    ? `\n\nMAPPING DES LOCUTEURS:\n${Object.entries(speakerMapping).map(([label, name]) => `- ${label} → ${name}`).join('\n')}`
    : '';

  return `Tu es un expert en analyse de procès-verbaux municipaux québécois.

ORDRE DU JOUR DE LA RÉUNION:
${odjList}
${speakerInfo}

TRANSCRIPTION NETTOYÉE:
${cleanedTranscription.substring(0, 800000)}

TÂCHE:
Associe chaque segment de la transcription à un point de l'ordre du jour.
Pour chaque point, identifie:
1. Les segments de transcription pertinents (résumés fidèles)
2. Les intervenants qui ont parlé sur ce point
3. Un score de confiance (0.0 à 1.0)

RÈGLES STRICTES:
- Un segment ne peut être associé qu'à UN SEUL point de l'ODJ
- Si un segment ne correspond à aucun point, mets-le dans "unmappedSegments"
- Respecte l'ordre chronologique de la discussion
- Ne déduis JAMAIS un contenu qui n'est pas explicitement dans la transcription
- Le champ "transcriptSegments" doit contenir des RÉSUMÉS FIDÈLES et DÉTAILLÉS pour couvrir l'ensemble des discussions.
- Utilise les noms des intervenants tels qu'ils apparaissent dans la transcription (ex: "Donald Ratté", "Luc Bossé"). NE LES NIE PAS.
- La clé racine DOIT être "mappedItems" (pas "mappedMap", "mappedItem" ou autre)

FORMAT JSON ATTENDU:
{
  "mappedItems": [
    {
      "odjItemId": "id-du-point",
      "odjTitle": "Titre du point",
      "odjOrder": 1,
      "transcriptSegments": ["Résumé fidèle du segment 1", "Résumé fidèle du segment 2"],
      "speakers": ["M. Ross", "Mme Boutin"],
      "confidence": 0.95
    }
  ],
  "unmappedSegments": ["Segments qui ne correspondent à aucun point"],
  "coveragePercent": 85.0
}

Réponds UNIQUEMENT avec le JSON, sans markdown ni commentaires.`;
};

// ============================================================================
// STEP 5 — CLASSIFICATION : Catégorisation thématique + sentiment
// ============================================================================

export const getClassificationPrompt = (
  meeting: Meeting,
  odjAnalysis: ODJAnalysisResult
): string => {
  const itemsSummary = odjAnalysis.mappedItems.map(item =>
    `- [${item.odjItemId}] ${item.odjTitle}: ${item.transcriptSegments.join(' | ').substring(0, 300)}`
  ).join('\n');

  return `Tu es un analyste spécialisé en gouvernance municipale et environnement au Québec.

CONTEXTE: Réunion du Comité Consultatif en Environnement (CCE) de Val-d'Or
DATE: ${meeting.date}

POINTS ANALYSÉS:
${itemsSummary}

TÂCHE:
Pour chaque point de l'ordre du jour, détermine:
1. Les CATÉGORIES thématiques (parmi: environnement, urbanisme, eau, déchets, biodiversité, énergie, transport, réglementation, budget, consultation_publique, gouvernance, autre)
2. Le SENTIMENT global de la discussion (positive, neutral, negative, mixed)
3. Le TYPE D'ISSUE attendu:
   - "resolution" si un vote ou une recommandation formelle est faite
   - "comment" si c'est une discussion ou un dépôt de document
   - "decision" si une action est convenue sans vote formel
   - "information" si c'est un simple partage d'information
4. La PRIORITÉ (high, medium, low)
5. Les MOTS-CLÉS pertinents (max 5)
6. Un RÉSUMÉ en une phrase

Détermine aussi les thèmes globaux de la réunion et le sentiment général.

FORMAT JSON ATTENDU:
{
  "items": [
    {
      "odjItemId": "id-du-point",
      "odjTitle": "Titre",
      "categories": ["environnement", "réglementation"],
      "sentiment": "positive",
      "issueType": "resolution",
      "priority": "high",
      "keywords": ["arrosage", "pelouse", "interdiction"],
      "summary": "Discussion sur l'interdiction d'arrosage des pelouses en période de sécheresse"
    }
  ],
  "globalThemes": ["gestion de l'eau", "réglementation environnementale"],
  "globalSentiment": "positive"
}

Réponds UNIQUEMENT avec le JSON.`;
};

// ============================================================================
// STEP 6 — RÉDACTION : Génération brouillon PV
// ============================================================================

export const getDraftingSystemPrompt = (): string => `
Tu es un rédacteur institutionnel expert en procès-verbaux municipaux pour le Comité consultatif en environnement (CCE) de la Ville de Val-d'Or.

OBJECTIF PRINCIPAL :
Produire un PROCÈS-VERBAL officiel, structuré et conforme aux pratiques municipales québécoises.

## ⚠️ RÈGLES ABSOLUES

1. **AUCUNE HALLUCINATION**
   - Ne JAMAIS inventer une information absente
   - Ne JAMAIS compléter une phrase incomplète
   - Ne JAMAIS déduire une intention ou un consensus
   - Si une information est ambiguë : l'indiquer explicitement

2. **AUCUNE RÉPÉTITION EN BOUCLE**
   - Si un segment est répété (erreur Whisper), ne l'intégrer qu'UNE SEULE FOIS

3. **FIDÉLITÉ STRICTE AU CONTENU**
   - Reformulation permise UNIQUEMENT si le sens est clair et explicite

## CONSIGNES DE FORMATTAGE

1. **NUMÉROTATION OBLIGATOIRE** : Chaque point commence par son numéro (ex. « 1. Ouverture »)
2. **BLOCS RÉSOLUTION** : Format exact → RÉSOLUTION XX-XX (ex. 09-35)
3. **BLOCS COMMENTAIRE** : Format exact → COMMENTAIRE XX-X (ex. 09-A)
4. **RETOURS À LA LIGNE** : UNE LIGNE VIDE avant chaque Titre, RÉSOLUTION, COMMENTAIRE

## RÈGLE D'OR — ISSUE UNIQUE PAR POINT
- Un point ne doit avoir qu'UNE SEULE issue principale
- PRIORITÉ : RÉSOLUTION > DÉCISION > COMMENTAIRE
- NE JAMAIS mettre une Résolution ET un Commentaire pour le même point

## STYLE DE RÉDACTION
- Français administratif québécois
- Ton formel, neutre et institutionnel
- Phrases complètes et denses
- Vocabulaire municipal : « considérant », « attendu que », « il est résolu »
- SOIS RICHE EN DÉTAILS : raconte les échanges avec précision

## EXEMPLE DE RÉFÉRENCE

<EXEMPLE_REFERENCE>
PROCÈS-VERBAL
COMITÉ CONSULTATIF EN ENVIRONNEMENT (CCE)
9e assemblée ordinaire
Tenue le mardi 10 octobre 2023, 17 h

ÉTAIENT PRÉSENTS
Patricia Boutin (Présidente), Sébastien Brodeur-Girard, Jacinthe Pothier.

1. Adoption de l'ordre du jour
RÉSOLUTION 09-35
L'ordre du jour est adopté en laissant l'item varia ouvert.

2. Retour sur la rencontre du 14 juin 2023
COMMENTAIRE 09-A
1. Offres de services pour les consultations publiques : Un devis d'appel d'offres est actuellement en cours...
2. Réglementation sur les poules : Le processus progresse. Il reste à finaliser...

3. Discussion autour de l'interdiction d'arrosage des pelouses
COMMENTAIRE 09-B
Benjamin Turcotte, élu associé au dossier de l'environnement, a soulevé la question...
RÉSOLUTION 09-36
CONSIDÉRANT que plusieurs municipalités...
IL EST RÉSOLU DE recommander au conseil...
</EXEMPLE_REFERENCE>
`;

export const getDraftingUserPrompt = (
  meeting: Meeting,
  odjAnalysis: ODJAnalysisResult,
  classification: ClassificationResult,
  numbering: CCENumbering,
  cleanedTranscription: string
): string => {
  const attendeesList = formatAttendeesList(meeting);
  const agendaList = formatAgendaList(meeting);

  const classificationContext = classification.items.map(item =>
    `- ${item.odjTitle}: Type=${item.issueType}, Sentiment=${item.sentiment}, Priorité=${item.priority}`
  ).join('\n');

  const analysisContext = odjAnalysis.mappedItems.map(item =>
    `\n### ${item.odjOrder}. ${item.odjTitle}\nIntervenants: ${item.speakers.join(', ')}\nContenu:\n${item.transcriptSegments.join('\n')}`
  ).join('\n');

  return `## INFORMATIONS DE LA RÉUNION
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}
Assemblée #${numbering.assemblyNumber}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR
${agendaList}

## NUMÉROTATION CCE
- Prochaine résolution: ${String(numbering.assemblyNumber).padStart(2, '0')}-${String(numbering.nextResolution).padStart(2, '0')}
- Prochain commentaire: ${String(numbering.assemblyNumber).padStart(2, '0')}-${numbering.nextComment}

## CLASSIFICATION DES POINTS
${classificationContext}

## ANALYSE PAR POINT DE L'ODJ
${analysisContext}

## TRANSCRIPTION COMPLÈTE (SOURCE DE VÉRITÉ)
${cleanedTranscription.substring(0, 800000)}

## MISSION
Génère le Procès-Verbal officiel complet en respectant STRICTEMENT :
1. Le format de l'exemple de référence
2. La numérotation CCE fournie
3. Les types d'issues identifiés par la classification
4. La fidélité absolue à la transcription

Retourne le PV complet en texte brut (pas de JSON).`;
};

// ============================================================================
// STEP 7 — RÉFLEXION : Auto-critique + corrections
// ============================================================================

export const getReflectionPrompt = (
  pvDraft: string,
  transcription: string,
  iterationNumber: number,
  previousIssues?: string
): string => {
  const previousContext = previousIssues
    ? `\n\nPROBLÈMES CORRIGÉS LORS DES ITÉRATIONS PRÉCÉDENTES:\n${previousIssues}\nNe répète PAS ces corrections. Cherche de NOUVEAUX problèmes.`
    : '';

  return `Tu es un réviseur expert de procès-verbaux municipaux. C'est l'itération #${iterationNumber} de la révision.

BROUILLON DU PV À RÉVISER:
${pvDraft.substring(0, 200000)}

TRANSCRIPTION ORIGINALE (SOURCE DE VÉRITÉ):
${transcription.substring(0, 200000)}
${previousContext}

TÂCHE:
Effectue une auto-critique rigoureuse du brouillon en vérifiant:

1. **ERREURS FACTUELLES** : Le PV dit-il quelque chose qui n'est PAS dans la transcription?
2. **INFORMATIONS MANQUANTES** : Y a-t-il des discussions importantes omises?
3. **FORMATAGE** : La numérotation est-elle correcte? Les blocs RÉSOLUTION/COMMENTAIRE sont-ils bien formés?
4. **INCOHÉRENCES** : Y a-t-il des contradictions internes?
5. **HALLUCINATIONS** : Le PV contient-il des informations inventées?
6. **STYLE** : Le ton est-il conforme au style administratif québécois?

RÈGLES:
- Sois IMPITOYABLE dans ta critique
- Chaque problème doit avoir une correction concrète
- Si le PV est correct, retourne une liste vide d'issues
- Applique les corrections et retourne le contenu corrigé
- Attribue un score de qualité de 0 à 100

FORMAT JSON ATTENDU:
{
  "issues": [
    {
      "type": "factual_error",
      "severity": "critical",
      "location": "Point 3, paragraphe 2",
      "description": "Le PV attribue une citation à M. Ross alors que c'est Mme Boutin qui a parlé",
      "suggestedFix": "Remplacer 'M. Ross a mentionné' par 'Mme Boutin a mentionné'",
      "applied": true
    }
  ],
  "correctedContent": "Le PV corrigé complet...",
  "qualityScore": 85
}

Réponds UNIQUEMENT avec le JSON.`;
};

// ============================================================================
// STEP 9 — COMPARAISON : Vérification cohérence avec PV historiques
// ============================================================================

export const getComparisonPrompt = (
  currentPV: string,
  historicalPVs: Array<{ date: string; content: string }>,
  meetingNumber: number
): string => {
  const historicalContext = historicalPVs.map((pv, i) =>
    `\n--- PV HISTORIQUE #${i + 1} (${pv.date}) ---\n${pv.content.substring(0, 5000)}`
  ).join('\n');

  return `Tu es un expert en contrôle qualité de procès-verbaux municipaux.

PV ACTUEL (Assemblée #${meetingNumber}):
${currentPV.substring(0, 100000)}

PV HISTORIQUES POUR COMPARAISON:
${historicalContext}

TÂCHE:
Compare le PV actuel avec les PV historiques et vérifie:

1. **NUMÉROTATION** : Les numéros de résolutions/commentaires suivent-ils la séquence?
2. **FORMAT** : Le format est-il cohérent avec les PV précédents?
3. **TERMINOLOGIE** : Les termes utilisés sont-ils les mêmes (ex: "le Comité" vs "le CCE")?
4. **PRÉSENCES** : Les noms des membres sont-ils orthographiés de la même façon?
5. **STYLE DE RÉSOLUTION** : Les résolutions suivent-elles le même patron (CONSIDÉRANT... IL EST RÉSOLU...)?

Pour chaque incohérence trouvée, propose une correction.

FORMAT JSON ATTENDU:
{
  "consistencyChecks": [
    {
      "type": "terminology",
      "status": "warning",
      "message": "Le PV utilise 'CCE' alors que les PV précédents utilisent 'le Comité'",
      "suggestion": "Remplacer 'CCE' par 'le Comité' pour cohérence"
    }
  ],
  "formatScore": 90,
  "corrections": [
    {
      "location": "Header",
      "before": "CCE",
      "after": "le Comité",
      "reason": "Cohérence terminologique avec PV précédents"
    }
  ],
  "correctedContent": "Le PV corrigé si des corrections ont été appliquées..."
}

Réponds UNIQUEMENT avec le JSON.`;
};

// ============================================================================
// STEP 6 — RÉDACTION (extraction JSON structurée pour le parsing)
// ============================================================================

export const getDraftingExtractionPrompt = (
  pvContent: string,
  numbering: CCENumbering
): string => {
  return `Analyse le procès-verbal suivant et extrais les données structurées.

PV:
${pvContent.substring(0, 200000)}

NUMÉROTATION: Assemblée #${numbering.assemblyNumber}

Extrais:
1. Toutes les RÉSOLUTIONS avec leur numéro, contenu, proposeur et secondeur
2. Tous les COMMENTAIRES avec leur numéro et contenu
3. Les PRÉSENCES (présents, absents, invités)
4. Les informations du HEADER

FORMAT JSON ATTENDU:
{
  "resolutions": [
    {
      "number": "09-35",
      "content": "L'ordre du jour est adopté...",
      "proposer": "M. Ross",
      "seconder": "Mme Boutin",
      "odjItemId": ""
    }
  ],
  "comments": [
    {
      "number": "09-A",
      "content": "Discussion sur...",
      "odjItemId": ""
    }
  ],
  "attendees": {
    "present": ["Patricia Boutin", "Sébastien Brodeur-Girard"],
    "absent": ["Jean Ratté"],
    "guests": []
  },
  "header": {
    "assemblyNumber": ${numbering.assemblyNumber},
    "assemblyType": "ordinaire",
    "date": "",
    "time": "",
    "location": ""
  }
}

Réponds UNIQUEMENT avec le JSON.`;
};