/**
 * usePVAgent Hook — Pipeline complet en 10 étapes
 *
 * React hook for managing the SmartPV Agent workflow state and execution.
 * Supports the full 10-step pipeline with skip options and progress tracking.
 */

import { useState, useCallback, useRef } from 'react';
import type {
    AgentState,
    AgentConfig,
    AgentStepId,
} from '../types/pvAgent.types';
import {
    createInitialState,
    runPVAgent,
} from '../services/pvAgentService';
import type { Meeting } from '../types/meeting.types';
import type { Member } from '../types/member.types';

interface UsePVAgentOptions {
    meeting: Meeting;
    members: Member[];
    // Pipeline options
    skipTranscription?: boolean;
    skipIdentification?: boolean;
    maxReflectionIterations?: number;
    enableHistoricalComparison?: boolean;
    enableLearning?: boolean;
    // Callbacks
    onComplete?: (state: AgentState) => void;
    onError?: (error: Error) => void;
    onStepComplete?: (stepId: AgentStepId, result: unknown) => void;
}

interface UsePVAgentReturn {
    state: AgentState | null;
    isRunning: boolean;
    currentStep: AgentStepId | null;

    // Actions
    start: (audioFile?: File, existingTranscription?: string) => void;
    validateStep: (result: boolean | unknown) => void;
    cancel: () => void;
    reset: () => void;

    // Helpers
    getStepProgress: () => number;
    getStepResult: <T>(stepId: AgentStepId) => T | undefined;
    getCompletedSteps: () => number;
    getTotalSteps: () => number;
    getPipelineDuration: () => number | null;
}

export const usePVAgent = (options: UsePVAgentOptions): UsePVAgentReturn => {
    const {
        meeting,
        members,
        skipTranscription,
        skipIdentification,
        maxReflectionIterations = 3,
        enableHistoricalComparison = true,
        enableLearning = true,
        onComplete,
        onError,
        onStepComplete,
    } = options;

    const [state, setState] = useState<AgentState | null>(null);
    const [isRunning, setIsRunning] = useState(false);

    // Validation promise resolver
    const validationResolverRef = useRef<((result: boolean | unknown) => void) | null>(null);
    const cancelledRef = useRef(false);

    const start = useCallback(async (
        audioFile?: File,
        existingTranscription?: string
    ) => {
        if (isRunning) return;

        cancelledRef.current = false;
        setIsRunning(true);

        const initialState = createInitialState(
            meeting.id,
            meeting.meetingNumber || 1
        );
        setState(initialState);

        const config: AgentConfig = {
            meeting,
            members,
            audioFile,
            existingTranscription,
            // Pipeline options
            skipTranscription: skipTranscription || (!audioFile && !!existingTranscription),
            skipIdentification,
            maxReflectionIterations,
            enableHistoricalComparison,
            enableLearning,
            // Callbacks
            onStepComplete: (stepId, result) => {
                console.log(`[PVAgent] Step ${stepId} completed`);
                onStepComplete?.(stepId, result);
            },
            onValidationRequired: (_stepId, _result) => {
                return new Promise<boolean | unknown>((resolve) => {
                    validationResolverRef.current = resolve;
                });
            },
            onError: (stepId, error) => {
                console.error(`[PVAgent] Step ${stepId} failed:`, error);
                onError?.(error);
            },
            onProgress: (stepId, progress) => {
                setState(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        steps: prev.steps.map(s =>
                            s.id === stepId ? { ...s, progress } : s
                        ),
                    };
                });
            },
        };

        try {
            const finalState = await runPVAgent(config, initialState, (newState) => {
                if (cancelledRef.current) {
                    throw new Error('Agent cancelled');
                }
                setState(newState);
            });

            onComplete?.(finalState);
        } catch (error) {
            if ((error as Error).message !== 'Agent cancelled') {
                onError?.(error as Error);
            }
        } finally {
            setIsRunning(false);
            validationResolverRef.current = null;
        }
    }, [
        meeting, members, isRunning, onComplete, onError, onStepComplete,
        skipTranscription, skipIdentification, maxReflectionIterations,
        enableHistoricalComparison, enableLearning,
    ]);

    const validateStep = useCallback((result: boolean | unknown) => {
        if (validationResolverRef.current) {
            validationResolverRef.current(result);
            validationResolverRef.current = null;
        }
    }, []);

    const cancel = useCallback(() => {
        cancelledRef.current = true;
        if (validationResolverRef.current) {
            validationResolverRef.current(false);
            validationResolverRef.current = null;
        }
        setIsRunning(false);
    }, []);

    const reset = useCallback(() => {
        setState(null);
        setIsRunning(false);
        cancelledRef.current = false;
        validationResolverRef.current = null;
    }, []);

    const getStepProgress = useCallback(() => {
        if (!state) return 0;
        const completedSteps = state.steps.filter(
            s => s.status === 'completed' || s.status === 'skipped'
        ).length;
        return (completedSteps / state.steps.length) * 100;
    }, [state]);

    const getStepResult = useCallback(<T,>(stepId: AgentStepId): T | undefined => {
        if (!state) return undefined;
        return state.results[stepId] as T | undefined;
    }, [state]);

    const getCompletedSteps = useCallback(() => {
        if (!state) return 0;
        return state.steps.filter(
            s => s.status === 'completed' || s.status === 'skipped'
        ).length;
    }, [state]);

    const getTotalSteps = useCallback(() => {
        if (!state) return 10;
        return state.steps.length;
    }, [state]);

    const getPipelineDuration = useCallback(() => {
        if (!state) return null;
        return state.totalDuration || null;
    }, [state]);

    const currentStep = state?.steps.find(s =>
        s.status === 'running' || s.status === 'awaiting'
    )?.id || null;

    return {
        state,
        isRunning,
        currentStep,
        start,
        validateStep,
        cancel,
        reset,
        getStepProgress,
        getStepResult,
        getCompletedSteps,
        getTotalSteps,
        getPipelineDuration,
    };
};