/**
 * Claude AI Service for PV Generation
 * Uses Anthropic Claude API for structuring transcriptions into official meeting minutes
 */

import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import type { Meeting, MinutesDraft } from '../types/meeting.types';

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

OBJECTIF : Rédiger un procès-verbal (PV) professionnel, EXHAUSTIF et DÉTAILLÉ à partir de la transcription fournie.

## ⚠️ DIRECTIVES CRUCIALES - MODE "VERBATIM INTELLIGENT"

Ta priorité absolue est de capturer TOUTE la substance des discussions. Ne résume pas à outrance.
Le lecteur doit pouvoir comprendre la nuance des débats sans avoir assisté à la réunion.

### 1. STRUCTURE PAR POINT DE L'ORDRE DU JOUR
Pour chaque point de l'ordre du jour (ODJ), tu dois produire un bloc structuré ainsi :

\`\`\`
## [Numéro]. [Titre du point tel que listé dans l'ODJ]

### Contexte (Si mentionné)
[Explication factuelle du dossier, présentation par l'urbaniste ou le président]

### Délibérations (CŒUR DU TRAVAIL)
Ici, tu dois détailler les échanges. Ne dis pas juste "ils ont discuté de X".
Dis plutôt : "M. UnTel soulève un point concernant X. Mme UneTelle répond que Y. Le Comité débat de la pertinence de Z."

RÈGLES POUR LES DÉLIBÉRATIONS :
- **Cite nommément les intervenants** quand c'est possible.
- **Rapporte les arguments** pour et contre.
- **Sépare les idées** en plusieurs paragraphes (un paragraphe par sous-thème).
- **Sois précis** sur les chiffres, dates, et lieux mentionnés.

### Issue du point
[Choisis UN format parmi les 3 options ci-dessous]
\`\`\`

### 2. FORMAT DE L'ISSUE (OBLIGATOIRE À LA FIN DE CHAQUE POINT)

**OPTION A - RÉSOLUTION** (Vote formel ou consensus clair pour une action officielle)
\`\`\`
**RÉSOLUTION CCE-[ANNÉE]-[NUMÉRO]**

CONSIDÉRANT QUE [Argument majeur 1];
CONSIDÉRANT QUE [Argument majeur 2];

IL EST RÉSOLU QUE :
Le Comité recommande au Conseil municipal de [Action précise].

_Proposé par: [Nom] | Appuyé par: [Nom] | [Adopté à l'unanimité OU détail des votes]_
\`\`\`

**OPTION B - DÉCISION / ORIENTATION** (Accord interne sans résolution au conseil)
\`\`\`
**DÉCISION :** Le Comité convient de [Action à faire par l'admistration ou les membres].
\`\`\`

**OPTION C - COMMENTAIRE / DÉPÔT** (Discussion informative)
\`\`\`
**COMMENTAIRE :** Le Comité prend acte du rapport/document. Les points saillants retenus sont : [Liste des points].
\`\`\`

### 3. CONSIGNES DE QUALITÉ
- **ORDRE DU JOUR** : Suis STRICTEMENT l'ordre du jour fourni. Si un sujet est discuté hors-ODJ, mets-le dans "Varia".
- **TON** : Professionnel, administratif, neutre.
- **PAS D'INVENTION** : Si la transcription est floue, note [Inaudible] ou résume ce qui est sûr.
- **LONGUEUR** : Mieux vaut trop long que trop court. L'utilisateur veut des détails.`;

        const userMessage = `## INFORMATIONS DE LA RÉUNION
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR (STRUCTURE À SUIVRE EXACTEMENT)
${agendaList}

## TRANSCRIPTION (Source intégrale)
${transcription}

${historicalContext || ''}

## RÉSULTAT ATTENDU
Un document prêt pour approbation, avec des délibérations riches et détaillées, et des issues clairement formatées.`;

        console.log('[Claude] Calling Cloud Function generate_minutes_claude...');

        const generateFunction = httpsCallable(functions, 'generate_minutes_claude');
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

        const finalizeFunction = httpsCallable(functions, 'finalize_draft_claude');
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
