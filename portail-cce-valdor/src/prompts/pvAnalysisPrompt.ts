/**
 * AI Prompts - PV Analysis
 * Prompts for analyzing and verifying PV content
 */

import type { PVStructure, VerificationResult } from '../types/api.types';

/**
 * Prompt for analyzing PV structure
 */
export const getPVStructureAnalysisPrompt = (pvText: string): string => `Tu es un expert en analyse de Procès-Verbaux municipaux.
Ta mission est d'analyser le texte suivant et d'extraire une structure JSON stricte.

TEXTE DU PV :
${pvText.substring(0, 30000)}

INSTRUCTIONS :
Extrais les éléments suivants au format JSON uniquement (sans markdown) :
1. "summary": Bref résumé du PV.
2. "agendaItems": Liste des points (id, title, resolutionNumber, content).
3. "resolutions": Liste des résolutions formelles (number, text).
4. "deadlines": Échéances mentionnées (date, task, responsible).
5. "departments": Départements responsables cités.
6. "laws": Lois et règlements cités (reference, description, context).

FORMAT JSON ATTENDU :
{
  "summary": "...",
  "agendaItems": [...],
  "resolutions": [...],
  "deadlines": [...],
  "departments": [...],
  "laws": [...]
}`;

/**
 * Prompt for verifying legal claims and deadlines
 */
export const getPVVerificationPrompt = (
    laws: PVStructure['laws'],
    deadlines: PVStructure['deadlines']
): string => {
    const claimsText = JSON.stringify({ laws, deadlines }, null, 2);

    return `Tu es un assistant juridique et administratif expert (Québec/Canada).
Vérifie la validité des références légales et des échéances suivantes extraites d'un PV.

CONTEXTE À VÉRIFIER :
${claimsText}

TÂCHE :
Pour chaque loi ou échéance, vérifie si elle semble conforme aux normes actuelles (LQE, MELCCFP, etc.).
Si tu as accès à la recherche, utilise-la. Sinon, utilise tes connaissances.

FORMAT JSON ATTENDU (Liste d'objets) :
[
  {
    "claim": "Référence à l'article 22 LQE",
    "status": "verified" | "warning" | "info",
    "analysis": "L'article 22 est bien pertinent pour...",
    "source": "Loi sur la qualité de l'environnement"
  }
]`;
};

/**
 * Prompt for drafting recommendations based on PV analysis
 */
export const getDraftRecommendationsPrompt = (
    structure: PVStructure,
    verification: VerificationResult[]
): string => `Basé sur l'analyse suivante d'un PV et les vérifications effectuées, rédige des recommandations d'action concrètes.

STRUCTURE DU PV :
${JSON.stringify(structure).substring(0, 15000)}

VÉRIFICATIONS :
${JSON.stringify(verification).substring(0, 5000)}

TÂCHE :
Rédige des recommandations courtes et orientées vers l'action (ex: "Mettre à jour...", "Budgéter...").
Lie chaque recommandation à une résolution source si possible.

FORMAT JSON ATTENDU :
[
  {
    "id": "rec_1",
    "title": "Action courte",
    "description": "Détail de l'action...",
    "priority": "Haute" | "Moyenne" | "Basse",
    "rationale": "Justification...",
    "sourceResolutionNumber": "2024-..."
  }
]`;

/**
 * Prompt for finalizing a draft with user feedback
 */
export const getFinalizeDraftPrompt = (
    currentDraft: string,
    userFeedback: string
): string => `Tu es un rédacteur de procès-verbaux. Voici un brouillon de procès-verbal et les corrections demandées par l'utilisateur.

## BROUILLON ACTUEL
${currentDraft}

## CORRECTIONS ET FEEDBACK
${userFeedback}

## INSTRUCTIONS
1. Intègre toutes les corrections demandées
2. Supprime tous les marqueurs [À VÉRIFIER]
3. Assure-toi que le format est cohérent et professionnel
4. Ne modifie pas ce qui n'a pas été demandé
5. Produis la version finale du procès-verbal

## FORMAT DE SORTIE
Génère le procès-verbal final, prêt à être imprimé.`;
