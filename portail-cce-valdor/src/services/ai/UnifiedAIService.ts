import type { AIService, AIProviderId, TranscriptionResult, TranscriptionOptions, SanitizeOptions, ActionItem } from './ai.types';
import type { Meeting, MinutesDraft } from '../../types/meeting.types';

// Registry of available providers (will be populated as we refactor)
import { GeminiProvider } from './providers/GeminiProvider';
import { ClaudeProvider } from './providers/ClaudeProvider';

const providers: Record<string, AIService> = {};
const gemini = new GeminiProvider();
const claude = new ClaudeProvider();

providers['gemini'] = gemini;
providers['claude'] = claude;


export class UnifiedAIService implements AIService {
    id: AIProviderId = 'gemini'; // Default
    private fallbackOrder: AIProviderId[] = ['gemini', 'claude'];

    constructor(defaultProvider: AIProviderId = 'gemini') {
        this.id = defaultProvider;
    }

    /**
     * Register a provider implementation
     */
    static registerProvider(service: AIService) {
        providers[service.id] = service;
    }

    /**
     * Get the active provider
     */
    private getProvider(): AIService {
        const primary = providers[this.id];
        if (primary && primary.isConfigured()) return primary;

        // Fallback logic
        for (const pid of this.fallbackOrder) {
            const p = providers[pid];
            if (p && p.isConfigured()) {
                console.warn(`Primary AI provider ${this.id} unavailable, falling back to ${pid}`);
                return p;
            }
        }

        throw new Error(`No configured AI provider available. Please check API keys for: ${this.fallbackOrder.join(', ')}`);
    }

    isConfigured(): boolean {
        return Object.values(providers).some(p => p.isConfigured());
    }

    async transcribe(file: File, options?: TranscriptionOptions): Promise<TranscriptionResult> {
        return this.getProvider().transcribe(file, options);
    }

    async generateDraft(meeting: Meeting, transcription: string, historicalContext?: string): Promise<MinutesDraft> {
        return this.getProvider().generateDraft(meeting, transcription, historicalContext);
    }

    async finalizeDraft(meeting: Meeting, feedback: string): Promise<string> {
        return this.getProvider().finalizeDraft(meeting, feedback);
    }

    async sanitize(text: string, options?: SanitizeOptions): Promise<string> {
        return this.getProvider().sanitize(text, options);
    }

    async generateSummary(transcription: string): Promise<string> {
        return this.getProvider().generateSummary(transcription);
    }

    async extractActionItems(minutesContent: string): Promise<ActionItem[]> {
        return this.getProvider().extractActionItems(minutesContent);
    }
}

// Singleton instance
export const aiService = new UnifiedAIService();
