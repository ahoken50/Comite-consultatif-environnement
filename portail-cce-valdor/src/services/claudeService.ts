/**
 * Claude AI Service for PV Generation
 * Uses Anthropic Claude API for structuring transcriptions into official meeting minutes
 */

import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import type { Meeting, MinutesDraft } from '../types/meeting.types';
import { ClaudeSanitizedResponseSchema, type ClaudeSanitizedResponse } from '../schemas/meetingSchemas';
import { ClaudeProvider } from './ai/providers/ClaudeProvider';
import { db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';

const claudeProvider = new ClaudeProvider();

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
    try {
        const draft = await claudeProvider.generateDraft(meeting, transcription, historicalContext);

        const meetingRef = doc(db, 'meetings', meeting.id);
        await updateDoc(meetingRef, {
            minutesDraft: draft,
            dateUpdated: new Date().toISOString()
        });

        return { success: true, draft };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Finalize draft with user feedback using Claude
 */
export const finalizeDraftClaude = async (
    meeting: Meeting,
    userFeedback: string
): Promise<{ success: boolean; finalContent?: string; error?: string }> => {
    try {
        const finalContent = await claudeProvider.finalizeDraft(meeting, userFeedback);

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
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Sanitize minutes content using Claude
 * Replaces sensitive info with placeholders
 */
export const sanitizeMinutesClaude = async (
    minutesContent: string
): Promise<{ success: boolean; sanitizedContent?: string; error?: string }> => {
    try {
        const sanitizedContent = await claudeProvider.sanitize(minutesContent);
        return { success: true, sanitizedContent };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Generate Executive Summary (Introduction) for the meeting
 */
export const generateExecutiveSummaryClaude = async (
    transcription: string
): Promise<{ success: boolean; summary?: string; error?: string }> => {
    try {
        const summary = await claudeProvider.generateSummary(transcription);
        return { success: true, summary };
    } catch (error) {
        return { success: false, error: (error as Error).message };
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
