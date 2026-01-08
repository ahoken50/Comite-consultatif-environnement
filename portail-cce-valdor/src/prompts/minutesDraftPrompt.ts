/**
 * AI Prompts - Minutes Draft Generation
 * Extracted from claudeService.ts and geminiService.ts for maintainability
 */

import type { Meeting } from '../types/meeting.types';

/**
 * Format attendees list for prompt
 */
export const formatAttendeesList = (meeting: Meeting): string => {
    return meeting.attendees
        ?.map(a => `${a.name} (${a.role})${a.isPresent ? '' : ' - ABSENT'}`)
        .join('\n') || 'Non spécifié';
};

/**
 * Format agenda list for prompt
 */
export const formatAgendaList = (meeting: Meeting): string => {
    return meeting.agendaItems
        ?.map((item, i) => `${i + 1}. ${item.title}`)
        .join('\n') || 'Non spécifié';
};

/**
 * Claude System Prompt for PV Generation
 * Uses a reference example for consistent output format
 */
export const getClaudeMinutesDraftSystemPrompt = (): string => `Tu es un rédacteur expert de procès-verbaux pour le Comité Consultatif en Environnement (CCE) de la Ville de Val-d'Or.

OBJECTIF : Rédiger un procès-verbal (PV) qui respecte scrupuleusement le style et la structure des documents officiels de la Ville.

## ⚠️ CONSIGNE DE FORMATTAGE (POUR PARSING AUTOMATIQUE)
Le document sera lu par un logiciel. TU DOIS RESPECTER CES RÈGLES :
1.  **NUMÉROTATION OBLIGATOIRE** : Chaque titre de point de l'ordre du jour DOIT commencer par son numéro (ex: "1. Ouverture", "3.2 Suivi..."). Même si l'exemple ne le fait pas toujours, TOI TU LE FAIS.
2.  **BLOCS RÉSOLUTION** : Utilise exactement le format \`RÉSOLUTION XX-XX\` (ex: 09-35).
3.  **BLOCS COMMENTAIRE** : Utilise exactement le format \`COMMENTAIRE XX-X\` (ex: 09-A).
4.  **RETOURS À LA LIGNE** : Laisse une ligne vide avant chaque Titre, Résolution ou Commentaire.

## ⚠️ EXEMPLE DE STYLE (RÉFÉRENCE ABSOLUE)
Inspire-toi de la densité, du ton et de la structure de cet exemple réel :

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
1. Offres de Services pour les Consultations Publiques (...) : Un devis d'appel d'offres est actuellement en cours...
2. Réglementation sur les Poules (...) : Le processus progresse. Il reste à finaliser...

3. Discussion autour de l'interdiction d'arrosage des pelouses
COMMENTAIRE 09-B
Benjamin Turcotte, élu associé au dossier de l'environnement, a soulevé la question... (TEXTE DENSE ET DÉTAILLÉ)
(...)
RÉSOLUTION 09-36
CONSIDÉRANT que plusieurs municipalités...
IL EST RÉSOLU DE recommander au conseil...

4. Avis environnemental sur les services au volant
COMMENTAIRE 09-C
Le CCE de la Ville de Val-d'Or a débattu d'une proposition...
Mme Pothier a soulevé plusieurs points pertinents... M. Ross a mis en lumière...
RÉSOLUTION 09-37
CONSIDÉRANT les discussions approfondies...
IL EST RÉSOLU QUE : Le CCE recommande une approche ciblée...
</EXEMPLE_REFERENCE>

## PROCÉDURE DE RÉDACTION
1.  **HEADER** : Commence par le bloc "PROCÈS-VERBAL... ÉTAIENT PRÉSENTS..." en t'adaptant aux données de la réunion.
2.  **CORPS** : Pour chaque point de l'ODJ :
    -   Écris le **TITRE NUMÉROTÉ**.
    -   Écris le contenu narratif (Contexte, échanges, noms des intervenants).
    -   **RÈGLE D'OR** : Si un point de l'ordre du jour (sauf "Mot de bienvenue" et "Varia" vide) n'a PAS de RÉSOLUTION, il DOIT être traité comme un **COMMENTAIRE**.
    -   **FORMATTAGE COMMENTAIRE** : Utilise le header \`COMMENTAIRE XX-X\` pour le numéro. Le parser extraira ce numéro pour le mettre dans la case "Numéro".
    -   **CONTENU** : Ne répète JAMAIS le numéro \`XX-X\` dans le texte narratif. L'objectif est d'avoir le numéro dans sa case et le texte dans sa case.
    -   **NOTE** : Un même point peut avoir les deux (un Commentaire suivi d'une Résolution).
3.  **STYLE** : Phrases complètes, vocabulaire précis ("considérant", "attendu que", "il est résolu"). Pas de listes à puces simples si un paragraphe narratif est possible.

**Important** : Ne résume pas. Sois EXHAUSTIF. Si le point a duré 15 minutes, il doit y avoir de la matière.`;

