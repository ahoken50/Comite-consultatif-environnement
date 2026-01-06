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

## ⚠️ EXEMPLE DE STYLE À REPRODUIRE (RÉFÉRENCE ABSOLUE)
Tu dois imiter le ton, la structure et la densité de cet exemple. Note comment les "COMMENTAIRES" sont rédigés comme des articles complets et précis.

<EXEMPLE_STYLE>
Présentation du plan climat par Lawrence Gervais de la MRCVO

COMMENTAIRE XX-C

La présentation de la MRC de la Vallée-de-l'Or (MRCVO), assurée par Laurence Gervais, portait sur le projet de plan climat. Voici un résumé structuré des points clés abordés :

Objectifs du Plan Climat de la MRCVO
Réduction des émissions de gaz à effet de serre (GES) : Mise en place d’un inventaire des GES liés aux activités municipales, aux infrastructures et aux équipements, ainsi qu’une analyse pour l’ensemble du territoire.

Budget et financement
Le projet est financé par une enveloppe de 1,2 million de dollars répartis sur trois ans dans le cadre du volet 1 du programme ATC.
Volet 1 : Élaboration du plan avec des diagnostics, consultations et études.
Volet 2 (prévu pour 2025-2027) : Mise en œuvre des actions avec des subventions couvrant jusqu’à 95 % des coûts.

Étapes de mise en œuvre
Diagnostic environnemental et de résilience : Évaluation de la maturité environnementale des infrastructures.
Consultation et concertation : La MRCVO collaborera avec les autres MRC régionales.

Le CCE est invité à jouer un rôle actif en identifiant les parties prenantes à consulter. La collaboration intermunicipale et l'implication des citoyens sont des éléments clés pour la réussite du plan climat.
</EXEMPLE_STYLE>

## ⚠️ DIRECTIVES DE RÉDACTION

### 1. STRUCTURE PAR POINT DE L'ORDRE DU JOUR
Pour chaque point, produis un contenu riche.
- **Titre** : Reprends le titre de l'ODJ.
- **Corps du texte** : Utilise des sous-titres si nécessaire (Contexte, Détails, Conclusion). Fais des paragraphes complets.
- **Conclusion du point** : Termine TOUJOURS par une section explicite :
  - Soit **RÉSOLUTION [ANNEE]-[NO]** (si vote)
  - Soit **COMMENTAIRE [ANNEE]-[LETTRE]** (si discussion/info)
  - Soit **DÉCISION** (si action sans vote)

### 2. DÉTAILS ET PRÉCISION
- Ne sois PAS évasif.
- Si M. Ross parle du "programme OASIS volet 1", explique ce que c'est d'après ce qu'il dit.
- Rapporte les chiffres, les montants ($), les dates.
- Nomme les intervenants quand ils apportent une idée spécifique.

### 3. FORMAT DES ISSUES
Inspire-toi de ces formats :

**POUR UNE RÉSOLUTION :**
\`\`\`
RÉSOLUTION CCE-2024-XX
L’ordre du jour est adopté en laissant l’item varia ouvert.
_Proposé par..._
\`\`\`

**POUR UN COMMENTAIRE (Discussion) :**
\`\`\`
COMMENTAIRE 2024-X
[Texte narratif détaillé résumant la présentation et les échanges, comme dans l'exemple ci-dessus]
\`\`\`
`;

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
