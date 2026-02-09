/**
 * SmartPV Agent Types — Pipeline complet en 10 étapes
 *
 * 1. 🎙️ TRANSCRIPTION     → Audio → Texte (Whisper/Speechmatics)
 * 2. 🔍 IDENTIFICATION     → Identification des locuteurs (ML)
 * 3. 🧹 NETTOYAGE          → Nettoyage + fusion segments
 * 4. 📋 ANALYSE ODJ        → Mapping discussions → Points ordre du jour
 * 5. 🏷️ CLASSIFICATION     → Catégorisation thématique + sentiment
 * 6. ✍️ RÉDACTION          → Génération brouillon PV (résolutions, commentaires)
 * 7. 🔄 RÉFLEXION          → Auto-critique + corrections automatiques (boucle)
 * 8. ✅ VALIDATION USER    → Point de contrôle humain
 * 9. 📊 COMPARAISON        → Vérification cohérence avec PV historiques (boucle)
 * 10. 🧠 APPRENTISSAGE     → Mise à jour modèles avec corrections
 */

import type { AgendaItem, Meeting } from './meeting.types';
import type { Member } from './member.types';

// ============================================================================
// Agent Step Definitions
// ============================================================================

export type AgentStepId =
    | 'transcription'       // Step 1: Audio → Text
    | 'identification'      // Step 2: Speaker identification
    | 'cleaning'            // Step 3: Cleanup + merge segments
    | 'odj_analysis'        // Step 4: Map discussions → ODJ items
    | 'classification'      // Step 5: Thematic categorization + sentiment
    | 'drafting'            // Step 6: Generate PV draft (resolutions, comments)
    | 'reflection'          // Step 7: Self-critique + auto-corrections (loop)
    | 'user_validation'     // Step 8: Human checkpoint
    | 'comparison'          // Step 9: Historical PV consistency check (loop)
    | 'learning';           // Step 10: Update models with corrections

export type AgentStepStatus =
    | 'pending'     // Not started
    | 'running'     // Currently executing
    | 'awaiting'    // Waiting for user validation
    | 'completed'   // Successfully completed
    | 'skipped'     // Skipped (e.g., no audio for transcription)
    | 'error';      // Failed

export interface AgentStep {
    id: AgentStepId;
    label: string;
    description: string;
    status: AgentStepStatus;
    progress?: number;    // 0-100
    result?: unknown;     // Step-specific result
    error?: string;
    icon?: string;        // Emoji icon for UI
    iterationCount?: number; // For loop steps (reflection, comparison)
}

// ============================================================================
// Step Results
// ============================================================================

/** Step 1: Transcription */
export interface TranscriptionResult {
    text: string;
    duration: number;     // seconds
    speakers?: string[];  // Detected speakers
    engine?: 'whisper' | 'speechmatics' | 'salad' | 'gemini';
}

/** Step 2: Speaker Identification */
export interface IdentificationResult {
    speakerMapping: Record<string, string>; // speaker_label → member_name
    confidence: Record<string, number>;     // speaker_label → confidence score
    unidentified: string[];                 // Labels not matched
    totalSegments: number;
    identifiedSegments: number;
}

/** Step 3: Cleaning */
export interface CleaningResult {
    cleanedText: string;
    removedDuplicates: number;
    mergedSegments: number;
    hallucinations: string[];  // Detected hallucination patterns removed
}

/** Step 4: ODJ Analysis */
export interface ODJAnalysisResult {
    mappedItems: Array<{
        odjItemId: string;
        odjTitle: string;
        odjOrder: number;
        transcriptSegments: string[];  // Multiple segments per item
        speakers: string[];            // Who spoke on this item
        confidence: number;
        startTime?: number;
        endTime?: number;
    }>;
    unmappedSegments: string[];
    coveragePercent: number;  // % of ODJ items covered
}

/** Step 5: Classification */
export interface ClassificationResult {
    items: Array<{
        odjItemId: string;
        odjTitle: string;
        categories: string[];          // e.g., ['environnement', 'urbanisme']
        sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
        issueType: 'resolution' | 'comment' | 'decision' | 'information';
        priority: 'high' | 'medium' | 'low';
        keywords: string[];
        summary: string;               // One-line summary
    }>;
    globalThemes: string[];            // Meeting-wide themes
    globalSentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
}

