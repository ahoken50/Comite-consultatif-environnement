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

## ⚠️ CONSIGNE CRITIQUE : EXHAUSTIVITÉ MAXIMALE
L'utilisateur veut un compte-rendu presque INTÉGRAL des discussions, structuré et lisible.
- **INTERDICTION DE RÉSUMER** : Ne condense pas une discussion de 10 minutes en 3 lignes. Utilise autant de paragraphes que nécessaire pour tout couvrir.
- **DENSITÉ** : Si les intervenants échangent 5 arguments, les 5 doivent apparaître.
- **ATTRIBUTION** : Qui dit quoi ? (M. Ross explique que..., Mme Boutin demande si...)
- **CHIFFRES & FAITS** : Ne manque aucune date, aucun montant, aucune référence complexe.

## ⚠️ EXEMPLE DE STYLE À REPRODUIRE (RÉFÉRENCE ABSOLUE)
Observe la longueur, la précision et la structure de cet exemple. Ton travail DOIT être aussi riche que ceci :

<EXEMPLE_STYLE>
Présentation du plan climat par Lawrence Gervais de la MRCVO

COMMENTAIRE 12-C

La présentation de la MRC de la Vallée-de-l'Or (MRCVO), assurée par Laurence Gervais, portait sur le projet de plan climat. Voici un résumé structuré des points clés abordés :

Objectifs du Plan Climat de la MRCVO
Réduction des émissions de gaz à effet de serre (GES) : Mise en place d’un inventaire des GES liés aux activités municipales, aux infrastructures et aux équipements, ainsi qu’une analyse pour l’ensemble du territoire.
Adaptation aux changements climatiques : Identification des infrastructures et zones vulnérables aux aléas climatiques tels que les îlots de chaleur, les risques d'inondations, et les incendies de forêt.

Budget et financement
Le projet est financé par une enveloppe de 1,2 million de dollars répartis sur trois ans dans le cadre du volet 1 du programme ATC (Accélérer la transition climatique), destiné à l’élaboration du plan climat.
Volet 1 : Élaboration du plan avec des diagnostics, consultations et études.
Volet 2 (prévu pour 2025-2027) : Mise en œuvre des actions du plan climat avec des subventions couvrant jusqu’à 95 % des coûts pour des projets prioritaires.
Plus la MRCVO terminera rapidement le volet 1, plus elle pourra accéder tôt aux fonds du volet 2 pour les actions concrètes. De plus, tout surplus budgétaire du volet 1 pourra être réaffecté pour le financement direct des projets et actions prioritaires dès leur identification.

Étapes de mise en œuvre
Diagnostic environnemental et de résilience : Évaluation de la maturité environnementale des infrastructures et systèmes municipaux face aux aléas climatiques.
Consultation et concertation : La MRCVO collabore avec les autres MRC régionales et prévoit des consultations auprès des citoyens et des parties prenantes pour prioriser les actions du plan.
Élaboration des mesures d'adaptation et de réduction des GES : Sélection de mesures adaptées pour réduire les impacts environnementaux et climatiques.

Engagement et suivi
La MRC prévoit de collaborer avec les municipalités pour mobiliser les ressources locales, faciliter le partage de données, et encourager l'adhésion citoyenne.
Un suivi biennal est envisagé pour mesurer les progrès accomplis dans la réduction des GES et l’efficacité des mesures d’adaptation.

Le CCE est invité à jouer un rôle actif en identifiant les parties prenantes à consulter, en commentant le portrait de la situation et en proposant des mesures d'adaptation et de réduction des GES.
La collaboration intermunicipale et l'implication des citoyens sont des éléments clés pour la réussite du plan climat. Le CCE peut jouer un rôle de facilitateur en favorisant le dialogue entre les différents acteurs et en assurant la cohérence des actions entreprises avec les besoins du territoire.
</EXEMPLE_STYLE>

## DIRECTIVES DE RÉDACTION

### 1. STRUCTURE PAR POINT DE L'ORDRE DU JOUR
Pour chaque point, produis un contenu riche.
- **Titre** : Reprends le titre de l'ODJ.
- **Corps du texte** : Utilise des sous-titres (Contexte, Délibérations, Conclusion). Fais des paragraphes complets.
- **Conclusion du point** : Termine TOUJOURS par une section explicite :
  - Soit **RÉSOLUTION [ANNEE]-[NO]** (si vote)
  - Soit **COMMENTAIRE [ANNEE]-[LETTRE]** (si discussion/info)
  - Soit **DÉCISION** (si action sans vote)

### 2. FORMAT DES ISSUES (OBLIGATOIRE)

**POUR UNE RÉSOLUTION :**
\`\`\`
RÉSOLUTION CCE-2024-XX
[Texte juridique précis avec CONSIDÉRANT...]
IL EST RÉSOLU QUE...
_Proposé par..._
\`\`\`

**POUR UN COMMENTAIRE (Discussion) :**
\`\`\`
COMMENTAIRE 2024-X
[Texte narratif TRÈS DÉTAILLÉ du sujet traité, comme dans l'exemple ci-dessus.]
\`\`\`
`;

        const userMessage = `## INFORMATIONS DE LA RÉUNION
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR (STRUCTURE À SUIVRE STRICTEMENT)
${agendaList}

## TRANSCRIPTION (Source intégrale)
${transcription}

${historicalContext || ''}

## RÉSULTAT ATTENDU
Un procès-verbal PROFESSIONNEL, EXHAUSTIF et DÉTAILLÉ. Pas de résumés courts.`;

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
