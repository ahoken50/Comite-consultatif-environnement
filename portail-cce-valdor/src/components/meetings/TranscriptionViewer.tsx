import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    TextField,
    CircularProgress,
    Alert,
    Divider,
    Chip,
    Grid
} from '@mui/material';
import {
    Psychology,
    Edit,
    CheckCircle,
    ArrowRightAlt,
    ContentCopy,
    People,
    Refresh
} from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { Meeting, MinutesDraft } from '../../types/meeting.types';
import { buildHistoricalContext, formatHistoricalContextForPrompt } from '../../services/geminiService';
import { generateMinutesDraftClaude, finalizeDraftClaude, isClaudeConfigured } from '../../services/claudeService';
import { selectAllMeetings } from '../../features/meetings/meetingsSlice';

interface TranscriptionViewerProps {
    meeting: Meeting;
    onDraftGenerated?: (draft: MinutesDraft) => void;
    onApplyToMinutes?: (content: string) => void;
    onTranscriptionUpdate?: (newTranscription: string) => void;
}

const TranscriptionViewer: React.FC<TranscriptionViewerProps> = ({
    meeting,
    onDraftGenerated,
    onApplyToMinutes,
    onTranscriptionUpdate
}) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFinalizing, setIsFinalizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState('');
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);

    // Speaker Identification State
    const [showSpeakerMap, setShowSpeakerMap] = useState(false);
    const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});

    // Get past meetings for historical context
    const allMeetings = useSelector(selectAllMeetings);
    const pastMeetings = allMeetings.filter(m => m.id !== meeting.id && m.date < meeting.date);

    const transcription = meeting.audioRecording?.transcription;
    const draft = meeting.minutesDraft;

    // Extract unique speakers from transcription
    const detectedSpeakers = React.useMemo(() => {
        if (!transcription) return [];

        const speakers = new Set<string>();

        // 1. New Format: [S1], [Speaker 1]
        // Exclude [00:00] timestamps (start with digits)
        const bracketRegex = /\[([A-Za-z][^\]]*)\]/g;
        let match;
        while ((match = bracketRegex.exec(transcription)) !== null) {
            const name = match[1].trim();
            // Filter out obvious non-speakers if any
            if (name && !name.match(/^\d{2}:\d{2}$/)) {
                speakers.add(name);
            }
        }

        // 2. Old Format: **Name**
        const boldRegex = /\*\*([^*]+)\*\*/g;
        while ((match = boldRegex.exec(transcription)) !== null) {
            const cleanName = match[1].replace(/:\s*$/, '').trim();
            if (cleanName.length > 0 && cleanName.length < 50) {
                speakers.add(cleanName);
            }
        }

        return Array.from(speakers).sort();
    }, [transcription]);

    if (!transcription) {
        return null;
    }

    const handleGenerateDraft = async () => {
        if (!isClaudeConfigured()) {
            setError('Clé API Claude non configurée');
            return;
        }

        setIsGenerating(true);
        setError(null);

        // Build historical context from past meetings
        const context = buildHistoricalContext(pastMeetings, meeting.agendaItems || []);
        const historicalContextText = formatHistoricalContextForPrompt(context);

        const result = await generateMinutesDraftClaude(meeting, transcription, historicalContextText);

        if (result.success && result.draft) {
            onDraftGenerated?.(result.draft);
        } else {
            setError(result.error || 'Erreur lors de la génération');
        }

        setIsGenerating(false);
    };

    const handleFinalize = async () => {
        if (!feedback.trim()) {
            setError('Veuillez saisir vos corrections');
            return;
        }

        setIsFinalizing(true);
        setError(null);

        const result = await finalizeDraftClaude(meeting, feedback);

        if (result.success) {
            setShowFeedbackForm(false);
            setFeedback('');
        } else {
            setError(result.error || 'Erreur lors de la finalisation');
        }

        setIsFinalizing(false);
    };

    const handleApplyToMinutes = () => {
        if (draft?.content) {
            onApplyToMinutes?.(draft.content);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleApplySpeakerNames = async () => {
        if (Object.keys(speakerMap).length === 0) return;

        let newTranscription = transcription;
        Object.entries(speakerMap).forEach(([oldName, newName]) => {
            if (newName.trim()) {
                // Strategy 1: Replace [OldName] -> [NewName]
                // Escape regex special chars in oldName just in case
                const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Replace bracketed version: [S1] -> [New Name]
                const bracketPattern = new RegExp(`\\[${escapedOldName}\\]`, 'g');
                newTranscription = newTranscription.replace(bracketPattern, `[${newName}]`);

                // Strategy 2: Replace **OldName**: -> **NewName**: (Legacy)
                const boldPattern = new RegExp(`\\*\\*${escapedOldName}\\*\\*:?`, 'g');
                newTranscription = newTranscription.replace(boldPattern, `**${newName}**:`);
            }
        });

        onTranscriptionUpdate?.(newTranscription);
        setSpeakerMap({});
        setShowSpeakerMap(false);
    };

    const getStatusChip = () => {
        if (!draft) return null;

        switch (draft.status) {
            case 'final':
                return <Chip icon={<CheckCircle />} label="Version finale" color="success" size="small" />;
            case 'reviewed':
                return <Chip label="Révisé" color="info" size="small" />;
            default:
                return <Chip label="Brouillon" color="warning" size="small" />;
        }
    };

    return (
        <Box sx={{ mt: 3 }}>
            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {/* Transcription Section */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        📝 Transcription
                    </Typography>
                    <Button
                        size="small"
                        startIcon={<ContentCopy />}
                        onClick={() => copyToClipboard(transcription)}
                    >
                        Copier
                    </Button>
                </Box>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 2,
                        maxHeight: 300,
                        overflow: 'auto',
                        bgcolor: 'grey.50',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        whiteSpace: 'pre-wrap'
                    }}
                >
                    {transcription}
                </Paper>
            </Paper>

            {/* Speaker Identification Section */}
            <Box sx={{ mb: 3 }}>
                <Button
                    variant="outlined"
                    startIcon={<People />}
                    onClick={() => setShowSpeakerMap(!showSpeakerMap)}
                    sx={{ mb: 2 }}
                >
                    Identifier les intervenants
                </Button>

                {showSpeakerMap && (
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Renommer les intervenants détectés :
                        </Typography>
                        <Grid container spacing={2} alignItems="center">
                            {detectedSpeakers.map((speaker) => (
                                <React.Fragment key={speaker}>
                                    <Grid size={5}>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{speaker}</Typography>
                                    </Grid>
                                    <Grid size={1} sx={{ textAlign: 'center' }}>
                                        <ArrowRightAlt />
                                    </Grid>
                                    <Grid size={6}>
                                        <TextField
                                            size="small"
                                            fullWidth
                                            placeholder="Nom réel (ex: Mme Lamoureux)"
                                            value={speakerMap[speaker] || ''}
                                            onChange={(e) => setSpeakerMap(prev => ({ ...prev, [speaker]: e.target.value }))}
                                        />
                                    </Grid>
                                </React.Fragment>
                            ))}
                        </Grid>
                        <Box sx={{ mt: 2, textAlign: 'right' }}>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={handleApplySpeakerNames}
                                disabled={Object.keys(speakerMap).length === 0}
                            >
                                Appliquer les noms
                            </Button>
                        </Box>
                    </Paper>
                )}
            </Box>

            {/* Draft Generation Button */}
            {!draft && (
                <Box sx={{ textAlign: 'center', mb: 3 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        size="large"
                        startIcon={isGenerating ? <CircularProgress size={20} color="inherit" /> : <Psychology />}
                        onClick={handleGenerateDraft}
                        disabled={isGenerating}
                    >
                        {isGenerating ? 'Génération en cours...' : 'Générer brouillon de PV'}
                    </Button>
                </Box>
            )}

            {/* Draft Section */}
            {draft && (
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="subtitle1" fontWeight={600}>
                                📄 Brouillon du procès-verbal
                            </Typography>
                            {getStatusChip()}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                size="small"
                                startIcon={<ContentCopy />}
                                onClick={() => copyToClipboard(draft.content)}
                            >
                                Copier
                            </Button>
                            <Button
                                size="small"
                                color="warning"
                                startIcon={isGenerating ? <CircularProgress size={16} color="inherit" /> : <Refresh />}
                                onClick={handleGenerateDraft}
                                disabled={isGenerating}
                            >
                                Regénérer
                            </Button>
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<Edit />}
                                onClick={() => setShowFeedbackForm(!showFeedbackForm)}
                            >
                                Réviser avec IA
                            </Button>
                        </Box>
                    </Box>

                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            maxHeight: 400,
                            overflow: 'auto',
                            bgcolor: 'background.paper',
                            whiteSpace: 'pre-wrap'
                        }}
                    >
                        {draft.content}
                    </Paper>

                    {/* Feedback Form */}
                    {showFeedbackForm && (
                        <Box sx={{ mt: 2 }}>
                            <Divider sx={{ mb: 2 }} />
                            <Typography variant="subtitle2" gutterBottom>
                                Corrections et ajustements :
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={4}
                                placeholder="Décrivez les corrections à apporter...
Exemple: 
- Le nom du proposeur de la résolution 09-35 est M. Tremblay, pas M. Bouchard
- Ajouter la mention 'à l'unanimité' pour la résolution 09-36
- Corriger la date de la prochaine réunion"
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                sx={{ mb: 2 }}
                            />
                            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                                <Button
                                    onClick={() => setShowFeedbackForm(false)}
                                    disabled={isFinalizing}
                                >
                                    Annuler
                                </Button>
                                <Button
                                    variant="contained"
                                    startIcon={isFinalizing ? <CircularProgress size={20} color="inherit" /> : <CheckCircle />}
                                    onClick={handleFinalize}
                                    disabled={isFinalizing || !feedback.trim()}
                                >
                                    {isFinalizing ? 'Révision...' : 'Appliquer corrections'}
                                </Button>
                            </Box>
                        </Box>
                    )}

                    {/* Apply to Minutes Button */}
                    <Box sx={{ mt: 2, textAlign: 'right' }}>
                        <Button
                            variant="contained"
                            color="success"
                            onClick={handleApplyToMinutes}
                        >
                            Appliquer au procès-verbal
                        </Button>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default TranscriptionViewer;
