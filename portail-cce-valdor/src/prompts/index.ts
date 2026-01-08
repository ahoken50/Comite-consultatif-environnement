/**
 * AI Prompts - Index
 * Central export for all AI prompts
 */

// Minutes Draft
export {
    formatAttendeesList,
    formatAgendaList,
    getClaudeMinutesDraftSystemPrompt,
    getClaudeMinutesDraftUserMessage,
    getGeminiMinutesDraftPrompt
} from './minutesDraftPrompt';

// Sanitization
export {
    getSanitizationSystemPrompt,
    getSanitizationUserMessage,
    getJsonSanitizationSystemPrompt,
    getJsonSanitizationUserMessage
} from './sanitizationPrompt';

// Project Extraction
export {
    formatAgendaItemsForExtraction,
    getProjectExtractionPrompt
} from './projectExtractionPrompt';

// Transcription
export {
    getTranscriptionPrompt,
    getTranscriptionCleanupPrompt
} from './transcriptionPrompt';

// Speaking Points
export {
    getSpeakingPointsPrompt
} from './speakingPointsPrompt';

// PV Analysis
export {
    getPVStructureAnalysisPrompt,
    getPVVerificationPrompt,
    getDraftRecommendationsPrompt,
    getFinalizeDraftPrompt
} from './pvAnalysisPrompt';
