import type { AIService, AIProviderId, TranscriptionResult, TranscriptionOptions, SanitizeOptions, ResolutionContext } from '../ai.types';
import type { Meeting, MinutesDraft } from '../../../types/meeting.types';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { PromptRegistry } from '../PromptRegistry';

export class ClaudeProvider implements AIService {
    id: AIProviderId = 'claude';

    isConfigured(): boolean {
        // Claude is configured via Backend (Firebase Functions), so it's always "ready" to call
        // Assuming the backend has the key.
        return true;
    }

    async transcribe(_file: File, _options?: TranscriptionOptions): Promise<TranscriptionResult> {
        // Claude doesn't have a direct file upload transcription in this architecture yet
        // Usually we use Whisper via backend. 
        // For now, we throw or return empty if not supported.
        throw new Error("Direct audio transcription with Claude is not supported yet (use Whisper/Gemini).");
    }

    async generateDraft(meeting: Meeting, transcription: string, historicalContext?: string): Promise<MinutesDraft> {
        console.log('[Claude] Calling Cloud Function generate_minutes_claude...');

        const attendeesList = meeting.attendees?.map(a => `${a.name} (${a.role})`).join('\n') || 'Non spécifié';
        const agendaList = meeting.agendaItems?.map((item, i) => `${i + 1}. ${item.title}`).join('\n') || 'Non spécifié';

        // Use Registry to construct the prompt
        // Note: Claude Function expects 'systemPrompt' and 'userMessage' separation.
        // We can pass the full prompt as userMessage if we want, or adapt the Registry.
        // For now, let's use the registry content as the primary instruction.

        const fullPrompt = PromptRegistry.minutesDraft.get({
            meetingTitle: meeting.title,
            meetingDate: meeting.date,
            meetingLocation: meeting.location || 'Salle de conférence',
            attendeesList,
            agendaList,
            transcription,
            historicalContext: historicalContext || ''
        });

        const generateFunction = httpsCallable(functions, 'generate_minutes_claude', { timeout: 540000 });
        const result = await generateFunction({
            meetingId: meeting.id,
            systemPrompt: "Tu es un rédacteur expert. Suis les instructions fournies.",
            userMessage: fullPrompt
        });

        const data = result.data as { success: boolean; content: string; error?: string };
        if (!data.success) throw new Error(data.error || 'Claude Draft Generation Failed');

        return {
            content: data.content,
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
        };
    }

    async finalizeDraft(meeting: Meeting, feedback: string): Promise<string> {
        const currentDraft = meeting.minutesDraft?.content;
        if (!currentDraft) throw new Error("No draft to finalize");

        const fullPrompt = PromptRegistry.draftFinalize.get({
            currentDraft,
            userFeedback: feedback
        });

        const finalizeFunction = httpsCallable(functions, 'finalize_draft_claude', { timeout: 540000 });
        const result = await finalizeFunction({
            meetingId: meeting.id,
            systemPrompt: "Tu es un assistant de rédaction.",
            userMessage: fullPrompt,
            userFeedback: feedback // Keeping strictly for compatibility if backend uses it
        });

        const data = result.data as { success: boolean; content: string };
        if (!data.success) throw new Error('Claude Finalize Failed');

        return data.content;
    }

    async sanitize(text: string, _options?: SanitizeOptions): Promise<string> {
        const chatFunction = httpsCallable(functions, 'chat_claude', { timeout: 300000 });
        const result = await chatFunction({
            systemPrompt: "Tu es un expert en anonymisation...",
            userMessage: text,
            temperature: 0.1
        });

        const data = result.data as { success: boolean; content: string };
        if (!data.success) throw new Error('Claude Sanitize Failed');
        return data.content;
    }

    async generateSummary(transcription: string): Promise<string> {
        const chatFunction = httpsCallable(functions, 'chat_claude', { timeout: 120000 });
        const result = await chatFunction({
            systemPrompt: "Résume cette réunion en 1 paragraphe...",
            userMessage: transcription.substring(0, 50000),
            temperature: 0.3
        });
        const data = result.data as { success: boolean; content: string };
        return data.content;
    }

    async extractProjects(_meeting: Meeting): Promise<any[]> {
        // Not implemented in legacy service yet, can add new function or use chat
        // Returning empty for now as Gemini is primary for this
        return [];
    }

    async suggestFileMatches(_fileNames: string[], _agendaItems: string[]): Promise<any[]> {
        return [];
    }

    async generateEmbedding(_text: string): Promise<number[]> {
        throw new Error('Embedding generation not supported by Claude provider yet.');
    }

    async draftResolution(_context: ResolutionContext): Promise<string> {
        throw new Error('Resolution drafting not supported by Claude provider yet.');
    }
}
