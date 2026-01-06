/**
 * Claude AI Service for PV Generation
 * Uses Anthropic Claude API for structuring transcriptions into official meeting minutes
 */

import { db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
import type { Meeting, MinutesDraft } from '../types/meeting.types';

// Environment variable for Anthropic API key
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

// Claude API endpoint
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface ClaudeResponse {
    id: string;
    type: string;
    content: Array<{
        type: 'text';
        text: string;
    }>;
    stop_reason: string;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
    error?: {
        type: string;
        message: string;
    };
}

/**
 * Check if Claude API is configured
 */
export const isClaudeConfigured = (): boolean => {
    return !!ANTHROPIC_API_KEY;
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
    if (!ANTHROPIC_API_KEY) {
        return {
            success: false,
            error: 'Clé API Anthropic non configurée. Vérifiez VITE_ANTHROPIC_API_KEY.'
        };
    }

    try {
        const attendeesList = meeting.attendees
            ?.map(a => `${a.name} (${a.role})${a.isPresent ? '' : ' - ABSENT'}`)
            .join('\n') || 'Non spécifié';

        const agendaList = meeting.agendaItems
            ?.map((item, i) => `${i + 1}. ${item.title}`)
            .join('\n') || 'Non spécifié';

        const systemPrompt = `Tu es un rédacteur expert de procès-verbaux pour le Comité Consultatif en Environnement (CCE) de la Ville de Val-d'Or.

OBJECTIF : Rédiger un procès-verbal (PV) professionnel, COMPLET et DÉTAILLÉ à partir de la transcription fournie.

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

### Issue du point
[Choisir UN format parmi les 3 ci-dessous]
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
- **FIDÉLITÉ** : Base-toi UNIQUEMENT sur la transcription`;

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

        console.log('[Claude] Generating minutes draft...');

        const response = await fetch(CLAUDE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 8192,
                temperature: 0.1,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userMessage }
                ] as ClaudeMessage[]
            })
        });

        const result: ClaudeResponse = await response.json();

        if (result.error) {
            throw new Error(result.error.message);
        }

        const draftContent = result.content?.[0]?.text;

        if (!draftContent) {
            throw new Error('Aucun brouillon généré par Claude');
        }

        console.log(`[Claude] Draft generated: ${draftContent.length} chars, ${result.usage?.output_tokens} tokens`);

        const draft: MinutesDraft = {
            content: draftContent,
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
        };

        // Update meeting with draft
        const meetingRef = doc(db, 'meetings', meeting.id);
        await updateDoc(meetingRef, {
            minutesDraft: draft,
            dateUpdated: new Date().toISOString()
        });

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
    if (!ANTHROPIC_API_KEY) {
        return {
            success: false,
            error: 'Clé API Anthropic non configurée'
        };
    }

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

        const response = await fetch(CLAUDE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 8192,
                temperature: 0.1,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userMessage }
                ] as ClaudeMessage[]
            })
        });

        const result: ClaudeResponse = await response.json();

        if (result.error) {
            throw new Error(result.error.message);
        }

        const finalContent = result.content?.[0]?.text;

        if (!finalContent) {
            throw new Error('Aucune version finale générée');
        }

        // Update meeting
        const meetingRef = doc(db, 'meetings', meeting.id);
        await updateDoc(meetingRef, {
            'minutesDraft.content': finalContent,
            'minutesDraft.status': 'final',
            'minutesDraft.finalizedAt': new Date().toISOString(),
            'minutesDraft.userFeedback': userFeedback,
            'minutesDraft.version': (meeting.minutesDraft?.version || 0) + 1,
            dateUpdated: new Date().toISOString()
        });

        return { success: true, finalContent };

    } catch (error) {
        const err = error as Error;
        console.error('Claude finalization error:', err);
        return { success: false, error: err.message };
    }
};
