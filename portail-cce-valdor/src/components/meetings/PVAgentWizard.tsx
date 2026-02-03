/**
 * PV Agent Wizard Component
 * 
 * Full-screen wizard UI for the SmartPV Agent 5-step workflow.
 * Shows progress, step details, and validation controls.
 */

import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Stepper,
    Step,
    StepLabel,
    StepContent,
    Paper,
    LinearProgress,
    Alert,
    Chip,
    Collapse,
    IconButton,
    Divider,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
} from '@mui/material';
import {
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    HourglassEmpty as PendingIcon,
    PlayArrow as RunningIcon,
    Pause as AwaitingIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    Warning as WarningIcon,
    Info as InfoIcon,
} from '@mui/icons-material';
import type { AgentState, AgentStep, AgentStepId, ValidationResult, AnalysisResult } from '../../types/pvAgent.types';
import AnalysisValidator from './PVAgentValidation/AnalysisValidator';
import type { AgendaItem } from '../../types/meeting.types';

interface PVAgentWizardProps {
    open: boolean;
    state: AgentState | null;
    isRunning: boolean;
    onValidate: (approved: boolean) => void;
    onCancel: () => void;
    onApply: () => void;
    agendaItems?: AgendaItem[];
}

const getStepIcon = (status: AgentStep['status']) => {
    switch (status) {
        case 'completed':
            return <CheckCircleIcon color="success" />;
        case 'error':
            return <ErrorIcon color="error" />;
        case 'running':
            return <RunningIcon color="primary" sx={{ animation: 'pulse 1s infinite' }} />;
        case 'awaiting':
            return <AwaitingIcon color="warning" />;
        default:
            return <PendingIcon color="disabled" />;
    }
};

