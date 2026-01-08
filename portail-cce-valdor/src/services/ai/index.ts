/**
 * AI Services - Modular exports
 * 
 * This index file re-exports AI functions for backward compatibility.
 * The main services are:
 * - claudeService: Transcription and Minutes generation
 * - geminiService: Projects extraction, recommendations, sanitization
 * - ocrService: PDF OCR with Gemini Vision
 */

// Re-export from geminiService (main file kept for now, will be split later)
export {
    // Project extraction
    extractProjectsFromPV,
    type SuggestedProject,

    // Recommendations
    generateSpeakingPoints,
    draftAIRecommendations,

    // Sanitization
    sanitizeMinutes,

    // Workflow
    analyzePVStructure,
    verifyPVClaims,

    // Historical context
    buildHistoricalContext,
    type HistoricalContext,

    // Config check
    isGeminiConfigured,

    // Legacy - kept for compatibility (transcription/minutes now use Claude)
    finalizeDraft,
} from '../geminiService';

// Claude service - primary for transcription and minutes
export {
    generateMinutesDraftClaude,
    finalizeDraftClaude,
    sanitizeMinutesClaude,
    sanitizeMeetingClaude,
    isClaudeConfigured,
} from '../claudeService';

// OCR service
export {
    extractTextFromPDF,
    isOCRConfigured,
    ocrImage,
} from '../ocrService';