/** Step 6: Drafting */
export interface DraftingResult {
    pvContent: string;                 // Full PV text (formatted)
    resolutions: Array<{
        number: string;                // e.g., "06-25"
        content: string;
        proposer?: string;
        seconder?: string;
        odjItemId: string;
    }>;
    comments: Array<{
        number: string;                // e.g., "06-A"
        content: string;
        odjItemId: string;
    }>;
    attendees: {
        present: string[];
        absent: string[];
        guests: string[];
    };
    header: {
        assemblyNumber: number;
        assemblyType: string;          // "ordinaire" | "extraordinaire"
        date: string;
        time: string;
        location: string;
    };
}

/** Step 7: Reflection (self-critique loop) */
export interface ReflectionResult {
    iterations: Array<{
        iterationNumber: number;
        issues: Array<{
            type: 'factual_error' | 'missing_info' | 'formatting' | 'inconsistency' | 'hallucination' | 'style';
            severity: 'critical' | 'major' | 'minor';
            location: string;          // Where in the PV
            description: string;
            suggestedFix: string;
            applied: boolean;
        }>;
        correctedContent: string;
    }>;
    totalIssuesFound: number;
    totalIssuesFixed: number;
    finalContent: string;
    qualityScore: number;              // 0-100
}

/** Step 8: User Validation */
export interface UserValidationResult {
    approved: boolean;
    userEdits?: string;                // User's manual edits (diff or full text)
    userComments?: string;             // User's feedback
    validatedAt: string;               // ISO string
    validatedBy?: string;              // User ID
}

/** Step 9: Historical Comparison */
export interface ComparisonResult {
    historicalPVs: Array<{
        meetingId: string;
        meetingDate: string;
        meetingTitle: string;
        similarity: number;            // 0-1
    }>;
    consistencyChecks: Array<{
        type: 'numbering' | 'format' | 'terminology' | 'attendance' | 'resolution_style';
        status: 'pass' | 'warning' | 'fail';
        message: string;
        suggestion?: string;
    }>;
    formatScore: number;               // 0-100 (how well it matches historical format)
    corrections: Array<{
        location: string;
        before: string;
        after: string;
        reason: string;
    }>;
    finalContent: string;
}

/** Step 10: Learning */
export interface LearningResult {
    modelsUpdated: string[];           // Which models were updated
    feedbackRecorded: boolean;
    stylePatterns: number;             // Number of style patterns learned
    terminologyUpdates: number;        // Number of terminology updates
    nextMeetingHints: string[];        // Suggestions for next meeting
}

// ============================================================================
// Legacy compatibility aliases
// ============================================================================

/** @deprecated Use ODJAnalysisResult instead */
export type AnalysisResult = ODJAnalysisResult;

/** @deprecated Use DraftingResult.resolutions/comments instead */
export interface ExtractionResult {
    resolutions: Array<{
        number: string;
        content: string;
        proposer?: string;
        seconder?: string;
    }>;
    comments: Array<{
        number: string;
        content: string;
    }>;
    attendees: {
        present: string[];
        absent: string[];
    };
}

/** @deprecated Use ComparisonResult instead */
export interface ValidationResult {
    isValid: boolean;
    coverage: number;
    warnings: string[];
    suggestions: string[];
}

/** @deprecated Use DraftingResult instead */
export interface GenerationResult {
    agendaItems: AgendaItem[];
    globalNotes: string;
    pdfUrl?: string;
}

// ============================================================================
// Agent State
// ============================================================================

