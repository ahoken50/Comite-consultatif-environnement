/**
 * SmartPV Agent Types
 * 
 * Type definitions for the PV Agent workflow.
 */

import type { AgendaItem, Meeting } from './meeting.types';
import type { Member } from './member.types';

// ============================================================================
// Agent Step Definitions
// ============================================================================

export type AgentStepId =
    | 'transcription'    // Step 1: Audio → Text
    | 'analysis'         // Step 2: Text → Structure (map to ODJ)
    | 'extraction'       // Step 3: Extract resolutions/comments
    | 'validation'       // Step 4: Cross-validate with ODJ
    | 'generation';      // Step 5: Generate final PV

export type AgentStepStatus =
    | 'pending'     // Not started
    | 'running'     // Currently executing
    | 'awaiting'    // Waiting for user validation
    | 'completed'   // Successfully completed
    | 'error';      // Failed

export interface AgentStep {
    id: AgentStepId;
    label: string;
    description: string;
    status: AgentStepStatus;
    progress?: number;    // 0-100
    result?: unknown;     // Step-specific result
    error?: string;
}

// ============================================================================
// Step Results
// ============================================================================

export interface TranscriptionResult {
    text: string;
    duration: number;     // seconds
    speakers?: string[];  // Detected speakers
}

export interface AnalysisResult {
    mappedItems: Array<{
        odjItemId: string;
        odjTitle: string;
        transcriptSegment: string;
        confidence: number;
    }>;
    unmappedSegments: string[];
}

export interface ExtractionResult {
    resolutions: Array<{
        number: string;        // e.g., "06-25"
        content: string;
        proposer?: string;
        seconder?: string;
    }>;
    comments: Array<{
        number: string;        // e.g., "06-A"
        content: string;
    }>;
    attendees: {
        present: string[];
        absent: string[];
    };
}

export interface ValidationResult {
    isValid: boolean;
    coverage: number;      // % of ODJ items covered
    warnings: string[];
    suggestions: string[];
}

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
        analysis?: AnalysisResult;
        extraction?: ExtractionResult;
        validation?: ValidationResult;
        generation?: GenerationResult;
    };
    startedAt?: Date;
    completedAt?: Date;
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
    meeting: Meeting;
    members: Member[];
    audioFile?: File;
    existingTranscription?: string;
    onStepComplete?: (stepId: AgentStepId, result: unknown) => void;
    onValidationRequired?: (stepId: AgentStepId, result: unknown) => Promise<boolean>;
    onError?: (stepId: AgentStepId, error: Error) => void;
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
