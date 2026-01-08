/**
 * Progress Indicator Component
 * Multi-step progress display for long operations
 */

import React from 'react';
import {
    Box,
    Typography,
    LinearProgress,
    Stepper,
    Step,
    StepLabel,
    StepContent,
    CircularProgress,
    Card,
    CardContent,
    Collapse,
    IconButton,
    useTheme
} from '@mui/material';
import {
    CheckCircle,
    Error,
    RadioButtonUnchecked,
    ExpandMore,
    ExpandLess,
    HourglassEmpty
} from '@mui/icons-material';

// ============================================
// TYPES
// ============================================

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';

export interface ProgressStep {
    id: string;
    label: string;
    description?: string;
    status: StepStatus;
    progress?: number; // 0-100 for determinate progress
    error?: string;
}

export interface ProgressIndicatorProps {
    steps: ProgressStep[];
    title?: string;
    subtitle?: string;
    showPercentage?: boolean;
    variant?: 'stepper' | 'linear' | 'compact';
    collapsible?: boolean;
}

// ============================================
// STATUS ICONS
// ============================================

const StatusIcon: React.FC<{ status: StepStatus }> = ({ status }) => {
    const theme = useTheme();

    switch (status) {
        case 'completed':
            return <CheckCircle sx={{ color: theme.palette.success.main }} />;
        case 'error':
            return <Error sx={{ color: theme.palette.error.main }} />;
        case 'in_progress':
            return <CircularProgress size={24} />;
        case 'skipped':
            return <RadioButtonUnchecked sx={{ color: theme.palette.action.disabled }} />;
        default:
            return <HourglassEmpty sx={{ color: theme.palette.action.disabled }} />;
    }
};

// ============================================
// STEPPER VARIANT
// ============================================

const StepperProgress: React.FC<{ steps: ProgressStep[] }> = ({ steps }) => {
    const activeStep = steps.findIndex(s => s.status === 'in_progress');
    const completedSteps = steps.filter(s => s.status === 'completed').length;

    return (
        <Stepper
            activeStep={activeStep >= 0 ? activeStep : completedSteps}
            orientation="vertical"
        >
            {steps.map((step) => (
                <Step key={step.id} completed={step.status === 'completed'}>
                    <StepLabel
                        error={step.status === 'error'}
                        StepIconComponent={() => <StatusIcon status={step.status} />}
                    >
                        <Typography
                            variant="subtitle2"
                            color={step.status === 'error' ? 'error' : 'inherit'}
                        >
                            {step.label}
                        </Typography>
                    </StepLabel>
                    <StepContent>
                        {step.description && (
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                {step.description}
                            </Typography>
                        )}
                        {step.status === 'in_progress' && step.progress !== undefined && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LinearProgress
                                    variant="determinate"
                                    value={step.progress}
                                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                    {step.progress}%
                                </Typography>
                            </Box>
                        )}
                        {step.status === 'error' && step.error && (
                            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                                {step.error}
                            </Typography>
                        )}
                    </StepContent>
                </Step>
            ))}
        </Stepper>
    );
};

// ============================================
// LINEAR VARIANT
// ============================================

