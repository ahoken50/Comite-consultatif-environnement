import type { Meeting, MinutesDraft } from '../../types/meeting.types';

export type AIProviderId = 'gemini' | 'claude' | 'openai';

export interface AIServiceConfig {
    provider: AIProviderId;
    apiKey?: string;
    model?: string;
    temperature?: number;
}

export interface TranscriptionOptions {
    language?: string; // 'fr'
    prompt?: string;
}

export interface TranscriptionResult {
    text: string;
    metrics?: {
        duration: number;
        cost?: number;
    };
}

export interface SanitizeOptions {
    preserveOfficials?: boolean;
    maskAddresses?: boolean;
}

export interface ActionItem {
    description: string;
    assignee?: string;
    deadline?: string;
    sourceResolution?: string;
}

export interface SuggestedProject {
    name: string;
    description: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    isUrgent: boolean;
    sourceResolution?: string;
    nextSteps?: string;
}


export interface AIService {
    id: AIProviderId;

    /**
     * Check if the service is configured and ready
     */
    isConfigured(): boolean;

    /**
     * Transcribe an audio file to text
     */
    transcribe(file: File, options?: TranscriptionOptions): Promise<TranscriptionResult>;

    /**
     * Generate a minutes draft from a transcription
     * @param meeting - Full meeting context
     * @param transcription - The raw text
     * @param historicalContext - Optional past resolutions for context
     */
    generateDraft(meeting: Meeting, transcription: string, historicalContext?: string): Promise<MinutesDraft>;

    /**
     * Refine an existing draft based on user feedback
     */
    finalizeDraft(meeting: Meeting, feedback: string): Promise<string>;

    /**
     * Anonymize sensitive information from text
     */
    sanitize(text: string, options?: SanitizeOptions): Promise<string>;

    /**
     * generating executive summary
     */
    generateSummary(transcription: string): Promise<string>;

    /**
     * Extract structured projects from the PV
     */
    extractProjects(meeting: Meeting): Promise<SuggestedProject[]>;

    /**
     * Suggest associations between file names and agenda items
     */
    suggestFileMatches(fileNames: string[], agendaItems: string[]): Promise<Array<{ fileName: string; agendaItemTitle: string; confidence: number }>>;

    /**
     * Generate text embeddings for semantic search
     * @param text - Text to embed
     * @returns Array of floating point numbers (vector)
     */
    generateEmbedding(text: string): Promise<number[]>;

    /**
     * Draft a specific resolution based on context and similar precedents
     */
    draftResolution(context: ResolutionContext): Promise<string>;
}

export interface ResolutionContext {
    title: string;
    description: string;
    similarResolutions: Array<{
        content: string;
        similarity: number;
        source?: string;
    }>;
}
