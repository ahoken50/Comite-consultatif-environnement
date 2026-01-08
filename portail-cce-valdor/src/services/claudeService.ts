/**
 * Claude AI Service for PV Generation
 * Uses Anthropic Claude API for structuring transcriptions into official meeting minutes
 */

import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import type { Meeting, MinutesDraft } from '../types/meeting.types';
import { ClaudeSanitizedResponseSchema, type ClaudeSanitizedResponse } from '../schemas/meetingSchemas';

// Environment variable check for Anthropic API key is removed as it is handled in backend

/**
 * Check if Claude API is configured
 * (Maintained for compatibility, always returns true as config is now server-side)
 */
export const isClaudeConfigured = (): boolean => {
    return true;
};

/**
 * Generate minutes draft from transcription using Claude
 * @param meeting - The current meeting
 * @param transcription - The audio transcription (from Whisper)
 * @param historicalContext - Optional formatted historical context (past resolutions)
 */

export const generateMinutesDraftClaude = async (
    meeting: Meeting,
    transcription: string,
    historicalContext?: string
): Promise<{ success: boolean; draft?: MinutesDraft; error?: string }> => {
    // Note: We don't check for VITE_ANTHROPIC_API_KEY anymore as it's handled in the backend

    try {
        const attendeesList = meeting.attendees
            ?.map(a => `${a.name} (${a.role})${a.isPresent ? '' : ' - ABSENT'}`)
            .join('\n') || 'Non spécifié';

        const agendaList = meeting.agendaItems
            ?.map((item, i) => `${i + 1}. ${item.title}`)
            .join('\n') || 'Non spécifié';

        const systemPrompt = `Tu es un rédacteur expert de procès-verbaux pour le Comité Consultatif en Environnement (CCE) de la Ville de Val-d'Or.

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

1. Adoption de l’ordre du jour
RÉSOLUTION 09-35
L’ordre du jour est adopté en laissant l’item varia ouvert.

2. Retour sur la rencontre du 14 juin 2023
COMMENTAIRE 09-A
1. Offres de Services pour les Consultations Publiques (...) : Un devis d’appel d’offres est actuellement en cours...
2. Réglementation sur les Poules (...) : Le processus progresse. Il reste à finaliser...

3. Discussion autour de l’interdiction d’arrosage des pelouses
COMMENTAIRE 09-B
Benjamin Turcotte, élu associé au dossier de l’environnement, a soulevé la question... (TEXTE DENSE ET DÉTAILLÉ)
(...)
RÉSOLUTION 09-36
CONSIDÉRANT que plusieurs municipalités...
IL EST RÉSOLU DE recommander au conseil...

4. Avis environnemental sur les services au volant
COMMENTAIRE 09-C
Le CCE de la Ville de Val-d’Or a débattu d’une proposition...
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
    -   **FORMATTAGE COMMENTAIRE** : Utilise le header \`COMMENTAIRE XX-X\` pour le numéro. Leparser extraira ce numéro pour le mettre dans la case "Numéro".
    -   **CONTENU** : Ne répète JAMAIS le numéro \`XX-X\` dans le texte narratif. L'objectif est d'avoir le numéro dans sa case et le texte dans sa case.
    -   **NOTE** : Un même point peut avoir les deux (un Commentaire suivi d'une Résolution).
3.  **STYLE** : Phrases complètes, vocabulaire précis ("considérant", "attendu que", "il est résolu"). Pas de listes à puces simples si un paragraphe narratif est possible.

**Important** : Ne résume pas. Sois EXHAUSTIF. Si le point a duré 15 minutes, il doit y avoir de la matière.`;

        const userMessage = `## INFORMATIONS DE LA RÉUNION
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

        console.log('[Claude] Calling Cloud Function generate_minutes_claude...');

        // Timeout increased to 9 minutes (540000ms) to support Extended Thinking models
        const generateFunction = httpsCallable(functions, 'generate_minutes_claude', { timeout: 540000 });
        const result = await generateFunction({
            meetingId: meeting.id,
            systemPrompt,
            userMessage
        });

        const data = result.data as { success: boolean; content: string; error?: string };

        if (!data.success) {
            throw new Error(data.error || 'Erreur inconnue de la fonction Claude');
        }

        const draftContent = data.content;

        if (!draftContent) {
            throw new Error('Aucun contenu généré par la fonction');
        }

        console.log(`[Claude] Draft received: ${draftContent.length} chars`);

        // Note: The function already saves to Firestore, but we return the draft to update local state immediately
        const draft: MinutesDraft = {
            content: draftContent,
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
        };

        return { success: true, draft };

    } catch (error) {
        const err = error as Error;
        console.error('Claude draft generation error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Finalize draft with user feedback using Claude
 */
export const finalizeDraftClaude = async (
    meeting: Meeting,
    userFeedback: string
): Promise<{ success: boolean; finalContent?: string; error?: string }> => {
    // Note: API key check handled in backend

    const currentDraft = meeting.minutesDraft?.content;
    if (!currentDraft) {
        return { success: false, error: 'Aucun brouillon à finaliser' };
    }

    try {
        const systemPrompt = `Tu es un rédacteur de procès-verbaux. Tu vas recevoir un brouillon de PV et des corrections à appliquer.

INSTRUCTIONS:
1. Intègre toutes les corrections demandées
2. Supprime tous les marqueurs [À VÉRIFIER]
3. Assure-toi que le format est cohérent et professionnel
4. Ne modifie pas ce qui n'a pas été demandé
5. Produis la version finale du procès-verbal`;

        const userMessage = `## BROUILLON ACTUEL
${currentDraft}

## CORRECTIONS ET FEEDBACK
${userFeedback}

Génère le procès-verbal final, prêt à être imprimé.`;

        console.log('[Claude] Calling Cloud Function finalize_draft_claude...');

        const finalizeFunction = httpsCallable(functions, 'finalize_draft_claude', { timeout: 540000 });
        const result = await finalizeFunction({
            meetingId: meeting.id,
            systemPrompt,
            userMessage,
            userFeedback
        });

        const data = result.data as { success: boolean; content: string; error?: string };

        if (!data.success) {
            throw new Error(data.error || 'Erreur inconnue lors de la finalisation');
        }

        const finalContent = data.content;

        if (!finalContent) {
            throw new Error('Aucune version finale générée');
        }

        // Note: The function already updates Firestore, we return content for local update
        return { success: true, finalContent };

    } catch (error) {
        const err = error as Error;
        console.error('Claude finalization error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Sanitize minutes content using Claude
 * Replaces sensitive info with placeholders
 */
export const sanitizeMinutesClaude = async (
    minutesContent: string
): Promise<{ success: boolean; sanitizedContent?: string; error?: string }> => {
    // Note: API key handled in backend

    try {
        const systemPrompt = `Tu es un expert en conformité et protection de la vie privée pour une administration municipale.
TA MISSIONS : Anonymiser le procès-verbal suivant pour qu'il soit conforme à la Loi sur l'accès à l'information.

RÈGLES D'ANONYMISATION :
1. CITOYENS : Remplace les noms complets des citoyens privés par "[NOM MASQUÉ]" ou "un citoyen".
2. ADRESSES : Remplace les adresses civiques privées complètes par le nom de la rue seulement (ex: "123 rue Principale" -> "rue Principale"). 
3. DONNÉES SENSIBLES : Masque les numéros de téléphone, courriels personnels, ou détails financiers privés.
4. ÉLUS ET FONCTIONNAIRES : NE MASQUE PAS les noms des élus municipaux, employés de la ville, ou promoteurs d'entreprises (personnes morales). Ils sont publics.
5. CONTEXTE : Garde le reste du texte intact pour la compréhension.
6. IDENTITÉ : Si tu ne sais pas si une personne est publique ou privée, dans le doute, masque.`;

        const userMessage = `TEXTE À TRAITER :
${minutesContent}

FORMAT DE SORTIE :
Retourne uniquement le texte traité, sans introduction ni conclusion.`;

        console.log('[Claude] Calling Cloud Function chat_claude (for sanitization)...');

        const chatFunction = httpsCallable(functions, 'chat_claude', { timeout: 300000 });

        const result = await chatFunction({
            systemPrompt,
            userMessage,
            temperature: 0.1 // Low temperature for consistent sanitization
        });

        const data = result.data as { success: boolean; content: string; error?: string };

        if (!data.success) {
            throw new Error(data.error || 'Erreur inconnue de la fonction Claude');
        }

        const sanitizedContent = data.content;

        if (!sanitizedContent) {
            throw new Error('Aucun contenu généré');
        }

        return { success: true, sanitizedContent };

    } catch (error) {
        const err = error as Error;
        console.error('Claude sanitization error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Sanitize the entire meeting object for PDF export
 */
/**
 * Sanitize the entire meeting object for PDF export
 */
export const sanitizeMeetingClaude = async (
    meeting: Meeting
): Promise<{ success: boolean; sanitizedMeeting?: Meeting; error?: string }> => {
    try {
        // 1. Construct a simplified payload to minimize tokens, only sending text fields
        const payload = {
            minutes: meeting.minutes || '',
            attendees: meeting.attendees?.map(a => ({
                id: a.id,
                name: a.name,
                role: a.role
            })),
            agendaItems: meeting.agendaItems?.map(item => ({
                id: item.id,
                title: item.title,
                decision: item.decision, // Legacy
                proposer: item.proposer,
                seconder: item.seconder,
                minuteEntries: item.minuteEntries?.map(entry => ({
                    type: entry.type,
                    content: entry.content,
                    number: entry.number
                }))
            }))
        };

        const systemPrompt = `Tu es un expert en protection de la vie privée.
TA MISSION : Anonymiser les données JSON suivantes pour qu'elles soient conformes à la Loi sur l'accès à l'information, tout en préservant STRICTEMENT la structure JSON.

RÈGLES D'ANONYMISATION :
1. CITOYENS : Remplace les noms complets des citoyens privés par "[NOM MASQUÉ]" ou "un citoyen". (Valable pour les participants, proposeurs, appuyeurs).
2. ADRESSES : Remplace les adresses civiques privées complètes par le nom de la rue seulement.
3. DONNÉES SENSIBLES : Masque les numéros de téléphone, courriels personnels, montants financiers privés, plaques d'immatriculation.
4. ÉLUS ET FONCTIONNAIRES : NE MASQUE PAS les noms des élus municipaux, employés de la ville ou entreprises (ex: "Conseiller X", "Directeur Y").
5. FORMAT : Tu DOIS retourner EXCLUSIVEMENT un JSON valide qui respecte exactement la structure d'entrée. Ne change pas les ID ni les clés.`;

        const userMessage = `DONNÉES À TRAITER (JSON) :
${JSON.stringify(payload, null, 2)}

FORMAT DE SORTIE ATTENDU :
Uniquement le JSON traité, rien d'autre.`;

        console.log('[Claude] Calling Cloud Function chat_claude (for full meeting sanitization)...');

        const chatFunction = httpsCallable(functions, 'chat_claude', { timeout: 540000 }); // 9 mins

        const result = await chatFunction({
            systemPrompt,
            userMessage,
            temperature: 0, // Zero temp for deterministic JSON output
        });

        const data = result.data as { success: boolean; content: string; error?: string };

        if (!data.success) {
            throw new Error(data.error || 'Erreur inconnue de la fonction Claude');
        }

        // Parse and Validate the result with Zod
        let sanitizedData: ClaudeSanitizedResponse;
        try {
            // Find JSON block if Claude wrapped it in markdown
            const jsonMatch = data.content.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : data.content;

            const rawJson = JSON.parse(jsonString);

            // Validate with Zod
            const validation = ClaudeSanitizedResponseSchema.safeParse(rawJson);

            if (!validation.success) {
                console.error('Claude JSON validation failed:', validation.error);
                throw new Error('La réponse de l\'IA ne respecte pas le schéma attendu.');
            }

            sanitizedData = validation.data;

        } catch (e) {
            console.error('Failed to parse Claude JSON response:', data.content, e);
            throw new Error('La réponse de l\'IA n\'est pas un JSON valide ou est malformée.');
        }

        // Reconstruct the meeting object with sanitized data
        const sanitizedMeeting: Meeting = {
            ...meeting,
            minutes: sanitizedData.minutes,
            attendees: meeting.attendees?.map(a => {
                const sanitizedAttendee = sanitizedData.attendees?.find((s) => s.id === a.id);
                return sanitizedAttendee ? { ...a, name: sanitizedAttendee.name } : a;
            }),
            agendaItems: meeting.agendaItems?.map(item => {
                const sanitizedItem = sanitizedData.agendaItems?.find((s) => s.id === item.id);
                if (!sanitizedItem) return item;

                return {
                    ...item,
                    title: sanitizedItem.title,
                    decision: sanitizedItem.decision,
                    proposer: sanitizedItem.proposer,
                    seconder: sanitizedItem.seconder,
                    minuteEntries: item.minuteEntries?.map((entry, index) => {
                        const sanitizedEntry = sanitizedItem.minuteEntries?.[index];
                        return sanitizedEntry ? { ...entry, content: sanitizedEntry.content } : entry;
                    })
                };
            })
        };

        return { success: true, sanitizedMeeting };

    } catch (error) {
        const err = error as Error;
        console.error('Claude meeting sanitization error:', err);
        return { success: false, error: err.message };
    }
};