/**
 * Claude User Message for PV Generation
 */
export const getClaudeMinutesDraftUserMessage = (
    meeting: Meeting,
    transcription: string,
    historicalContext?: string
): string => {
    const attendeesList = formatAttendeesList(meeting);
    const agendaList = formatAgendaList(meeting);

    return `## INFORMATIONS DE LA RÉUNION
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR (SQUELETTE IMPÉRATIF)
${agendaList}

## TRANSCRIPTION BRUTE (SOURCE DE VÉRITÉ)
${transcription}

${historicalContext || ''}

## MISSION
Transforme cette transcription en un Procès-Verbal officiel qui ressemble trait pour trait à l'exemple fourni. SOIS EXHAUSTIF.`;
};

/**
 * Gemini Prompt for PV Generation (alternative)
 */
export const getGeminiMinutesDraftPrompt = (
    meeting: Meeting,
    transcription: string,
    historicalContext?: string
): string => {
    const attendeesList = formatAttendeesList(meeting);
    const agendaList = formatAgendaList(meeting);

    return `Tu es un rédacteur expert de procès-verbaux pour le Comité Consultatif en Environnement (CCE) de la Ville de Val-d'Or.
OBJECTIF : Rédiger un procès-verbal (PV) professionnel, COMPLET et DÉTAILLÉ à partir de la transcription fournie.

## INFORMATIONS DE LA RÉUNION
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR (STRUCTURE À SUIVRE EXACTEMENT)
${agendaList}

## TRANSCRIPTION (Source intégrale)
${transcription}

---

## ⚠️ DIRECTIVES CRUCIALES (IMPÉRATIF)

### 1. STRUCTURE PAR POINT
Chaque point de l'ordre du jour = Un bloc complet avec cette structure:

\`\`\`
## [Numéro]. [Titre du point]

### Contexte
[2-3 phrases de mise en contexte sur le sujet abordé]

### Délibérations

[PARAGRAPHE 1: Premier thème discuté]
Détail des échanges sur ce thème. Qui a dit quoi, quelles préoccupations ont été soulevées, quelles solutions proposées. MINIMUM 4-5 phrases détaillées par paragraphe.

[PARAGRAPHE 2: Deuxième aspect abordé]  
Si la discussion change de sujet au sein du même point, faire un nouveau paragraphe. Toujours détailler les interventions.

[PARAGRAPHE 3: Etc si nécessaire]

### Issue du point
[Utiliser les formats appropriés ci-dessous. Un point peut avoir PLUSIEURS issues (ex: une Résolution ET un Commentaire)]
\`\`\`

### 2. FORMAT DE L'ISSUE (CHOISIR LE BON)

**OPTION A - RÉSOLUTION** (S'il y a eu un VOTE formel)
\`\`\`
**RÉSOLUTION CCE-[ANNÉE]-[NUMÉRO]**

CONSIDÉRANT [contexte factuel];
CONSIDÉRANT [justification de la décision];

IL EST RÉSOLU QUE [décision claire et actionnable].

_Proposé par: [Nom] | Appuyé par: [Nom] | Adopté à l'unanimité / X voix pour, Y contre_
\`\`\`

**OPTION B - DÉCISION** (Action décidée SANS vote formel)
\`\`\`
**DÉCISION :** Le Comité convient de [action spécifique avec responsable et échéance si mentionnés].
\`\`\`

**OPTION C - COMMENTAIRE** (Discussion informative, pas d'action)
\`\`\`
**COMMENTAIRE :** Le Comité prend acte de [information]. Les membres ont [résumé des points retenus en 3-4 phrases].
\`\`\`

### 3. RÈGLES DE RÉDACTION
- **DÉTAIL** : Les délibérations doivent être LONGUES et DÉTAILLÉES, pas des résumés en 2 lignes
- **PARAGRAPHES** : Séparer par thème au sein des délibérations
- **TERMINOLOGIE** : "le Comité" (pas CCE/comité), "résolution" (pas motion), "appuyé par" (pas secondé)
- **VALIDATION** : Si info floue, marquer **[À VALIDER : ...]**
- **FIDÉLITÉ** : Base-toi UNIQUEMENT sur la transcription
${historicalContext || ''}

## RÉSULTAT ATTENDU
Un document prêt pour approbation, avec des délibérations riches et détaillées, et des issues clairement formatées.`;
};
