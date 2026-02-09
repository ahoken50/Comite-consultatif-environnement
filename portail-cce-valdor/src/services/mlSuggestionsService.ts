/**
 * ML Suggestions Service
 * Provides API for ML-driven profile improvement suggestions
 */

import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getApp } from 'firebase/app';

const functions = getFunctions(getApp(), 'us-central1');

// Connect to emulator in development
if (window.location.hostname === 'localhost') {
    try {
        connectFunctionsEmulator(functions, 'localhost', 5001);
    } catch (e) {
        // Already connected
    }
}

// Get the functions URL based on environment
const getFunctionUrl = (functionName: string): string => {
    if (window.location.hostname === 'localhost') {
        return `http://localhost:5001/comite-cce/us-central1/${functionName}`;
    }
    return `https://us-central1-comite-cce.cloudfunctions.net/${functionName}`;
};

// Types
export interface MLSuggestion {
    memberId: string;
    memberName: string;
    currentSamples: number;
    improvement: string;
    segments: SuggestedSegment[];
    aiMessage: string;
}

export interface SuggestedSegment {
    meetingId: string;
    meetingTitle: string;
    audioUrl: string;
    start: number;
    end: number;
    duration: number;
    text: string;
}

export interface ProfileQuality {
    memberId: string;
    memberName: string;
    sampleCount: number;
    quality: 'robuste' | 'acceptable' | 'faible' | 'inexistant';
    percentComplete: number;
}

export interface ApplySuggestionResult {
    success: boolean;
    memberName: string;
    newSampleCount: number;
    message: string;
}

/**
 * Get AI suggestions for improving weak voice profiles
 */
export async function getSuggestions(limit: number = 5): Promise<{
    success: boolean;
    aiMessage: string;
    suggestions: MLSuggestion[];
}> {
    const url = getFunctionUrl('suggest_profile_improvements');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit })
    });

    if (!response.ok) {
        throw new Error(`Failed to get suggestions: ${response.status}`);
    }

    return response.json();
}

/**
 * Apply a user-approved suggestion to improve a profile
 */
export async function applySuggestion(
    memberId: string,
    memberName: string,
    audioUrl: string,
    start: number,
    end: number
): Promise<ApplySuggestionResult> {
    const url = getFunctionUrl('apply_ai_suggestion');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            memberId,
            memberName,
            audioUrl,
            start,
            end
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Failed to apply suggestion: ${response.status}`);
    }

    return response.json();
}

/**
 * Trigger the autonomous ML learning loop
 */
export async function runAutonomousMLLoop(meetingId?: string, mode: 'full' | 'quick' = 'quick'): Promise<{
    autoLearned: number;
    queuedForReview: number;
    suggestionsGenerated: number;
}> {
    const url = getFunctionUrl('autonomous_ml_loop');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, mode })
    });

    if (!response.ok) {
        throw new Error(`ML Loop failed: ${response.status}`);
    }

    return response.json();
}

/**
 * Get the human verification queue for uncertain matches
 */
export async function getVerificationQueue(): Promise<{
    success: boolean;
    queue: Array<{
        id: string;
        speakerLabel: string;
        suggestedName: string;
        confidence: number;
        meetingId: string;
        text: string;
        audioUrl?: string;
        start?: number;
        end?: number;
    }>;
}> {
    const url = getFunctionUrl('human_verification_queue');

    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`Failed to get queue: ${response.status}`);
    }

    return response.json();
}