const LinearProgressDisplay: React.FC<{
    steps: ProgressStep[];
    showPercentage?: boolean
}> = ({ steps, showPercentage = true }) => {
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const currentStep = steps.find(s => s.status === 'in_progress');
    const hasError = steps.some(s => s.status === 'error');

    // Calculate overall progress
    let overallProgress = (completedSteps / steps.length) * 100;
    if (currentStep?.progress !== undefined) {
        overallProgress += (currentStep.progress / steps.length);
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                    {currentStep?.label || (hasError ? 'Erreur' : 'Terminé')}
                </Typography>
                {showPercentage && (
                    <Typography variant="body2" color="text.secondary">
                        {Math.round(overallProgress)}%
                    </Typography>
                )}
            </Box>
            <LinearProgress
                variant="determinate"
                value={overallProgress}
                color={hasError ? 'error' : 'primary'}
                sx={{ height: 8, borderRadius: 4 }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                    Étape {completedSteps + (currentStep ? 1 : 0)} / {steps.length}
                </Typography>
            </Box>
        </Box>
    );
};

// ============================================
// COMPACT VARIANT
// ============================================

const CompactProgress: React.FC<{ steps: ProgressStep[] }> = ({ steps }) => {
    const currentStep = steps.find(s => s.status === 'in_progress');
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const hasError = steps.some(s => s.status === 'error');

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {hasError ? (
                <Error color="error" />
            ) : currentStep ? (
                <CircularProgress size={20} />
            ) : (
                <CheckCircle color="success" />
            )}
            <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                    {currentStep?.label || (hasError ? 'Une erreur est survenue' : 'Terminé')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {completedSteps}/{steps.length} étapes complétées
                </Typography>
            </Box>
        </Box>
    );
};

// ============================================
// MAIN COMPONENT
// ============================================

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
    steps,
    title,
    subtitle,
    showPercentage = true,
    variant = 'stepper',
    collapsible = false
}) => {
    const [expanded, setExpanded] = React.useState(true);
    const isComplete = steps.every(s => s.status === 'completed' || s.status === 'skipped');
    const hasError = steps.some(s => s.status === 'error');

    const renderContent = () => {
        switch (variant) {
            case 'linear':
                return <LinearProgressDisplay steps={steps} showPercentage={showPercentage} />;
            case 'compact':
                return <CompactProgress steps={steps} />;
            default:
                return <StepperProgress steps={steps} />;
        }
    };

    return (
        <Card
            sx={{
                borderLeft: 4,
                borderColor: hasError ? 'error.main' : isComplete ? 'success.main' : 'primary.main'
            }}
        >
            <CardContent>
                {(title || collapsible) && (
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: expanded ? 2 : 0
                    }}>
                        <Box>
                            {title && (
                                <Typography variant="h6" component="div">
                                    {title}
                                </Typography>
                            )}
                            {subtitle && (
                                <Typography variant="body2" color="text.secondary">
                                    {subtitle}
                                </Typography>
                            )}
                        </Box>
                        {collapsible && (
                            <IconButton onClick={() => setExpanded(!expanded)} size="small">
                                {expanded ? <ExpandLess /> : <ExpandMore />}
                            </IconButton>
                        )}
                    </Box>
                )}

                <Collapse in={expanded}>
                    {renderContent()}
                </Collapse>
            </CardContent>
        </Card>
    );
};

// ============================================
// HOOK FOR MANAGING PROGRESS STATE
// ============================================

export interface UseProgressOptions {
    steps: Array<{ id: string; label: string; description?: string }>;
}

export interface UseProgressReturn {
    progressSteps: ProgressStep[];
    startStep: (stepId: string) => void;
    completeStep: (stepId: string) => void;
    failStep: (stepId: string, error: string) => void;
    updateProgress: (stepId: string, progress: number) => void;
    reset: () => void;
    isComplete: boolean;
    hasError: boolean;
    currentStepId: string | null;
}

/**
 * Hook for managing progress state
 * 
 * @example
 * const transcriptionSteps = [
 *     { id: 'upload', label: 'Téléversement du fichier' },
 *     { id: 'process', label: 'Traitement audio' },
 *     { id: 'transcribe', label: 'Transcription' },
 *     { id: 'save', label: 'Sauvegarde' }
 * ];
 * 
 * const progress = useProgress({ steps: transcriptionSteps });
 * 
 * progress.startStep('upload');
 * progress.updateProgress('upload', 50);
 * progress.completeStep('upload');
 */
export const useProgress = (options: UseProgressOptions): UseProgressReturn => {
    const [progressSteps, setProgressSteps] = React.useState<ProgressStep[]>(
        options.steps.map(s => ({ ...s, status: 'pending' as StepStatus }))
    );

    const startStep = React.useCallback((stepId: string) => {
        setProgressSteps(prev => prev.map(step =>
            step.id === stepId
                ? { ...step, status: 'in_progress' as StepStatus, progress: 0 }
                : step
        ));
    }, []);

    const completeStep = React.useCallback((stepId: string) => {
        setProgressSteps(prev => prev.map(step =>
            step.id === stepId
                ? { ...step, status: 'completed' as StepStatus, progress: 100 }
                : step
        ));
    }, []);

    const failStep = React.useCallback((stepId: string, error: string) => {
        setProgressSteps(prev => prev.map(step =>
            step.id === stepId
                ? { ...step, status: 'error' as StepStatus, error }
                : step
        ));
    }, []);

    const updateProgress = React.useCallback((stepId: string, progress: number) => {
        setProgressSteps(prev => prev.map(step =>
            step.id === stepId
                ? { ...step, progress: Math.min(100, Math.max(0, progress)) }
                : step
        ));
    }, []);

    const reset = React.useCallback(() => {
        setProgressSteps(options.steps.map(s => ({ ...s, status: 'pending' as StepStatus })));
    }, [options.steps]);

    const isComplete = progressSteps.every(s => s.status === 'completed' || s.status === 'skipped');
    const hasError = progressSteps.some(s => s.status === 'error');
    const currentStep = progressSteps.find(s => s.status === 'in_progress');

    return {
        progressSteps,
        startStep,
        completeStep,
        failStep,
        updateProgress,
        reset,
        isComplete,
        hasError,
        currentStepId: currentStep?.id || null
    };
};

export default ProgressIndicator;
