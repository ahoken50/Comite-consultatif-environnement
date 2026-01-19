/**
 * Project Summary Service - AI-powered executive summary (#11.1)
 * Uses Groq's free API for cost-effective AI summaries
 */

import type { Project, ProjectDependency, LinkedResolution, CaucusDecision } from '../../types/project.types';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant'; // Fast and cheap model

interface SummaryResult {
    success: boolean;
    summary?: string;
    error?: string;
}

/**
 * Check if Groq API is configured
 */
export const isGroqConfigured = (): boolean => {
    return !!GROQ_API_KEY;
};

/**
 * Build the context from project data
 */
const buildProjectContext = (project: Project): string => {
    const sections: string[] = [];

    // Basic info
    sections.push(`# Projet: ${project.code} - ${project.name}`);
    sections.push(`Statut: ${project.status}`);
    sections.push(`Catégorie: ${project.category}`);
    sections.push(`Priorité: ${project.priority}`);
    if (project.isUrgent) sections.push('⚠️ URGENT');

    // Description
    if (project.description) {
        sections.push(`\n## Description\n${project.description}`);
    }

    // Current details
    if (project.currentDetails) {
        sections.push(`\n## Détails actuels\n${project.currentDetails}`);
    }

    // Next steps
    if (project.nextSteps) {
        sections.push(`\n## Prochaines étapes\n${project.nextSteps}`);
    }

    // Dependencies
    if (project.dependencies && project.dependencies.length > 0) {
        const depsText = project.dependencies
            .map((d: ProjectDependency) => `- ${d.dependencyType}: ${d.dependsOnProjectCode} - ${d.dependsOnProjectName}`)
            .join('\n');
        sections.push(`\n## Dépendances\n${depsText}`);
    }

    // Linked resolutions
    if (project.linkedResolutions && project.linkedResolutions.length > 0) {
        const resText = project.linkedResolutions
            .map((r: LinkedResolution) => `- ${r.entryNumber} (${r.meetingTitle}): ${r.entryContent.substring(0, 100)}...`)
            .join('\n');
        sections.push(`\n## Résolutions liées\n${resText}`);
    }

    // Caucus decisions
    if (project.caucusDecisions && project.caucusDecisions.length > 0) {
        const decsText = project.caucusDecisions
            .map((d: CaucusDecision) => `- ${d.date}: ${d.description}`)
            .join('\n');
        sections.push(`\n## Décisions du Conseil\n${decsText}`);
    }

    // Tags
    if (project.tags && project.tags.length > 0) {
        sections.push(`\n## Tags\n${project.tags.join(', ')}`);
    }

    // Progress
    sections.push(`\n## Progression: ${project.completionPercentage}%`);

    // Dates
    sections.push(`\nCréé: ${project.dateCreated}`);
    sections.push(`Dernière mise à jour: ${project.dateUpdated}`);
    if (project.estimatedCompletionDate) {
        sections.push(`Date de complétion estimée: ${project.estimatedCompletionDate}`);
    }

    return sections.join('\n');
};

/**
 * Generate an executive summary for a project using Groq
 */
export const generateProjectSummary = async (project: Project): Promise<SummaryResult> => {
    if (!isGroqConfigured()) {
        return {
            success: false,
            error: 'Clé API Groq non configurée. Ajoutez VITE_GROQ_API_KEY dans vos variables d\'environnement.'
        };
    }

    const projectContext = buildProjectContext(project);

    const prompt = `Tu es un assistant spécialisé dans la gestion de projets environnementaux municipaux.

Voici les informations d'un projet du Comité Consultatif en Environnement (CCE) de Val-d'Or:

${projectContext}

---

Génère un **résumé exécutif** concis (3-5 phrases) de ce projet en français. Le résumé doit:
1. Expliquer l'objectif principal du projet
2. Indiquer son état d'avancement actuel et les éventuels blocages
3. Mentionner les prochaines étapes clés si pertinent
4. Être rédigé dans un style professionnel mais accessible

Résumé:`;

    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 500,
                top_p: 1
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Groq API error:', errorData);
            return {
                success: false,
                error: `Erreur API Groq: ${response.status} ${response.statusText}`
            };
        }

        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content?.trim();

        if (!summary) {
            return {
                success: false,
                error: 'Réponse vide de l\'API'
            };
        }

        return {
            success: true,
            summary
        };

    } catch (error) {
        console.error('Error generating summary:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
    }
};

