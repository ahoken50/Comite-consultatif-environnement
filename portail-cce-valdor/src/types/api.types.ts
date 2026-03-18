/**
 * API Response Types
 * Strict typing for all AI service responses
 */

// ============================================
// GEMINI API TYPES
// ============================================

export interface GeminiContentPart {
    text: string;
}

export interface GeminiContent {
    parts: GeminiContentPart[];
}

export interface GeminiCandidate {
    content: GeminiContent;
    finishReason?: string;
    safetyRatings?: Array<{
        category: string;
        probability: string;
    }>;
}

export interface GeminiResponse {
    candidates?: GeminiCandidate[];
    promptFeedback?: {
        safetyRatings?: Array<{
            category: string;
            probability: string;
        }>;
    };
    error?: {
        code: number;
        message: string;
        status: string;
    };
}

export interface GeminiFileUploadResponse {
    file: {
        name: string;
        uri: string;
        mimeType: string;
        state: string;
        sizeBytes?: string;
        createTime?: string;
        updateTime?: string;
    };
}

// ============================================
// CLAUDE API TYPES
// ============================================

export interface ClaudeFunctionResponse {
    success: boolean;
    content: string;
    error?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export interface ClaudeSanitizedAttendee {
    id: string;
    name: string;
    role?: string;
}

export interface ClaudeSanitizedMinuteEntry {
    type: 'resolution' | 'comment';
    content: string;
    number?: string;
}

export interface ClaudeSanitizedAgendaItem {
    id: string;
    title: string;
    decision?: string;
    proposer?: string;
    seconder?: string;
    minuteEntries?: ClaudeSanitizedMinuteEntry[];
}

export interface ClaudeSanitizedResponse {
    minutes: string;
    attendees?: ClaudeSanitizedAttendee[];
    agendaItems?: ClaudeSanitizedAgendaItem[];
}

// ============================================
// TRANSCRIPTION TYPES
// ============================================

export interface TranscriptionResult {
    success: boolean;
    transcription?: string;
    chunks?: number;
    duration?: number;
    error?: string;
}

export interface TranscriptionProgress {
    status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
    progress?: number; // 0-100
    message?: string;
}

// ============================================
// AI EXTRACTION TYPES
// ============================================

export interface SuggestedProject {
    name: string;
    category: 'water' | 'biodiversity' | 'regulation' | 'waste' | 'emergency' | 'innovation' | 'operations' | 'climate';
    priority: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    nextSteps: string;
    isUrgent: boolean;
    sourceResolution?: string;
    estimatedEffort?: string;
}

export interface ProjectExtractionResult {
    projects: SuggestedProject[];
}

// ============================================
// PV STRUCTURE TYPES (AI Analysis)
// ============================================

export interface PVStructureAgendaItem {
    id: string;
    title: string;
    resolutionNumber?: string;
    content?: string;
}

export interface PVStructureResolution {
    number: string;
    text: string;
}

export interface PVStructureDeadline {
    date: string;
    task: string;
    responsible?: string;
}

export interface PVStructureLaw {
    reference: string;
    description: string;
    context?: string;
}

export interface PVStructure {
    summary: string;
    agendaItems: PVStructureAgendaItem[];
    resolutions: PVStructureResolution[];
    deadlines: PVStructureDeadline[];
    departments: string[];
    laws: PVStructureLaw[];
}

// ============================================
// VERIFICATION TYPES
// ============================================

export interface VerificationResult {
    claim: string;
    status: 'verified' | 'warning' | 'info' | 'error';
    analysis: string;
    source?: string;
}

// ============================================
// RECOMMENDATION TYPES (AI Generated)
// ============================================

export interface DraftRecommendation {
    id: string;
    title: string;
    description: string;
    priority: 'Haute' | 'Moyenne' | 'Basse';
    rationale: string;
    sourceResolutionNumber?: string;
    resolutions?: {
        number: string;
        title: string;
        text: string;
    }[];
}

// ============================================
// SPEAKING POINTS TYPES
// ============================================

export interface SpeakingPointsInput {
    projectName?: string;
    description?: string;
    impactAnalysis?: {
        environmentalImpact?: string;
        implementationEffort?: string;
        financial?: string;
    };
    notes?: string;
}

// ============================================
// HISTORICAL CONTEXT TYPES
// ============================================

export interface HistoricalResolution {
    number: string;
    date: string;
    title: string;
    summary: string;
}

export interface RelatedProject {
    code: string;
    name: string;
    status: string;
}

export interface HistoricalContext {
    resolutions: HistoricalResolution[];
    relatedProjects: RelatedProject[];
}
