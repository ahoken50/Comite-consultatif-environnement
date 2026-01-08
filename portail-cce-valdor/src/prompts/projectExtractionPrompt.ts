/**
 * AI Prompts - Project Extraction
 * Extract actionable projects from meeting minutes
 */

import type { Meeting } from '../types/meeting.types';

/**
 * Format agenda items with resolutions for AI context
 */
export const formatAgendaItemsForExtraction = (meeting: Meeting): string => {
    return (meeting.agendaItems || []).map((item, index) => {
        let itemText = `### Point ${index + 1}: ${item.title}\n`;
        itemText += `- Objectif: ${item.objective || 'Non spécifié'}\n`;

        if (item.decision) {
            itemText += `- Décision: ${item.decision}\n`;
        }

        if (item.minuteEntries && item.minuteEntries.length > 0) {
            itemText += `- Résolutions/Commentaires:\n`;
            item.minuteEntries.forEach(entry => {
                const prefix = entry.type === 'resolution' ? '📋 Résolution' : '💬 Commentaire';
                itemText += `  - ${prefix} ${entry.number || ''}: ${entry.content}\n`;
            });
        }

        return itemText;
    }).join('\n');
};

/**
 * Prompt for extracting actionable projects from a meeting
 */
export const getProjectExtractionPrompt = (meeting: Meeting): string => {
    const agendaItemsFormatted = formatAgendaItemsForExtraction(meeting);

    return `Tu es un assistant expert en gestion de comités consultatifs environnementaux municipaux.

Analyse le procès-verbal suivant et extrait les **projets actionnables** qui nécessitent un suivi.

## Réunion: ${meeting.title}
## Date: ${meeting.date}
## Type: ${meeting.type}

## Notes générales:
${meeting.minutes || 'Aucune note générale'}

## Points de l'ordre du jour:
${agendaItemsFormatted || "Aucun point à l'ordre du jour"}

---

## Instructions:
1. Identifie chaque action, engagement ou projet mentionné dans les résolutions
2. Ignore les points purement informatifs sans action requise (ex: approbation de l'ordre du jour, adoption du PV précédent)
3. Regroupe les actions similaires en un seul projet
4. Utilise les catégories: water, biodiversity, regulation, waste, emergency, innovation, operations, climate

## Format de réponse (JSON uniquement, sans markdown):
{
  "projects": [
    {
      "name": "Titre clair et concis du projet",
      "category": "water",
      "priority": "medium",
      "description": "Description détaillée de ce qui doit être fait",
      "nextSteps": "Prochaines étapes immédiates",
      "isUrgent": false,
      "sourceResolution": "CCE-2024-15",
      "estimatedEffort": "Court terme"
    }
  ]
}

Si aucun projet actionnable n'est trouvé, retourne: {"projects": []}`;
};
