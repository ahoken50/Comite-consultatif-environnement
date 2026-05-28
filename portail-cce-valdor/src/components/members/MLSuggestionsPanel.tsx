/**
 * ML Suggestions Panel Component
 * Displays AI suggestions for improving voice profiles
 * Allows users to preview and approve suggested audio segments
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    IconButton,
    Chip,
    Alert,
    AlertTitle,
    Collapse,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Divider,
    CircularProgress,
    Tooltip,
    Skeleton
} from '@mui/material';
import {
    Psychology as AIIcon,
    TrendingUp as ImprovementIcon,
    PlayArrow as PlayIcon,
    Stop as StopIcon,
    CheckCircle as ApproveIcon,
    ExpandMore as ExpandIcon,
    ExpandLess as CollapseIcon,
    AutoMode as AutoModeIcon,
    Refresh as RefreshIcon,
    RecordVoiceOver as VoiceIcon,
    Delete as DeleteIcon
} from '@mui/icons-material';
import {
    getSuggestions,
    applySuggestion,
    runAutonomousMLLoop
} from '../../services/mlSuggestionsService';
import type { MLSuggestion, SuggestedSegment } from '../../services/mlSuggestionsService';

// Quality badge colors
const qualityColors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    robuste: 'success',
    acceptable: 'warning',
    faible: 'error',
    inexistant: 'default'
};

interface MLSuggestionsPanelProps {
    onProfileUpdated?: (memberName: string, newCount: number) => void;
}

export const MLSuggestionsPanel: React.FC<MLSuggestionsPanelProps> = ({
    onProfileUpdated
}) => {
    const [suggestions, setSuggestions] = useState<MLSuggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [playingAudio, setPlayingAudio] = useState<string | null>(null);
    const [applying, setApplying] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [warningMessage, setWarningMessage] = useState<string | null>(null);
    const [runningLoop, setRunningLoop] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Load suggestions on mount
    useEffect(() => {
        loadSuggestions();
    }, []);

    const loadSuggestions = async () => {
        setLoading(true);
        setError(null);
        setSuccessMessage(null);
        setWarningMessage(null);
        try {
            const result = await getSuggestions(5);
            const ignored = JSON.parse(localStorage.getItem('ml_ignored_segments') || '[]');
            
            // Filter out ignored segments
            const filteredSuggestions = result.suggestions.map(s => ({
                ...s,
                segments: s.segments.filter(seg => 
                    !ignored.includes(`${seg.meetingId}-${seg.start}-${seg.end}`)
                )
            })).filter(s => s.segments.length > 0);

            setSuggestions(filteredSuggestions);
        } catch (e: any) {
            setError(e.message || 'Erreur lors du chargement des suggestions');
        } finally {
            setLoading(false);
        }
    };

    const handlePlaySegment = (segment: SuggestedSegment) => {
        const segmentId = `${segment.meetingId}-${segment.start}`;

        if (playingAudio === segmentId) {
            // Stop playing
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            setPlayingAudio(null);
            return;
        }

        // Start playing
        // Note: We need to add timestamp params to the audio URL
        const audio = new Audio(segment.audioUrl);
        audio.currentTime = segment.start;

        const handleTimeUpdate = () => {
            if (audio.currentTime >= segment.end) {
                audio.pause();
                setPlayingAudio(null);
            }
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', () => setPlayingAudio(null));
        audio.play().catch(() => setError('Impossible de lire l\'audio'));

        audioRef.current = audio;
        setPlayingAudio(segmentId);
    };

    const handleApplySuggestion = async (
        suggestion: MLSuggestion,
        segment: SuggestedSegment
    ) => {
        const segmentId = `${segment.meetingId}-${segment.start}`;
        setApplying(segmentId);
        setError(null);
        setSuccessMessage(null);
        setWarningMessage(null);

        try {
            const result = await applySuggestion(
                suggestion.memberId,
                suggestion.memberName,
                segment.audioUrl,
                segment.start,
                segment.end
            );

            // If it's a warning or duplicate (contains ⚠️ or "inchangé")
            if (result.message.includes('⚠️') || result.message.toLowerCase().includes('inchangé')) {
                setWarningMessage(result.message);
                setSuccessMessage(null);
                setTimeout(() => setWarningMessage(null), 8000);
            } else {
                setSuccessMessage(result.message);
                setWarningMessage(null);
                setTimeout(() => setSuccessMessage(null), 5000);
            }

            // Update the suggestion in local state
            setSuggestions(prev => prev.map(s => {
                if (s.memberId === suggestion.memberId) {
                    return {
                        ...s,
                        currentSamples: result.newSampleCount,
                        segments: s.segments.filter(seg =>
                            !(seg.meetingId === segment.meetingId && seg.start === segment.start)
                        )
                    };
                }
                return s;
            }).filter(s => s.segments.length > 0));

            // Notify parent
            if (onProfileUpdated) {
                onProfileUpdated(suggestion.memberName, result.newSampleCount);
            }

        } catch (e: any) {
            setError(e.message || 'Erreur lors de l\'application');
        } finally {
            setApplying(null);
        }
    };

    const handleDismissSegment = (suggestion: MLSuggestion, segment: SuggestedSegment) => {
        const segmentId = `${segment.meetingId}-${segment.start}-${segment.end}`;
        
        // Save to localStorage
        const ignored = JSON.parse(localStorage.getItem('ml_ignored_segments') || '[]');
        if (!ignored.includes(segmentId)) {
            ignored.push(segmentId);
            localStorage.setItem('ml_ignored_segments', JSON.stringify(ignored));
        }

        // Update local state to filter out this segment
        setSuggestions(prev => prev.map(s => {
            if (s.memberId === suggestion.memberId) {
                return {
                    ...s,
                    segments: s.segments.filter(seg => 
                        !(seg.meetingId === segment.meetingId && seg.start === segment.start)
                    )
                };
            }
            return s;
        }).filter(s => s.segments.length > 0));

        setSuccessMessage(`Segment rejeté avec succès (il ne sera plus suggéré).`);
        setTimeout(() => setSuccessMessage(null), 4000);
    };

    const handleRunMLLoop = async () => {
        setRunningLoop(true);
        setError(null);
        setSuccessMessage(null);
        setWarningMessage(null);

        try {
            const result = await runAutonomousMLLoop(undefined, 'quick');
            setSuccessMessage(
                `🤖 ML terminé: ${result.autoLearned} appris, ` +
                `${result.suggestionsGenerated} suggestions générées`
            );
            // Reload suggestions
            await loadSuggestions();
        } catch (e: any) {
            setError(e.message || 'Erreur ML');
        } finally {
            setRunningLoop(false);
        }
    };

    const toggleExpand = (memberId: string) => {
        setExpanded(prev => ({ ...prev, [memberId]: !prev[memberId] }));
    };

    const getQualityFromSamples = (count: number): string => {
        if (count >= 10) return 'robuste';
        if (count >= 5) return 'acceptable';
        if (count >= 1) return 'faible';
        return 'inexistant';
    };

    return (
        <Card sx={{ mb: 2 }}>
            <CardContent>
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AIIcon color="primary" />
                        <Typography variant="h6">
                            Amélioration Continue ML
                        </Typography>
                        <Chip
                            label="Semi-Autonome"
                            size="small"
                            color="info"
                            variant="outlined"
                            icon={<AutoModeIcon />}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="Lancer la boucle ML">
                            <span>
                                <IconButton
                                    onClick={handleRunMLLoop}
                                    disabled={runningLoop}
                                    color="primary"
                                >
                                    {runningLoop ? <CircularProgress size={24} /> : <AutoModeIcon />}
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="Rafraîchir les suggestions">
                            <IconButton onClick={loadSuggestions} disabled={loading}>
                                <RefreshIcon />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>

                {/* Success Message */}
                <Collapse in={!!successMessage}>
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
                        {successMessage}
                    </Alert>
                </Collapse>

                {/* Warning Message */}
                <Collapse in={!!warningMessage}>
                    <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setWarningMessage(null)}>
                        {warningMessage}
                    </Alert>
                </Collapse>

                {/* Error Message */}
                <Collapse in={!!error}>
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                </Collapse>

                {/* Loading State */}
                {loading && (
                    <Box sx={{ mb: 2 }}>
                        <Skeleton variant="rectangular" height={80} sx={{ mb: 1 }} />
                        <Skeleton variant="rectangular" height={80} />
                    </Box>
                )}

                {/* No Suggestions */}
                {!loading && suggestions.length === 0 && (
                    <Alert severity="info" icon={<VoiceIcon />}>
                        <AlertTitle>Tous les profils sont robustes!</AlertTitle>
                        Aucune suggestion d'amélioration nécessaire pour le moment.
                    </Alert>
                )}

                {/* Suggestions List */}
                {!loading && suggestions.map((suggestion) => (
                    <Card
                        key={suggestion.memberId}
                        variant="outlined"
                        sx={{ mb: 1, bgcolor: 'background.default' }}
                    >
                        <Box
                            sx={{
                                p: 2,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer'
                            }}
                            onClick={() => toggleExpand(suggestion.memberId)}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <VoiceIcon color="action" />
                                <Box>
                                    <Typography variant="subtitle1" fontWeight="medium">
                                        {suggestion.memberName}
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip
                                            label={getQualityFromSamples(suggestion.currentSamples)}
                                            size="small"
                                            color={qualityColors[getQualityFromSamples(suggestion.currentSamples)]}
                                        />
                                        <Typography variant="caption" color="text.secondary">
                                            {suggestion.currentSamples}/10 échantillons
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Chip
                                    icon={<ImprovementIcon />}
                                    label={suggestion.improvement}
                                    color="success"
                                    size="small"
                                />
                                <Typography variant="body2" color="text.secondary">
                                    {suggestion.segments.length} segment(s)
                                </Typography>
                                {expanded[suggestion.memberId] ? <CollapseIcon /> : <ExpandIcon />}
                            </Box>
                        </Box>

                        <Collapse in={expanded[suggestion.memberId]}>
                            <Divider />
                            <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    {suggestion.aiMessage}
                                </Typography>

                                <List dense disablePadding>
                                    {suggestion.segments.map((segment, idx) => {
                                        const segmentId = `${segment.meetingId}-${segment.start}`;
                                        const isPlaying = playingAudio === segmentId;
                                        const isApplying = applying === segmentId;

                                        return (
                                            <ListItem
                                                key={idx}
                                                sx={{
                                                    bgcolor: 'background.paper',
                                                    borderRadius: 1,
                                                    mb: 0.5,
                                                    border: '1px solid',
                                                    borderColor: 'divider'
                                                }}
                                            >
                                                <ListItemText
                                                    primary={
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <Typography variant="body2" fontWeight="medium">
                                                                {segment.meetingTitle}
                                                            </Typography>
                                                            <Chip
                                                                label={`${segment.duration}s`}
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        </Box>
                                                    }
                                                    secondary={
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{
                                                                display: 'block',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                                maxWidth: '400px'
                                                            }}
                                                        >
                                                            "{segment.text}"
                                                        </Typography>
                                                    }
                                                />
                                                <ListItemSecondaryAction>
                                                    <Tooltip title={isPlaying ? "Arrêter" : "Écouter"}>
                                                        <IconButton
                                                            edge="end"
                                                            onClick={() => handlePlaySegment(segment)}
                                                            color={isPlaying ? "error" : "default"}
                                                            size="small"
                                                        >
                                                            {isPlaying ? <StopIcon /> : <PlayIcon />}
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Valider pour améliorer le profil">
                                                        <span>
                                                            <IconButton
                                                                edge="end"
                                                                onClick={() => handleApplySuggestion(suggestion, segment)}
                                                                disabled={isApplying}
                                                                color="success"
                                                                size="small"
                                                                sx={{ ml: 1 }}
                                                            >
                                                                {isApplying ? (
                                                                    <CircularProgress size={20} />
                                                                ) : (
                                                                    <ApproveIcon />
                                                                )}
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                    <Tooltip title="Ignorer cet extrait (pas bon)">
                                                        <IconButton
                                                            edge="end"
                                                            onClick={() => handleDismissSegment(suggestion, segment)}
                                                            disabled={isApplying}
                                                            color="error"
                                                            size="small"
                                                            sx={{ ml: 1 }}
                                                        >
                                                            <DeleteIcon />
                                                        </IconButton>
                                                    </Tooltip>
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                        );
                                    })}
                                </List>
                            </Box>
                        </Collapse>
                    </Card>
                ))}

                {/* Progress info */}
                {!loading && suggestions.length > 0 && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary">
                            💡 Validez les segments audio pour enrichir automatiquement les profils vocaux.
                            L'IA apprend continuellement pour améliorer la reconnaissance.
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default MLSuggestionsPanel;
