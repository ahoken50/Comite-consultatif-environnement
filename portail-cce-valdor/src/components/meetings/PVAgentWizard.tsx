/**
 * PV Agent Wizard Component — Pipeline complet en 10 étapes
 *
 * Full-screen wizard UI for the SmartPV Agent 10-step workflow.
 * Shows progress, step details, validation controls, and loop indicators.
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
    TextField,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Tabs,
    Tab,
    Grid,
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
    SkipNext as SkipIcon,
    Loop as LoopIcon,
} from '@mui/icons-material';
import type {
    AgentState,
    AgentStep,
    AgentStepId,
    TranscriptionResult,
    IdentificationResult,
    CleaningResult,
    ODJAnalysisResult,
    ClassificationResult,
    DraftingResult,
    ReflectionResult,
    UserValidationResult,
    UserRevisionResult,
    ComparisonResult,
    LearningResult,
} from '../../types/pvAgent.types';
import AnalysisValidator from './PVAgentValidation/AnalysisValidator';
import type { AgendaItem } from '../../types/meeting.types';

interface PVAgentWizardProps {
    open: boolean;
    state: AgentState | null;
    isRunning: boolean;
    onValidate: (approved: boolean | unknown) => void;
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
        case 'skipped':
            return <SkipIcon color="disabled" />;
        default:
            return <PendingIcon color="disabled" />;
    }
};

// ========================================================================
// Helper Component: Isolated TextField to prevent parent re-renders on typing
// ========================================================================
const IsolatedTextField: React.FC<any> = ({ initialValue, onChange, ...props }) => {
    const [localValue, setLocalValue] = React.useState(initialValue || '');

    // Only update from parent if we're dealing with a truly new initialValue (like step changes)
    React.useEffect(() => {
        if (initialValue !== undefined && !localValue && initialValue !== '') {
            setLocalValue(initialValue);
        }
    }, [initialValue]);

    // Send the final value to parent on blur (when user clicks outside)
    const handleBlur = () => {
        onChange(localValue);
    };

    return (
        <TextField
            {...props}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
        />
    );
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
    const [editedAnalysis, setEditedAnalysis] = React.useState<ODJAnalysisResult | null>(null);
    const [userComments, setUserComments] = React.useState('');
    const [userEdits, setUserEdits] = React.useState('');
    const [validationTab, setValidationTab] = React.useState(0);

    // Reset edited state when step changes
    React.useEffect(() => {
        setEditedAnalysis(null);
        setUserComments('');
        setUserEdits('');
        setValidationTab(0);
    }, [state?.currentStepIndex]);

    const handleValidate = (approved: boolean) => {
        const currentStep = state?.steps.find(s => s.status === 'awaiting');

        if (!currentStep) {
            onValidate(approved);
            return;
        }

        // ODJ Analysis: pass back edited data
        if (approved && editedAnalysis && currentStep.id === 'odj_analysis') {
            onValidate(editedAnalysis);
            return;
        }

        // User Validation: pass back user edits and comments
        if (approved && currentStep.id === 'user_validation') {
            onValidate({
                userEdits: userEdits || undefined,
                userComments: userComments || undefined,
            });
            return;
        }

        onValidate(approved);
    };

    if (!state) return null;

    const currentStepIndex = state.steps.findIndex(s =>
        s.status === 'running' || s.status === 'awaiting'
    );
    const completedSteps = state.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    const progress = (completedSteps / state.steps.length) * 100;
    const isComplete = completedSteps === state.steps.length;

    const toggleExpand = (stepId: AgentStepId) => {
        setExpandedStep(expandedStep === stepId ? null : stepId);
    };

    // ========================================================================
    // Step Result Renderers
    // ========================================================================

    const renderStepResult = (step: AgentStep): React.ReactNode => {
        // user_validation step rendering depends on state.results, not step.result initially
        if (!step.result && step.id !== 'user_validation') return null;

        switch (step.id) {
            case 'transcription': {
                const r = step.result as TranscriptionResult;
                return (
                    <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {r.text.substring(0, 500)}...
                        </Typography>
                        {r.speakers && r.speakers.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                                    Locuteurs détectés:
                                </Typography>
                                {r.speakers.map((s, i) => (
                                    <Chip key={i} label={s} size="small" variant="outlined" />
                                ))}
                            </Box>
                        )}
                        {r.engine && (
                            <Chip label={`Moteur: ${r.engine}`} size="small" sx={{ mt: 1 }} />
                        )}
                    </Box>
                );
            }

            case 'identification': {
                const r = step.result as IdentificationResult;
                return (
                    <Box>
                        <Typography variant="body2">
                            🎯 {r.identifiedSegments}/{r.totalSegments} segments identifiés
                        </Typography>
                        {Object.entries(r.speakerMapping).length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                {Object.entries(r.speakerMapping).map(([label, name]) => (
                                    <Chip
                                        key={label}
                                        label={`${label} → ${name}`}
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                        sx={{ mr: 0.5, mb: 0.5 }}
                                    />
                                ))}
                            </Box>
                        )}
                        {r.unidentified.length > 0 && (
                            <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                                ⚠️ {r.unidentified.length} locuteur(s) non identifié(s)
                            </Typography>
                        )}
                    </Box>
                );
            }

            case 'cleaning': {
                const r = step.result as CleaningResult;
                return (
                    <Box>
                        <Typography variant="body2">
                            🧹 {r.removedDuplicates} doublon(s) supprimé(s), {r.mergedSegments} segment(s) fusionné(s)
                        </Typography>
                        {r.hallucinations.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="warning.main">
                                    Hallucinations détectées:
                                </Typography>
                                {r.hallucinations.slice(0, 3).map((h, i) => (
                                    <Typography key={i} variant="body2" fontSize="0.8rem" color="text.secondary">
                                        • {h}
                                    </Typography>
                                ))}
                                {r.hallucinations.length > 3 && (
                                    <Typography variant="caption" color="text.secondary">
                                        ... et {r.hallucinations.length - 3} autre(s)
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </Box>
                );
            }

            case 'odj_analysis': {
                const r = step.result as ODJAnalysisResult;
                const isAwaitingValidation = step.status === 'awaiting';

                if (isAwaitingValidation) {
                    return (
                        <AnalysisValidator
                            analysis={editedAnalysis || r}
                            agendaItems={agendaItems}
                            onChange={setEditedAnalysis}
                        />
                    );
                }

                return (
                    <Box>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            ✅ {r.mappedItems.length} point(s) associé(s) — Couverture: {r.coveragePercent?.toFixed(0) || '?'}%
                        </Typography>
                        {r.unmappedSegments.length > 0 && (
                            <Typography variant="body2" color="warning.main">
                                ⚠️ {r.unmappedSegments.length} segment(s) non associé(s)
                            </Typography>
                        )}
                    </Box>
                );
            }

            case 'classification': {
                const r = step.result as ClassificationResult;
                return (
                    <Box>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                            {r.globalThemes.map((theme, i) => (
                                <Chip key={i} label={theme} size="small" color="info" variant="outlined" />
                            ))}
                        </Box>
                        <Typography variant="body2">
                            Sentiment global: {
                                r.globalSentiment === 'positive' ? '😊 Positif' :
                                    r.globalSentiment === 'negative' ? '😟 Négatif' :
                                        r.globalSentiment === 'mixed' ? '🤔 Mixte' : '😐 Neutre'
                            }
                        </Typography>
                        {r.items.map((item, i) => (
                            <Box key={i} sx={{ mt: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                                <Typography variant="body2" fontWeight="bold" fontSize="0.85rem">
                                    {item.odjTitle}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {item.issueType === 'resolution' ? '📜 Résolution' :
                                        item.issueType === 'comment' ? '💬 Commentaire' :
                                            item.issueType === 'decision' ? '✅ Décision' : 'ℹ️ Information'}
                                    {' • '}{item.priority === 'high' ? '🔴' : item.priority === 'medium' ? '🟡' : '🟢'} {item.priority}
                                    {' • '}{item.summary}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                );
            }

            case 'drafting': {
                const r = step.result as DraftingResult;
                return (
                    <Box>
                        <Typography variant="body2" color="success.main" fontWeight="bold">
                            ✍️ Brouillon généré
                        </Typography>
                        <Typography variant="body2">
                            📜 {r.resolutions.length} résolution(s) • 💬 {r.comments.length} commentaire(s)
                        </Typography>
                        <Typography variant="body2">
                            👥 {r.attendees.present.length} présent(s), {r.attendees.absent.length} absent(s)
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 1.5, mt: 1, maxHeight: 200, overflow: 'auto', bgcolor: 'grey.50' }}>
                            <Typography variant="body2" fontSize="0.8rem" sx={{ whiteSpace: 'pre-wrap' }}>
                                {r.pvContent.substring(0, 1000)}...
                            </Typography>
                        </Paper>
                    </Box>
                );
            }

            case 'reflection': {
                const r = step.result as ReflectionResult;
                return (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <LoopIcon fontSize="small" color="primary" />
                            <Typography variant="body2">
                                {r.iterations.length} itération(s) • Score qualité: {r.qualityScore}/100
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={r.qualityScore}
                                sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                                color={r.qualityScore >= 90 ? 'success' : r.qualityScore >= 70 ? 'warning' : 'error'}
                            />
                        </Box>
                        <Typography variant="body2">
                            🔍 {r.totalIssuesFound} problème(s) trouvé(s) • ✅ {r.totalIssuesFixed} corrigé(s)
                        </Typography>
                        {r.iterations.map((it, i) => (
                            <Accordion key={i} variant="outlined" sx={{ mt: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="body2" fontSize="0.85rem">
                                        Itération #{it.iterationNumber} — {it.issues.length} problème(s)
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    {it.issues.length === 0 ? (
                                        <Typography variant="body2" color="success.main">
                                            ✅ Aucun problème détecté
                                        </Typography>
                                    ) : (
                                        <List dense>
                                            {it.issues.map((issue, j) => (
                                                <ListItem key={j} sx={{ py: 0 }}>
                                                    <ListItemIcon sx={{ minWidth: 28 }}>
                                                        {issue.severity === 'critical' ? <ErrorIcon color="error" fontSize="small" /> :
                                                            issue.severity === 'major' ? <WarningIcon color="warning" fontSize="small" /> :
                                                                <InfoIcon color="info" fontSize="small" />}
                                                    </ListItemIcon>
                                                    <ListItemText
                                                        primary={issue.description}
                                                        secondary={`${issue.location} — ${issue.applied ? '✅ Corrigé' : '⏳ Non corrigé'}`}
                                                        primaryTypographyProps={{ variant: 'body2', fontSize: '0.8rem' }}
                                                        secondaryTypographyProps={{ fontSize: '0.75rem' }}
                                                    />
                                                </ListItem>
                                            ))}
                                        </List>
                                    )}
                                </AccordionDetails>
                            </Accordion>
                        ))}
                    </Box>
                );
            }

            case 'user_validation': {
                const isAwaitingValidation = step.status === 'awaiting';
                const reflectionResult = state?.results.reflection;
                const comparisonResult = state?.results.comparison;
                const draftingResult = state?.results.drafting;

                if (isAwaitingValidation) {
                    const finalVal = userEdits || comparisonResult?.finalContent || reflectionResult?.finalContent || draftingResult?.pvContent || '';
                    return (
                        <Box>
                            <Alert severity="info" sx={{ mb: 2 }}>
                                <Typography variant="body2" fontWeight="bold">
                                    Révisez le PV FINAL ci-dessous (après corrections et comparaison historique). Vous pouvez modifier le texte ou ajouter des commentaires avant l'application.
                                </Typography>
                            </Alert>

                            {reflectionResult && (
                                <Box sx={{ mb: 2 }}>
                                    <Chip
                                        label={`Score qualité initial: ${reflectionResult.qualityScore}/100`}
                                        color={reflectionResult.qualityScore >= 90 ? 'success' : reflectionResult.qualityScore >= 70 ? 'warning' : 'error'}
                                        size="small"
                                        sx={{ mb: 1, mr: 1 }}
                                    />
                                    {comparisonResult && (
                                        <Chip
                                            label={`Cohérence format: ${comparisonResult.formatScore}/100`}
                                            color={comparisonResult.formatScore >= 90 ? 'success' : comparisonResult.formatScore >= 70 ? 'warning' : 'error'}
                                            size="small"
                                            sx={{ mb: 1 }}
                                        />
                                    )}
                                </Box>
                            )}

                            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                                <Tabs value={validationTab} onChange={(_, newValue) => setValidationTab(newValue)} aria-label="validation view tabs">
                                    <Tab label="📝 Édition Simple" />
                                    <Tab label="🔍 Comparaison Côte-à-Côte" />
                                </Tabs>
                            </Box>

                            {validationTab === 0 ? (
                                <IsolatedTextField
                                    fullWidth
                                    multiline
                                    minRows={10}
                                    maxRows={20}
                                    label="Contenu du PV FINAL (modifiable)"
                                    initialValue={finalVal}
                                    onChange={(val: string) => setUserEdits(val)}
                                    variant="outlined"
                                    sx={{ mb: 2 }}
                                />
                            ) : (
                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <span>📄</span> Premier jet rédigé (IA)
                                        </Typography>
                                        <TextField
                                            fullWidth
                                            multiline
                                            minRows={12}
                                            maxRows={20}
                                            value={draftingResult?.pvContent || ''}
                                            variant="outlined"
                                            disabled
                                            sx={{ bgcolor: 'action.hover' }}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main' }}>
                                            <span>✨</span> PV Corrigé & Validé (Modifiable)
                                        </Typography>
                                        <IsolatedTextField
                                            fullWidth
                                            multiline
                                            minRows={12}
                                            maxRows={20}
                                            initialValue={finalVal}
                                            onChange={(val: string) => setUserEdits(val)}
                                            variant="outlined"
                                        />
                                    </Grid>
                                </Grid>
                            )}

                            <IsolatedTextField
                                fullWidth
                                multiline
                                minRows={2}
                                maxRows={5}
                                label="Commentaires / Instructions supplémentaires (optionnel)"
                                initialValue={userComments}
                                onChange={(val: string) => setUserComments(val)}
                                variant="outlined"
                                placeholder="Ex: Corriger le nom de M. Tremblay, ajouter la mention du quorum..."
                            />
                        </Box>
                    );
                }

                const r = step.result as UserValidationResult;
                return (
                    <Box>
                        <Typography variant="body2" color={r?.approved ? 'success.main' : 'error.main'}>
                            {r?.approved ? '✅ PV approuvé par l\'utilisateur' : '❌ PV rejeté'}
                        </Typography>
                        {r?.userComments && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                💬 {r.userComments}
                            </Typography>
                        )}
                    </Box>
                );
            }

            case 'user_revision': {
                const r = step.result as UserRevisionResult;
                return (
                    <Box>
                        <Typography variant="body2">
                            🤖 Les commentaires ont été appliqués avec succès.
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                            <Typography variant="body2">
                                Nouveau score de qualité: {r.qualityScore}/100
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={r.qualityScore}
                                sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                                color={r.qualityScore >= 90 ? 'success' : r.qualityScore >= 70 ? 'warning' : 'error'}
                            />
                        </Box>
                    </Box>
                );
            }

            case 'comparison': {
                const r = step.result as ComparisonResult;
                return (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="body2">
                                Score de cohérence: {r.formatScore}/100
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={r.formatScore}
                                sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                                color={r.formatScore >= 90 ? 'success' : r.formatScore >= 70 ? 'warning' : 'error'}
                            />
                        </Box>

                        {r.historicalPVs.length > 0 && (
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                📊 Comparé avec {r.historicalPVs.length} PV historique(s)
                            </Typography>
                        )}

                        {r.consistencyChecks.length > 0 && (
                            <List dense>
                                {r.consistencyChecks.map((check, i) => (
                                    <ListItem key={i} sx={{ py: 0 }}>
                                        <ListItemIcon sx={{ minWidth: 28 }}>
                                            {check.status === 'fail' ? <ErrorIcon color="error" fontSize="small" /> :
                                                check.status === 'warning' ? <WarningIcon color="warning" fontSize="small" /> :
                                                    <CheckCircleIcon color="success" fontSize="small" />}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={check.message}
                                            secondary={check.suggestion}
                                            primaryTypographyProps={{ variant: 'body2', fontSize: '0.85rem' }}
                                            secondaryTypographyProps={{ fontSize: '0.75rem' }}
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        )}

                        {r.corrections.length > 0 && (
                            <Typography variant="body2" color="info.main" sx={{ mt: 1 }}>
                                ✏️ {r.corrections.length} correction(s) appliquée(s)
                            </Typography>
                        )}
                    </Box>
                );
            }

            case 'learning': {
                const r = step.result as LearningResult;
                return (
                    <Box>
                        <Typography variant="body2">
                            🧠 {r.modelsUpdated.length} modèle(s) mis à jour
                        </Typography>
                        {r.stylePatterns > 0 && (
                            <Typography variant="body2" color="text.secondary">
                                📐 {r.stylePatterns} patron(s) de style appris
                            </Typography>
                        )}
                        {r.terminologyUpdates > 0 && (
                            <Typography variant="body2" color="text.secondary">
                                📝 {r.terminologyUpdates} mise(s) à jour terminologique(s)
                            </Typography>
                        )}
                        {r.nextMeetingHints.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" fontWeight="bold">
                                    💡 Suggestions pour la prochaine réunion:
                                </Typography>
                                {r.nextMeetingHints.map((hint, i) => (
                                    <Typography key={i} variant="body2" fontSize="0.8rem" color="text.secondary">
                                        • {hint}
                                    </Typography>
                                ))}
                            </Box>
                        )}
                    </Box>
                );
            }

            default:
                return null;
        }
    };

    // ========================================================================
    // Render
    // ========================================================================

    return (
        <Dialog open={open} fullWidth maxWidth="md" onClose={onCancel}>
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h6">
                        🤖 Agent SmartPV — Pipeline en 10 étapes
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {state.pipelineVersion && (
                            <Chip label={`v${state.pipelineVersion}`} size="small" variant="outlined" />
                        )}
                        <Chip
                            label={isComplete ? 'Terminé' : isRunning ? 'En cours...' : 'En pause'}
                            color={isComplete ? 'success' : isRunning ? 'primary' : 'warning'}
                            size="small"
                        />
                    </Box>
                </Box>
            </DialogTitle>

            <DialogContent>
                {/* Global Progress */}
                <Box sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                            Progression globale — {completedSteps}/{state.steps.length} étapes
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
                    {state.totalDuration && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                            Durée totale: {(state.totalDuration / 1000).toFixed(1)}s
                        </Typography>
                    )}
                </Box>

                {/* Steps */}
                <Stepper activeStep={currentStepIndex} orientation="vertical">
                    {state.steps.map((step) => (
                        <Step key={step.id} completed={step.status === 'completed' || step.status === 'skipped'}>
                            <StepLabel
                                StepIconComponent={() => getStepIcon(step.status)}
                                optional={
                                    step.error ? (
                                        <Typography variant="caption" color="error">
                                            {step.error}
                                        </Typography>
                                    ) : step.status === 'skipped' ? (
                                        <Typography variant="caption" color="text.secondary">
                                            Ignoré
                                        </Typography>
                                    ) : undefined
                                }
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2">
                                        {step.icon} {step.label}
                                    </Typography>
                                    {step.iterationCount && step.iterationCount > 1 && (
                                        <Chip
                                            icon={<LoopIcon />}
                                            label={`${step.iterationCount}x`}
                                            size="small"
                                            variant="outlined"
                                            color="info"
                                        />
                                    )}
                                    {!!step.result && step.status !== 'awaiting' && (
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
                                    <Box sx={{ mb: 2 }}>
                                        <LinearProgress
                                            variant={step.progress !== undefined ? "determinate" : "indeterminate"}
                                            value={step.progress}
                                            sx={{ mb: 1 }}
                                        />
                                        {step.statusMessage && (
                                            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <PendingIcon fontSize="inherit" />
                                                {step.statusMessage}
                                            </Typography>
                                        )}
                                    </Box>
                                )}
                            </StepContent>
                        </Step>
                    ))}
                </Stepper>

                {/* Completion Message */}
                {isComplete && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                        <Typography variant="subtitle2">
                            🎉 Pipeline terminé avec succès !
                        </Typography>
                        <Typography variant="body2">
                            Cliquez sur "Appliquer au PV" pour mettre à jour le procès-verbal.
                        </Typography>
                        {state.results.reflection && (
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                                Score qualité: {state.results.reflection.qualityScore}/100
                                {state.results.comparison && ` • Score cohérence: ${state.results.comparison.formatScore}/100`}
                            </Typography>
                        )}
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