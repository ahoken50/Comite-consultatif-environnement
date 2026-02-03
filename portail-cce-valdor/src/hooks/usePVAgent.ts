/**
 * usePVAgent Hook
 * 
 * React hook for managing the SmartPV Agent workflow state and execution.
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
    onComplete?: (state: AgentState) => void;
    onError?: (error: Error) => void;
}

interface UsePVAgentReturn {
    state: AgentState | null;
    isRunning: boolean;
    currentStep: AgentStepId | null;

    // Actions
    start: (audioFile?: File, existingTranscription?: string) => void;
    validateStep: (approved: boolean) => void;
    cancel: () => void;
    reset: () => void;

    // Helpers
    getStepProgress: () => number;
    getStepResult: <T>(stepId: AgentStepId) => T | undefined;
}

export const usePVAgent = (options: UsePVAgentOptions): UsePVAgentReturn => {
    const { meeting, members, onComplete, onError } = options;

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
            onStepComplete: (stepId, result) => {
                console.log(`Step ${stepId} completed:`, result);
            },
            onValidationRequired: (_stepId, _result) => {
                return new Promise<boolean | unknown>((resolve) => {
                    validationResolverRef.current = resolve;
                });
            },
            onError: (stepId, error) => {
                console.error(`Step ${stepId} failed:`, error);
                onError?.(error);
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
    }, [meeting, members, isRunning, onComplete, onError]);

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
        const completedSteps = state.steps.filter(s => s.status === 'completed').length;
        return (completedSteps / state.steps.length) * 100;
    }, [state]);

    const getStepResult = useCallback(<T,>(stepId: AgentStepId): T | undefined => {
        if (!state) return undefined;
        return state.results[stepId] as T | undefined;
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
    };
};