export interface AgentState {
    meetingId: string;
    meetingNumber: number;
    mode: 'classic' | 'smartpv';
    steps: AgentStep[];
    currentStepIndex: number;
    results: {
        transcription?: TranscriptionResult;
        identification?: IdentificationResult;
        cleaning?: CleaningResult;
        odj_analysis?: ODJAnalysisResult;
        classification?: ClassificationResult;
        drafting?: DraftingResult;
        reflection?: ReflectionResult;
        user_validation?: UserValidationResult;
        comparison?: ComparisonResult;
        learning?: LearningResult;
    };
    startedAt?: Date;
    completedAt?: Date;
    // Pipeline metadata
    pipelineVersion: string;           // e.g., "2.0"
    totalDuration?: number;            // Total pipeline duration in ms
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
    meeting: Meeting;
    members: Member[];
    audioFile?: File;
    existingTranscription?: string;
    // Pipeline options
    skipTranscription?: boolean;       // Skip if transcription already exists
    skipIdentification?: boolean;      // Skip speaker identification
    maxReflectionIterations?: number;  // Default: 3
    enableHistoricalComparison?: boolean; // Default: true
    enableLearning?: boolean;          // Default: true
    // Callbacks
    onStepComplete?: (stepId: AgentStepId, result: unknown) => void;
    onValidationRequired?: (stepId: AgentStepId, result: unknown) => Promise<boolean | unknown>;
    onError?: (stepId: AgentStepId, error: Error) => void;
    onProgress?: (stepId: AgentStepId, progress: number) => void;
}

// ============================================================================
// CCE Numbering
// ============================================================================

export interface CCENumbering {
    assemblyNumber: number;  // e.g., 6 for 6th assembly
    nextResolution: number;  // e.g., 25 → "06-25"
    nextComment: string;     // e.g., "A" → "06-A"
}

export const getNextResolutionNumber = (numbering: CCENumbering): string => {
    const assembly = String(numbering.assemblyNumber).padStart(2, '0');
    const resolution = String(numbering.nextResolution).padStart(2, '0');
    return `${assembly}-${resolution}`;
};

export const getNextCommentNumber = (numbering: CCENumbering): string => {
    const assembly = String(numbering.assemblyNumber).padStart(2, '0');
    return `${assembly}-${numbering.nextComment}`;
};

export const incrementCommentLetter = (letter: string): string => {
    return String.fromCharCode(letter.charCodeAt(0) + 1);
};

// ============================================================================
// Pipeline Step Metadata
// ============================================================================

export const PIPELINE_STEPS_META: Record<AgentStepId, {
    label: string;
    description: string;
    icon: string;
    isLoop: boolean;
    requiresUserInput: boolean;
    canSkip: boolean;
}> = {
    transcription: {
        label: 'Transcription',
        description: 'Conversion de l\'audio en texte',
        icon: '🎙️',
        isLoop: false,
        requiresUserInput: false,
        canSkip: true,
    },
    identification: {
        label: 'Identification',
        description: 'Identification des locuteurs par empreinte vocale',
        icon: '🔍',
        isLoop: false,
        requiresUserInput: false,
        canSkip: true,
    },
    cleaning: {
        label: 'Nettoyage',
        description: 'Nettoyage et fusion des segments de transcription',
        icon: '🧹',
        isLoop: false,
        requiresUserInput: false,
        canSkip: false,
    },
    odj_analysis: {
        label: 'Analyse ODJ',
        description: 'Association des discussions aux points de l\'ordre du jour',
        icon: '📋',
        isLoop: false,
        requiresUserInput: true,
        canSkip: false,
    },
    classification: {
        label: 'Classification',
        description: 'Catégorisation thématique et analyse de sentiment',
        icon: '🏷️',
        isLoop: false,
        requiresUserInput: false,
        canSkip: false,
    },
    drafting: {
        label: 'Rédaction',
        description: 'Génération du brouillon PV (résolutions, commentaires)',
        icon: '✍️',
        isLoop: false,
        requiresUserInput: false,
        canSkip: false,
    },
    reflection: {
        label: 'Réflexion',
        description: 'Auto-critique et corrections automatiques',
        icon: '🔄',
        isLoop: true,
        requiresUserInput: false,
        canSkip: false,
    },
    user_validation: {
        label: 'Validation',
        description: 'Point de contrôle humain — révision et approbation',
        icon: '✅',
        isLoop: false,
        requiresUserInput: true,
        canSkip: false,
    },
    comparison: {
        label: 'Comparaison',
        description: 'Vérification de cohérence avec les PV historiques',
        icon: '📊',
        isLoop: true,
        requiresUserInput: false,
        canSkip: true,
    },
    learning: {
        label: 'Apprentissage',
        description: 'Mise à jour des modèles avec les corrections',
        icon: '🧠',
        isLoop: false,
        requiresUserInput: false,
        canSkip: true,
    },
};