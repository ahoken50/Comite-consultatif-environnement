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
    Chip
} from '@mui/material';
import {
    Psychology,
    Edit,
    CheckCircle,
    ContentCopy
} from '@mui/icons-material';
import type { Meeting, MinutesDraft } from '../../types/meeting.types';
import { generateMinutesDraft, finalizeDraft, isGeminiConfigured } from '../../services/geminiService';

interface TranscriptionViewerProps {
    meeting: Meeting;
    onDraftGenerated?: (draft: MinutesDraft) => void;
    onApplyToMinutes?: (content: string) => void;
}

const TranscriptionViewer: React.FC<TranscriptionViewerProps> = ({
    meeting,
    onDraftGenerated,
    onApplyToMinutes
}) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFinalizing, setIsFinalizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState('');
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);

    const transcription = meeting.audioRecording?.transcription;
    const draft = meeting.minutesDraft;

    if (!transcription) {
        return null;
    }

    const handleGenerateDraft = async () => {
        if (!isGeminiConfigured()) {
            setError('Clé API Gemini non configurée');
            return;
        }

        setIsGenerating(true);
        setError(null);

        const result = await generateMinutesDraft(meeting, transcription);

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

        const result = await finalizeDraft(meeting, feedback);

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
