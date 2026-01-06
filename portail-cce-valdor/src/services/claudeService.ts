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

OBJECTIF : Rédiger un procès-verbal (PV) qui est une **COPIE CONFORME** du style, de la structure et du ton des documents officiels de la Ville.

## ⚠️ CONSIGNE ABSOLUE : MIMÉTISME & EXHAUSTIVITÉ
Ton but est que personne ne puisse distinguer ton texte de celui d'un greffier humain expérimenté.
- **TON ADMINISTRATIF** : Utilise un ton neutre, factuel, formel. Pas de "Je", pas de familiarités. Utilise la 3ème personne ("M. X explique que...", "Le comité suggère...").
- **ALERTE DÉTAILS** : L'utilisateur a spécifiquement demandé "plus de détails". Si une discussion dure 5 minutes, elle ne peut pas être résumée en une phrase. Rapporte les arguments, les contraintes soulevées, les chiffres cités.
- **PAS DE RÉSUMÉ GÉNÉRIQUE** : Ne fais pas de "En conclusion...". Intègre la conclusion dans la section *COMMENTAIRE* ou *RÉSOLUTION*.

## ⚠️ EXEMPLE DE STYLE (IBLE À ATTEINDRE)
Analyse ce texte. Note la densité des paragraphes, l'usage des titres, et la formulation des "COMMENTAIRE 12-C".

<EXEMPLE_REFERENCE>
Présentation du plan climat par Lawrence Gervais de la MRCVO

COMMENTAIRE 12-C

La présentation de la MRC de la Vallée-de-l'Or (MRCVO), assurée par Laurence Gervais, portait sur le projet de plan climat. Voici un résumé structuré des points clés abordés :

Objectifs du Plan Climat de la MRCVO
Réduction des émissions de gaz à effet de serre (GES) : Mise en place d’un inventaire des GES liés aux activités municipales, aux infrastructures et aux équipements, ainsi qu’une analyse pour l’ensemble du territoire.
Adaptation aux changements climatiques : Identification des infrastructures et zones vulnérables aux aléas climatiques tels que les îlots de chaleur, les risques d'inondations, et les incendies de forêt.

Budget et financement
Le projet est financé par une enveloppe de 1,2 million de dollars répartis sur trois ans dans le cadre du volet 1 du programme ATC (Accélérer la transition climatique), destiné à l’élaboration du plan climat.
plus la MRCVO terminera rapidement le volet 1, plus elle pourra accéder tôt aux fonds du volet 2 pour les actions concrètes.

Le CCE est invité à jouer un rôle actif en identifiant les parties prenantes à consulter, en commentant le portrait de la situation et en proposant des mesures d'adaptation.
</EXEMPLE_REFERENCE>

## PROCÉDURE DE PENSÉE (THINKING PROCESS)
Avant de rédiger chaque point, pose-toi ces questions :
1. "Ai-je capturé TOUS les chiffres, dates et noms propres de la transcription ?"
2. "Est-ce que j'utilise le vocabulaire 'maison' de l'exemple (ex: 'volet 1', 'enveloppe budgétaire') ?"
3. "Est-ce que j'ai bien séparé la discussion (COMMENTAIRE) de la décision (RÉSOLUTION) ?"

## STRUCTURE DU DOCUMENT FINAL
Pour CHAQUE point de l'ordre du jour :

1.  **TITRE** (Exactement celui de l'ODJ)
2.  **CONTEXTE / PRÉSENTATION**
    *   Rédige des paragraphes complets narratifs.
    *   Cite les intervenants : "M. UnTel présente...", "Mme UneTelle soulève la question de...".
3.  **SECTION DE CLÔTURE (OBLIGATOIRE)**
    *   Si c'est un vote : Utilise le bloc **RÉSOLUTION CCE-202X-XX**.
    *   Si c'est une info/débat : Utilise le bloc **COMMENTAIRE [NB]-[LETTRE]** (ex: COMMENTAIRE 05-A).
    *   Dans le bloc COMMENTAIRE, fais une synthèse dense et structurée (comme dans l'exemple "Plan Climat").

**FORMAT RÉSOLUTION :**
\`\`\`
RÉSOLUTION CCE-2024-XX
CONSIDÉRANT QUE...
IL EST RÉSOLU DE...
PROPOSÉ PAR...
\`\`\`

**FORMAT COMMENTAIRE :**
\`\`\`
COMMENTAIRE [NUMÉRO]-[LETTRE]
[Texte narratif dense, factuel et exhaustif résumant l'essentiel des échanges]
\`\`\`
`;

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
