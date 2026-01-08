/**
 * AI Prompts - Speaking Points
 * Generate presentation points for council recommendations
 */

import type { SpeakingPointsInput } from '../types/api.types';

/**
 * Prompt for generating speaking points for a recommendation
 */
export const getSpeakingPointsPrompt = (recommendation: SpeakingPointsInput): string => `Tu es un conseiller politique expert. Ta tâche est de préparer des "Speaking Points" (points de discussion) pour un élu municipal qui doit présenter cette recommandation au conseil de ville.

TITRE : ${recommendation.projectName || 'Non spécifié'}
DESCRIPTION : ${recommendation.description || 'Non spécifié'}
IMPACT ENVIRONNEMENTAL : ${recommendation.impactAnalysis?.environmentalImpact || 'Non spécifié'}
EFFORT DE MISE EN OEUVRE : ${recommendation.impactAnalysis?.implementationEffort || 'Non spécifié'}
COÛT ESTIMÉ : ${recommendation.impactAnalysis?.financial || 'Non spécifié'}

CONTEXTE SUPPLÉMENTAIRE (Commentaires du PV, Discussions précédentes) :
${recommendation.notes || 'Aucun contexte supplémentaire'}

PRODUIS 3 à 5 POINTS CLÉS (Bullet points) :
1. Pourquoi c'est important (L'accroche)
2. Quel est l'bénéfice direct pour la ville/citoyens (L'argument fort) - Utilise les commentaires du PV si pertinents pour appuyer l'argument.
3. Pourquoi la mise en oeuvre est réaliste (La faisabilité)

Ton ton doit être convaincant, clair et concis. Prêt à être lu à l'oral.`;