const PVAgentWizard: React.FC<PVAgentWizardProps> = ({
    open,
    state,
    isRunning,
    onValidate,
    onCancel,
    onApply,
    agendaItems = [],
}) => {
    const [expandedStep, setExpandedStep] = React.useState<AgentStepId | null>(null);
    const [editedAnalysis, setEditedAnalysis] = React.useState<AnalysisResult | null>(null);

    // Reset edited state when step changes or completes
    React.useEffect(() => {
        setEditedAnalysis(null);
    }, [state?.currentStepIndex]);

    const handleValidate = (approved: boolean) => {
        if (approved && editedAnalysis && state?.steps.find(s => s.id === 'analysis')?.status === 'awaiting') {
            // Pass back the modified data
            onValidate(editedAnalysis as any);
        } else {
            onValidate(approved);
        }
    };

    if (!state) return null;

    const currentStepIndex = state.steps.findIndex(s =>
        s.status === 'running' || s.status === 'awaiting'
    );
    const completedSteps = state.steps.filter(s => s.status === 'completed').length;
    const progress = (completedSteps / state.steps.length) * 100;
    const isComplete = completedSteps === state.steps.length;

    const toggleExpand = (stepId: AgentStepId) => {
        setExpandedStep(expandedStep === stepId ? null : stepId);
    };

    const renderStepResult = (step: AgentStep): React.ReactNode => {
        if (!step.result) return null;

        switch (step.id) {
            case 'transcription':
                const transResult = step.result as { text: string; speakers?: string[] };
                return (
                    <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {transResult.text.substring(0, 500)}...
                        </Typography>
                        {transResult.speakers && transResult.speakers.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {transResult.speakers.map((s, i) => (
                                    <Chip key={i} label={s} size="small" variant="outlined" />
                                ))}
                            </Box>
                        )}
                    </Box>
                );

            case 'analysis':
                const analysisResult = step.result as AnalysisResult;
                const isAwaitingValidation = step.status === 'awaiting';

                if (isAwaitingValidation) {
                    return (
                        <AnalysisValidator
                            analysis={editedAnalysis || analysisResult}
                            agendaItems={agendaItems}
                            onChange={setEditedAnalysis}
                        />
                    );
                }

                return (
                    <Box>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            ✅ {analysisResult.mappedItems.length} point(s) associé(s)
                        </Typography>
                        {analysisResult.unmappedSegments.length > 0 && (
                            <Typography variant="body2" color="warning.main">
                                ⚠️ {analysisResult.unmappedSegments.length} segment(s) non associé(s)
                            </Typography>
                        )}
                    </Box>
                );

            case 'extraction':
                const extractResult = step.result as { resolutions: any[]; comments: any[]; attendees: any };
                return (
                    <Box>
                        <Typography variant="body2">
                            📋 {extractResult.resolutions.length} résolution(s)
                        </Typography>
                        <Typography variant="body2">
                            💬 {extractResult.comments.length} commentaire(s)
                        </Typography>
                        <Typography variant="body2">
                            👥 {extractResult.attendees?.present?.length || 0} présent(s), {extractResult.attendees?.absent?.length || 0} absent(s)
                        </Typography>
                    </Box>
                );

            case 'validation':
                const validResult = step.result as ValidationResult;
                return (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="body2">
                                Couverture: {validResult.coverage.toFixed(0)}%
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={validResult.coverage}
                                sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                                color={validResult.coverage >= 90 ? 'success' : validResult.coverage >= 70 ? 'warning' : 'error'}
                            />
                        </Box>
                        {validResult.warnings.length > 0 && (
                            <List dense>
                                {validResult.warnings.map((w, i) => (
                                    <ListItem key={i} sx={{ py: 0 }}>
                                        <ListItemIcon sx={{ minWidth: 32 }}>
                                            <WarningIcon color="warning" fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText primary={w} primaryTypographyProps={{ variant: 'body2' }} />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                        {validResult.suggestions.length > 0 && (
                            <List dense>
                                {validResult.suggestions.map((s, i) => (
                                    <ListItem key={i} sx={{ py: 0 }}>
                                        <ListItemIcon sx={{ minWidth: 32 }}>
                                            <InfoIcon color="info" fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText primary={s} primaryTypographyProps={{ variant: 'body2' }} />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                    </Box>
                );

            case 'generation':
                const genResult = step.result as { agendaItems: any[]; globalNotes: string };
                return (
                    <Box>
                        <Typography variant="body2" color="success.main" fontWeight="bold">
                            ✅ PV généré avec succès !
                        </Typography>
                        <Typography variant="body2">
                            {genResult.agendaItems?.length || 0} point(s) mis à jour
                        </Typography>
                    </Box>
                );

            default:
                return null;
        }
    };

    return (
        <Dialog open={open} fullWidth maxWidth="md" onClose={onCancel}>
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h6">
                        🤖 Agent SmartPV - Génération Autonome
                    </Typography>
                    <Chip
                        label={isComplete ? 'Terminé' : isRunning ? 'En cours...' : 'En pause'}
                        color={isComplete ? 'success' : isRunning ? 'primary' : 'warning'}
                        size="small"
                    />
                </Box>
            </DialogTitle>

            <DialogContent>
                {/* Global Progress */}
                <Box sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                            Progression globale
                        </Typography>
                        <Typography variant="body2" fontWeight="bold">
                            {progress.toFixed(0)}%
                        </Typography>
                    </Box>
                    <LinearProgress
                        variant="determinate"
                        value={progress}
                        sx={{ height: 10, borderRadius: 5 }}
                    />
                </Box>

                {/* Steps */}
                <Stepper activeStep={currentStepIndex} orientation="vertical">
                    {state.steps.map((step, _index) => (
                        <Step key={step.id} completed={step.status === 'completed'}>
                            <StepLabel
                                StepIconComponent={() => getStepIcon(step.status)}
                                optional={
                                    step.error && (
                                        <Typography variant="caption" color="error">
                                            {step.error}
                                        </Typography>
                                    )
                                }
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2">{step.label}</Typography>
                                    {!!step.result && (
                                        <IconButton size="small" onClick={() => toggleExpand(step.id)}>
                                            {expandedStep === step.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                        </IconButton>
                                    )}
                                </Box>
                            </StepLabel>
                            <StepContent>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    {step.description}
                                </Typography>

                                {/* Step Result */}
                                <Collapse in={expandedStep === step.id || step.status === 'awaiting'}>
                                    <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
                                        {renderStepResult(step)}
                                    </Paper>
                                </Collapse>

                                {/* Awaiting Validation */}
                                {step.status === 'awaiting' && (
                                    <Alert
                                        severity="info"
                                        sx={{ mb: 2 }}
                                        action={
                                            <Box sx={{ display: 'flex', gap: 1 }}>
                                                <Button
                                                    size="small"
                                                    color="error"
                                                    onClick={() => handleValidate(false)}
                                                >
                                                    Rejeter
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="contained"
                                                    color="success"
                                                    onClick={() => handleValidate(true)}
                                                >
                                                    Valider
                                                </Button>
                                            </Box>
                                        }
                                    >
                                        En attente de votre validation pour continuer.
                                    </Alert>
                                )}

                                {/* Running indicator */}
                                {step.status === 'running' && (
                                    <LinearProgress sx={{ mb: 2 }} />
                                )}
                            </StepContent>
                        </Step>
                    ))}
                </Stepper>

                {/* Completion Message */}
                {isComplete && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">
                            🎉 Génération terminée avec succès !
                        </Typography>
                        <Typography variant="body2">
                            Cliquez sur "Appliquer au PV" pour mettre à jour le procès-verbal.
                        </Typography>
                    </Alert>
                )}
            </DialogContent>

            <Divider />

            <DialogActions sx={{ px: 3, py: 2 }}>
                <Button onClick={onCancel} color="inherit">
                    {isComplete ? 'Fermer' : 'Annuler'}
                </Button>
                {isComplete && (
                    <Button onClick={onApply} variant="contained" color="primary">
                        Appliquer au PV
                    </Button>
                )}
            </DialogActions>

            {/* Pulse animation for running step */}
            <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
        </Dialog>
    );
};

export default PVAgentWizard;
