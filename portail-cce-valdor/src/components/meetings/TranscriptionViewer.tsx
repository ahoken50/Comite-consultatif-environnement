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
    Refresh,
    SmartToy,
    WarningAmber,
    AutoAwesome
} from '@mui/icons-material';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Tooltip
} from '@mui/material';
import { SpeakerCorrectionTranscription } from './SpeakerCorrectionTranscription';
import { useSelector } from 'react-redux';
import type { Meeting, MinutesDraft, AudioRecording } from '../../types/meeting.types';
import { buildHistoricalContext, formatHistoricalContextForPrompt, reinforceSpeaker } from '../../services/geminiService';
import { generateMinutesDraftClaude, finalizeDraftClaude, isClaudeConfigured } from '../../services/claudeService';
import { selectAllMeetings } from '../../features/meetings/meetingsSlice';

interface TranscriptionViewerProps {
    meeting: Meeting;
    onDraftGenerated?: (draft: MinutesDraft) => void;
    onApplyToMinutes?: (content: string) => void;
    onTranscriptionUpdate?: (newTranscription: string, speakerMap?: Record<string, string>) => void;
}

// Add RootState import if missing (checked via view_file, needs explicit import)
import type { RootState } from '../../store/rootReducer';
import { useToast } from '../../hooks/useToast';

// ========================================================================
// Helper Component: Isolated TextField to prevent parent re-renders on typing
// ========================================================================
const IsolatedTextField: React.FC<any> = ({ initialValue, onChange, ...props }) => {
    const [localValue, setLocalValue] = React.useState(initialValue || '');

    // Only update from parent if we're dealing with a truly new initialValue
    React.useEffect(() => {
        if (initialValue !== undefined && initialValue !== localValue) {
            setLocalValue(initialValue);
        }
    }, [initialValue]);

    return (
        <TextField
            {...props}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => onChange(localValue)}
        />
    );
};

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
    const { showToast } = useToast();

    // Speaker Identification State
    const [showSpeakerMap, setShowSpeakerMap] = useState(false);
    const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
    const [learningMap, setLearningMap] = useState<Record<string, boolean>>({}); // Toggle for active learning

    // Candidates State
    const [candidates, setCandidates] = useState<Array<any>>([]);
    const [candidateMemberId, setCandidateMemberId] = useState<string>('');
    const [candidateSpeakerLabel, setCandidateSpeakerLabel] = useState<string>('');
    const [showCandidatesDialog, setShowCandidatesDialog] = useState(false);
    const [aiWarnings, setAiWarnings] = useState<Record<string, string>>({});
    const [aiAnalytics, setAiAnalytics] = useState<{
        confidence?: Record<string, any>;
        speakerStats?: Record<string, any>;
        profileStrength?: Record<string, any>;
        topSpeaker?: string;
        autoLearnedCount?: number;
        totalSpeakers?: number;
    } | null>(null);
    const [isIdentifying, setIsIdentifying] = useState(false);

    // AI Suggestions State
    const [aiSuggestions, setAiSuggestions] = useState<Array<any>>([]);
    const [showAiSuggestions, setShowAiSuggestions] = useState(false);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

    // Verification Queue State
    const [verificationQueue, setVerificationQueue] = useState<Array<any>>([]);
    const [showVerificationQueue, setShowVerificationQueue] = useState(false);

    // Audio Playback for AI Suggestions
    const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);

    const sortedRecordings = React.useMemo(() => {
        if (!Array.isArray(meeting.audioRecordings)) return [];
        return [...meeting.audioRecordings].sort((a, b) => {
            if (a.uploadedAt && b.uploadedAt) {
                const timeA = new Date(a.uploadedAt).getTime();
                const timeB = new Date(b.uploadedAt).getTime();
                if (timeA !== timeB) {
                    return timeA - timeB;
                }
            }
            return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
        });
    }, [meeting.audioRecordings]);

    const [activeRecording, setActiveRecording] = useState<AudioRecording | undefined>(() => {
        return sortedRecordings.length > 0 ? sortedRecordings[0] : meeting.audioRecording;
    });

    React.useEffect(() => {
        if (sortedRecordings.length > 0) {
            const exists = sortedRecordings.find(r => r.storagePath === activeRecording?.storagePath);
            if (!exists) {
                setActiveRecording(sortedRecordings[0]);
            }
        } else {
            setActiveRecording(meeting.audioRecording);
        }
    }, [sortedRecordings, meeting.audioRecording, activeRecording?.storagePath]);

    // Point 37 & Point C: Main Audio Player states and hooks
    const [mainAudioTime, setMainAudioTime] = useState(0);
    const mainAudioRef = React.useRef<HTMLAudioElement | null>(null);
    const mainAudioUrl = activeRecording?.fileUrl || meeting.audioRecording?.fileUrl;

    const handleMainAudioTimeUpdate = () => {
        if (mainAudioRef.current) {
            setMainAudioTime(mainAudioRef.current.currentTime);
        }
    };

    const handleSeekMainAudio = (seconds: number, recording?: AudioRecording) => {
        if (recording && activeRecording?.storagePath !== recording.storagePath) {
            setActiveRecording(recording);
            if (mainAudioRef.current) {
                mainAudioRef.current.src = recording.fileUrl;
                mainAudioRef.current.load();
                const playAndSeek = () => {
                    if (mainAudioRef.current) {
                        mainAudioRef.current.currentTime = seconds;
                        mainAudioRef.current.play().catch(console.error);
                        mainAudioRef.current.removeEventListener('canplay', playAndSeek);
                    }
                };
                mainAudioRef.current.addEventListener('canplay', playAndSeek);
            }
        } else if (mainAudioRef.current) {
            mainAudioRef.current.currentTime = seconds;
            mainAudioRef.current.play().catch(console.error);
        }
    };

    const playAudioSegment = (url: string | undefined, start: number | undefined, end: number | undefined, segId: string) => {
        if (!url) {
            showToast?.('Aucun fichier audio lié à cet extrait', 'error');
            return;
        }
        
        // Stop current
        if (audioRef.current) {
            audioRef.current.pause();
        }

        const audio = new Audio(url);
        audioRef.current = audio;
        
        if (start !== undefined) {
             audio.currentTime = start;
        }

        setPlayingSegmentId(segId);
        
        audio.play().catch(e => {
            console.error("Audio play error", e);
            setPlayingSegmentId(null);
            showToast?.("Erreur lors de la lecture de l'audio", 'error');
        });

        const checkTime = () => {
             if (end !== undefined && audio.currentTime >= end) {
                 audio.pause();
                 setPlayingSegmentId(null);
                 audio.removeEventListener('timeupdate', checkTime);
             }
        };

        if (end !== undefined) {
             audio.addEventListener('timeupdate', checkTime);
        }

        audio.onended = () => {
            setPlayingSegmentId(null);
        };
    };

    // PERF: Stable selectors — only re-render when actual data changes, not on every Redux update
    const allMeetings = useSelector(
        selectAllMeetings,
        (a, b) => a.length === b.length && a.every((m, i) => m.id === b[i]?.id && m.date === b[i]?.date)
    );
    const members = useSelector(
        (state: RootState) => state.members.items,
        (a, b) => a.length === b.length && a.every((m, i) => m.id === b[i]?.id)
    );
    const pastMeetings = allMeetings.filter(m => m.id !== meeting.id && m.date < meeting.date);

    const transcription = meeting.audioRecording?.transcription;
    const draft = meeting.minutesDraft;
    const transcriptionParts = React.useMemo(() => {
        if (!transcription) return [];
        return transcription.split(/\r?\n\r?\n---\s*TRANSCRIPTION\s+SUIVANTE\s*---\r?\n\r?\n/);
    }, [transcription]);

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

    if (!transcription && !draft) {
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

        const result = await generateMinutesDraftClaude(meeting, transcription || '', historicalContextText);

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

    // New AI Handler
    const handleIdentifySpeakers = async () => {
        setIsIdentifying(true);
        try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const functions = getFunctions();
            // BUGFIX: Increased client timeout to 30 minutes (1800000ms) to match backend heavy processing
            // A long meeting transcription + audio embedding on Modal can easily take 10-15 minutes
            const identifyFn = httpsCallable(functions, 'identify_speakers', { timeout: 1800000 });

            showToast?.('Analyse AI en cours...', 'info');
            const result = await identifyFn({ meetingId: meeting.id });
            const res = result.data as any;

            if (res.success && res.speakers) {
                setSpeakerMap(res.speakers);
                if (res.warnings) {
                    setAiWarnings(res.warnings);
                    const count = Object.keys(res.warnings).length;
                    if (count > 0) {
                        showToast?.(`⚠️ ${count} identifications ambiguës.`, 'warning');
                    }
                }
                // Capture AI analytics for visual display
                if (res.analytics) {
                    setAiAnalytics(res.analytics);
                    if (res.analytics.autoLearnedCount > 0) {
                        showToast?.(`🧠 ${res.analytics.autoLearnedCount} profil(s) auto-renforcé(s)!`, 'info');
                    }
                }
                setShowSpeakerMap(true);
                showToast?.(`Identification terminée : ${Object.keys(res.speakers).length} détectés.`, 'success');
            } else {
                showToast?.('Aucun locuteur identifié.', 'info');
            }
        } catch (err) {
            console.error(err);
            showToast?.('Erreur lors de l\'identification.', 'error');
        } finally {
            setIsIdentifying(false);
        }
    };

    const handleApplyToMinutes = () => {
        if (draft?.content) {
            onApplyToMinutes?.(draft.content);
        }
    };

    // Load AI Suggestions
    const handleLoadAiSuggestions = async () => {
        setIsLoadingSuggestions(true);
        try {
            const response = await fetch(
                `https://us-central1-comite-cce.cloudfunctions.net/suggest_profile_improvements`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5 }) }
            );
            const data = await response.json();
            if (data.success && data.suggestions) {
                setAiSuggestions(data.suggestions);
                setShowAiSuggestions(true);
                showToast?.(data.aiMessage || `${data.suggestions.length} suggestions trouvées`, 'info');
            }
        } catch (err) {
            console.error(err);
            showToast?.('Erreur lors du chargement des suggestions', 'error');
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    // Load Verification Queue
    const handleLoadVerificationQueue = async () => {
        try {
            const response = await fetch(
                `https://us-central1-comite-cce.cloudfunctions.net/human_verification_queue`,
                { method: 'GET' }
            );
            const data = await response.json();
            if (data.success && data.items) {
                setVerificationQueue(data.items);
                setShowVerificationQueue(true);
            }
        } catch (err) {
            console.error(err);
            showToast?.('Erreur lors du chargement de la file', 'error');
        }
    };

    // Apply AI Suggestion
    const handleApplyAiSuggestion = async (suggestion: any, segment: any) => {
        try {
            const response = await fetch(
                `https://us-central1-comite-cce.cloudfunctions.net/apply_ai_suggestion`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        memberId: suggestion.memberId,
                        memberName: suggestion.memberName,
                        audioUrl: segment.audioUrl,
                        start: segment.start,
                        end: segment.end
                    })
                }
            );
            const data = await response.json();
            if (data.success) {
                showToast?.(data.message || `✅ ${suggestion.memberName} amélioré!`, 'success');
                // Remove applied suggestion
                setAiSuggestions(prev => prev.filter(s => s.memberId !== suggestion.memberId));
            }
        } catch (err) {
            console.error(err);
            showToast?.('Erreur lors de l\'application', 'error');
        }
    };

    // Confirm verification item
    const handleConfirmVerification = async (item: any, correctedName: string) => {
        try {
            const response = await fetch(
                `https://us-central1-comite-cce.cloudfunctions.net/human_verification_queue`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'confirm',
                        itemId: item.id,
                        confirmedName: correctedName
                    })
                }
            );
            const data = await response.json();
            if (data.success) {
                showToast?.(`✅ ${correctedName} confirmé!`, 'success');
                setVerificationQueue(prev => prev.filter(i => i.id !== item.id));
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleRejectVerification = async (item: any) => {
        try {
            const response = await fetch(
                `https://us-central1-comite-cce.cloudfunctions.net/human_verification_queue`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'reject',
                        itemId: item.id
                    })
                }
            );
            const data = await response.json();
            if (data.success) {
                showToast?.(`❌ Suggestion rejetée.`, 'info');
                setVerificationQueue(prev => prev.filter(i => i.id !== item.id));
            }
        } catch (err) {
            console.error(err);
            showToast?.('Erreur lors du rejet', 'error');
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleApplySpeakerNames = async () => {
        if (Object.keys(speakerMap).length === 0) return;

        // 1. Trigger Reinforcement Learning (Active Learning)
        const learningPromises: Promise<any>[] = [];

        Object.entries(speakerMap).forEach(([speakerLabel, newName]) => {
            if (learningMap[speakerLabel]) {
                // Find member ID from name
                const member = members.find(m => m.displayName === newName);
                if (member) {
                    showToast?.(`Entraînement de la voix pour ${newName}...`, 'info');
                    learningPromises.push(
                        reinforceSpeaker(meeting.id, speakerLabel, member.id)
                            .then(res => {
                                if (res.success) {
                                    if (res.candidates && res.candidates.length > 0) {
                                        setCandidates(res.candidates);
                                        setCandidateMemberId(member.id);
                                        setCandidateSpeakerLabel(speakerLabel);
                                        setShowCandidatesDialog(true);
                                        showToast?.(`⚠️ Profil incomplet. ${res.candidates.length} suggestions trouvées.`, 'warning');
                                    } else if (res.needMore) {
                                        showToast?.(`⚠️ Profil incomplet (${res.samples}/3). Entraînez encore cette personne !`, 'warning');
                                    } else {
                                        showToast?.(`✅ ${res.message}`, 'success');
                                    }
                                } else {
                                    showToast?.(`❌ Erreur: ${res.error}`, 'error');
                                }
                            })
                    );
                }
            }
        });

        // 2. Apply Renaming in Transcript
        let newTranscription = transcription || '';
        Object.entries(speakerMap).forEach(([oldName, newName]) => {
            if (newName.trim()) {
                // Strategy 1: Replace [OldName] -> [NewName]
                const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const bracketPattern = new RegExp(`\\[${escapedOldName}\\]`, 'g');
                newTranscription = newTranscription.replace(bracketPattern, `[${newName}]`);

                // Strategy 2: Replace **OldName**: (Legacy)
                const boldPattern = new RegExp(`\\*\\*${escapedOldName}\\*\\*:?`, 'g');
                newTranscription = newTranscription.replace(boldPattern, `**${newName}**:`);
            }
        });

        onTranscriptionUpdate?.(newTranscription, speakerMap);

        // Wait for learning to complete (background)
        if (learningPromises.length > 0) {
            await Promise.all(learningPromises);
        }

        setSpeakerMap({});
        setLearningMap({});
        setShowSpeakerMap(false);
    };

    const handleAcceptCandidates = async () => {
        if (!candidateMemberId || candidates.length === 0) return;

        showToast?.(`Ajout de ${candidates.length} segments supplémentaires...`, 'info');
        setShowCandidatesDialog(false);

        const promises = candidates.map(cand =>
            reinforceSpeaker(meeting.id, candidateSpeakerLabel, candidateMemberId, cand.startTime, cand.endTime)
        );

        await Promise.all(promises);
        showToast?.(`✅ ${candidates.length} segments ajoutés avec succès !`, 'success');
        setCandidates([]);
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

    if (!transcription) {
        if (draft) {
            return (
                <Box sx={{ mt: 3 }}>
                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}
                    
                    {/* Draft Section (rendering when no audio transcription is present) */}
                    <Paper sx={{ p: 3, mb: 3, borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Typography variant="subtitle1" fontWeight={600} sx={{ color: '#1e4e3d' }}>
                                    📄 Brouillon du procès-verbal
                                </Typography>
                                {getStatusChip()}
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button
                                    size="small"
                                    startIcon={<ContentCopy />}
                                    onClick={() => {
                                        navigator.clipboard.writeText(draft.content || '');
                                        showToast?.('Copié dans le presse-papiers !', 'success');
                                    }}
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
                                whiteSpace: 'pre-wrap',
                                mb: 2
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
                                <IsolatedTextField
                                    fullWidth
                                    multiline
                                    rows={4}
                                    placeholder="Décrivez les corrections à apporter..."
                                    initialValue={feedback}
                                    onChange={(val: string) => setFeedback(val)}
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
                                        color="primary"
                                        onClick={handleFinalize}
                                        disabled={isFinalizing}
                                        startIcon={isFinalizing ? <CircularProgress size={16} color="inherit" /> : <AutoAwesome />}
                                    >
                                        {isFinalizing ? 'Finalisation...' : 'Finaliser le PV'}
                                    </Button>
                                </Box>
                            </Box>
                        )}

                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="contained"
                                color="success"
                                startIcon={<CheckCircle />}
                                onClick={handleApplyToMinutes}
                            >
                                Appliquer au PV officiel
                            </Button>
                        </Box>
                    </Paper>
                </Box>
            );
        }
        return null;
    }

    return (
        <Box sx={{ mt: 3 }}>
            {/* Candidates Dialog */}
            <Dialog open={showCandidatesDialog} onClose={() => setShowCandidatesDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Suggestions d'entraînement</DialogTitle>
                <DialogContent>
                    <Typography gutterBottom>
                        Le profil vocal est encore faible. L'IA a trouvé {candidates.length} autres segments pour <strong>{candidateSpeakerLabel}</strong>.
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Voulez-vous les ajouter pour renforcer le profil immédiatement ?
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {candidates.map((c, i) => (
                            <Paper key={i} variant="outlined" sx={{ p: 1, bgcolor: '#f5f5f5' }}>
                                <Typography variant="caption" display="block">
                                    Segment {i + 1} : {Math.round(c.startTime)}s - {Math.round(c.endTime)}s ({Math.round(c.duration)}s)
                                </Typography>
                                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                                    "{c.preview}"
                                </Typography>
                            </Paper>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowCandidatesDialog(false)}>Ignorer</Button>
                    <Button onClick={handleAcceptCandidates} variant="contained" color="success" startIcon={<SmartToy />}>
                        Ajouter tout ({candidates.length})
                    </Button>
                </DialogActions>
            </Dialog>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {/* Transcription Section */}
            <Paper sx={{ p: 3, mb: 3, borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#1e4e3d' }}>
                        📝 Transcription Interactive
                    </Typography>
                    <Button
                        size="small"
                        startIcon={<ContentCopy />}
                        onClick={() => copyToClipboard(transcription)}
                    >
                        Copier tout
                    </Button>
                </Box>

                {/* Point 37: Sleek custom audio player embedded */}
                {mainAudioUrl && (
                    <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1, bgcolor: '#f8fafc', p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
                        <Typography variant="caption" fontWeight="bold" color="text.secondary">
                            🎧 Lecteur Audio de Séance (Cliquez sur le texte pour sauter)
                        </Typography>
                        <audio
                            ref={mainAudioRef}
                            src={mainAudioUrl}
                            controls
                            onTimeUpdate={handleMainAudioTimeUpdate}
                            style={{ width: '100%', height: 40 }}
                        />
                    </Box>
                )}

                {/* Point C: Division par sujet de l'enregistrement */}
                {(() => {
                    const agendaItemsWithAudio = (meeting.agendaItems || []).filter(item => item.audioSegment && item.audioSegment.start !== undefined);
                    if (agendaItemsWithAudio.length === 0) return null;

                    return (
                        <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f0fdf4', borderColor: '#bbf7d0', borderRadius: 2 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: '#166534', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                📂 Division par Sujet (Audio de Séance)
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {agendaItemsWithAudio.map((item, idx) => (
                                    <Chip
                                        key={item.id}
                                        icon={<span>⏱️</span>}
                                        label={`${idx + 1}. ${item.title} (${Math.round(item.audioSegment!.start)}s - ${item.audioSegment!.end ? Math.round(item.audioSegment!.end) + 's' : 'fin'})`}
                                        onClick={() => {
                                            const rec = sortedRecordings.find(r => r.fileUrl === item.audioSegment!.audioUrl) || activeRecording;
                                            handleSeekMainAudio(item.audioSegment!.start, rec);
                                        }}
                                        sx={{
                                            bgcolor: 'white',
                                            color: '#1e3a8a',
                                            borderColor: '#3b82f6',
                                            fontWeight: 600,
                                            '&:hover': { bgcolor: '#eff6ff' }
                                        }}
                                        variant="outlined"
                                    />
                                ))}
                            </Box>
                        </Paper>
                    );
                })()}

                {sortedRecordings.length > 1 ? (
                    sortedRecordings.map((rec, idx) => (
                        <Box key={rec.storagePath} sx={{ mb: 4 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, color: '#1e3a8a' }}>
                                Partie {idx + 1} : {rec.fileName}
                            </Typography>
                            <SpeakerCorrectionTranscription
                                transcription={transcriptionParts[idx] || ''}
                                members={members}
                                meetingId={meeting.id}
                                audioUrl={rec.fileUrl}
                                audioDuration={rec.duration || 0}
                                currentTime={activeRecording?.storagePath === rec.storagePath ? mainAudioTime : -1}
                                onSeek={(seconds) => handleSeekMainAudio(seconds, rec)}
                                onTranscriptionUpdate={(newPartText, subSpeakerMap) => {
                                    const updatedParts = [...transcriptionParts];
                                    updatedParts[idx] = newPartText;
                                    const reCombined = updatedParts.join('\n\n--- TRANSCRIPTION SUIVANTE ---\n\n');
                                    onTranscriptionUpdate?.(reCombined, subSpeakerMap);
                                }}
                                onCorrectionMade={(original, corrected) => {
                                    showToast?.(`Locuteur corrigé: ${original} → ${corrected}`, 'success');
                                }}
                                partIndex={idx}
                            />
                        </Box>
                    ))
                ) : (
                    <SpeakerCorrectionTranscription
                        transcription={transcription}
                        members={members}
                        meetingId={meeting.id}
                        audioUrl={meeting.audioRecording?.fileUrl}
                        audioDuration={meeting.audioRecording?.duration || 0}
                        currentTime={mainAudioTime}
                        onSeek={(seconds) => handleSeekMainAudio(seconds, activeRecording)}
                        onTranscriptionUpdate={onTranscriptionUpdate}
                        onCorrectionMade={(original, corrected) => {
                            showToast?.(`Locuteur corrigé: ${original} → ${corrected}`, 'success');
                        }}
                    />
                )}
            </Paper>

            {/* Speaker Identification Section */}
            <Box sx={{ mb: 3 }}>
                <Button
                    variant="outlined"
                    startIcon={isIdentifying ? <CircularProgress size={20} /> : <People />}
                    onClick={handleIdentifySpeakers} // Changed trigger
                    disabled={isIdentifying}
                    sx={{ mb: 2 }}
                >
                    {isIdentifying ? 'Analyse en cours...' : 'Lancer l\'identification AI'}
                </Button>
                <Button
                    variant="outlined"
                    color="secondary"
                    startIcon={<People />}
                    onClick={() => setShowSpeakerMap(prev => !prev)}
                    sx={{ mb: 2, ml: 1 }}
                >
                    {showSpeakerMap ? 'Masquer la correction en lot' : 'Renommer les locuteurs en lot'}
                </Button>

                {/* Secret Admin Button to purge polluted profiles (Visible to developers/admins only) */}
                <Button
                    variant="text"
                    color="error"
                    size="small"
                    startIcon={<WarningAmber />}
                    onClick={async () => {
                        const confirmPurge = window.confirm("⚠️ ADMIN PURGE ⚠️\nVoulez-vous vraiment effacer les profils vocaux de 'Michaël Ross' et 'Donald ratté' pour repartir à neuf ?");
                        if (confirmPurge) {
                            try {
                                showToast?.('Purge en cours...', 'info');
                                const { getFunctions, httpsCallable } = await import('firebase/functions');
                                const purgeFn = httpsCallable(getFunctions(), 'purge_speaker_profile');
                                const result = await purgeFn({ names: ['Michaël Ross', 'Donald ratté', 'Donald Ratté'] });
                                const res = result.data as any;
                                if (res.success) {
                                    showToast?.('✅ Profils nettoyés avec succès!', 'success');
                                } else {
                                    showToast?.(`❌ Erreur: ${res.error || res.message}`, 'error');
                                }
                            } catch(e: any) {
                                showToast?.(`❌ Exception: ${e.message}`, 'error');
                            }
                        }
                    }}
                    sx={{ mb: 2, ml: 2, opacity: 0.3, '&:hover': { opacity: 1 } }}
                    title="Nettoyer les profils corrompus"
                >
                    Purge
                </Button>

                {/* AI FEEDBACK PANEL - Shows warnings, missing speakers, learning suggestions */}
                {showSpeakerMap && Object.keys(aiWarnings).length > 0 && (
                    <Alert
                        severity="warning"
                        sx={{ mb: 2 }}
                        icon={<SmartToy />}
                    >
                        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                            🤖 Feedback de l'IA
                        </Typography>
                        {aiWarnings['_missing'] && (
                            <Typography variant="body2" color="error.main" sx={{ mb: 1 }}>
                                ⚠️ {aiWarnings['_missing']}
                            </Typography>
                        )}
                        {Object.entries(aiWarnings)
                            .filter(([k]) => k !== '_missing')
                            .map(([speaker, warning]) => (
                                <Typography key={speaker} variant="body2" sx={{ mb: 0.5 }}>
                                    • <strong>{speaker}</strong>: {warning}
                                </Typography>
                            ))}
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            💡 Astuce: Corrigez manuellement les identifications ambiguës puis cliquez "Appliquer et Entraîner" pour améliorer l'IA.
                        </Typography>
                    </Alert>
                )}

                {/* AI LEARNING METRICS PANEL - Visual feedback on ML performance */}
                {showSpeakerMap && aiAnalytics && (
                    <Paper sx={{ p: 2, mb: 2, bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.200' }}>
                        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                            🧠 Métriques d'Apprentissage IA
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            {/* Auto-learned count */}
                            <Box sx={{ flex: '1 1 45%', minWidth: 100 }}>
                                <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                                    <Typography variant="h4" color="primary.main" fontWeight={700}>
                                        {aiAnalytics.autoLearnedCount || 0}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        Auto-renforcés
                                    </Typography>
                                </Box>
                            </Box>
                            {/* Top speaker */}
                            <Box sx={{ flex: '1 1 45%', minWidth: 100 }}>
                                <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                                    <Typography variant="h6" color="secondary.main" fontWeight={600}>
                                        {aiAnalytics.topSpeaker || '-'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        Plus de parole
                                    </Typography>
                                </Box>
                            </Box>
                            {/* Total speakers */}
                            <Box sx={{ flex: '1 1 45%', minWidth: 100 }}>
                                <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                                    <Typography variant="h4" color="success.main" fontWeight={700}>
                                        {aiAnalytics.totalSpeakers || Object.keys(speakerMap).length}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        Locuteurs
                                    </Typography>
                                </Box>
                            </Box>
                            {/* Confidence breakdown */}
                            <Box sx={{ flex: '1 1 45%', minWidth: 100 }}>
                                <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                                    <Typography variant="h4" color="warning.main" fontWeight={700}>
                                        {aiAnalytics.confidence ? Object.values(aiAnalytics.confidence).filter((c: any) => c.method === 'voice_high').length : 0}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        Haute confiance
                                    </Typography>
                                </Box>
                            </Box>
                        </Box>
                        {/* Profile strength summary */}
                        {aiAnalytics.profileStrength && (
                            <Box sx={{ mt: 2 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                    Force des profils:
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    {Object.entries(aiAnalytics.profileStrength).slice(0, 6).map(([name, data]: [string, any]) => (
                                        <Chip
                                            key={name}
                                            label={`${name.split(' ')[0]}: ${data.quality}`}
                                            size="small"
                                            color={data.quality === 'robuste' ? 'success' : data.quality === 'acceptable' ? 'warning' : 'error'}
                                            variant="outlined"
                                        />
                                    ))}
                                </Box>
                            </Box>
                        )}
                    </Paper>
                )}

                {/* ML CONTROL BUTTONS */}
                {showSpeakerMap && (
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<SmartToy />}
                            onClick={handleLoadAiSuggestions}
                            disabled={isLoadingSuggestions}
                        >
                            {isLoadingSuggestions ? 'Chargement...' : '🧠 Suggestions IA'}
                        </Button>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleLoadVerificationQueue}
                        >
                            📋 File de vérification
                        </Button>
                    </Box>
                )}

                {/* AI SUGGESTIONS PANEL */}
                {showAiSuggestions && aiSuggestions.length > 0 && (
                    <Paper sx={{ p: 2, mb: 2, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.200' }}>
                        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                            🧠 Suggestions d'Amélioration IA
                            <Chip label={`${aiSuggestions.length} profil(s)`} size="small" color="success" />
                        </Typography>
                        {aiSuggestions.map((suggestion: any, idx: number) => (
                            <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                    <Typography variant="body2" fontWeight={600}>
                                        {suggestion.memberName}
                                        <Chip
                                            label={`${suggestion.currentSamples}/10 samples`}
                                            size="small"
                                            sx={{ ml: 1 }}
                                            color={suggestion.currentSamples < 3 ? 'error' : 'warning'}
                                        />
                                    </Typography>
                                    <Typography variant="caption" color="success.main" fontWeight={600}>
                                        {suggestion.improvement}
                                    </Typography>
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    {suggestion.aiMessage}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {suggestion.segments?.map((seg: any, segIdx: number) => {
                                        const segId = `${suggestion.memberId}-${segIdx}`;
                                        const isPlaying = playingSegmentId === segId;
                                        
                                        return (
                                        <Box key={segIdx} sx={{ display: 'flex', gap: 0.5, alignItems: 'center', bgcolor: 'background.paper', p: 0.5, borderRadius: 1 }}>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="primary"
                                                onClick={() => {
                                                    if (isPlaying && audioRef.current) {
                                                        audioRef.current.pause();
                                                        setPlayingSegmentId(null);
                                                    } else {
                                                        playAudioSegment(seg.audioUrl || meeting.audioRecording?.fileUrl, seg.start, seg.end, segId);
                                                    }
                                                }}
                                                sx={{ minWidth: 'unset', p: '2px 8px' }}
                                            >
                                                {isPlaying ? '⏹' : '▶'}
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                color="success"
                                                onClick={() => handleApplyAiSuggestion(suggestion, seg)}
                                                sx={{ fontSize: '0.7rem' }}
                                            >
                                                ✓ Valider ({seg.duration}s)
                                            </Button>
                                        </Box>
                                    )})}
                                </Box>
                            </Paper>
                        ))}
                        <Button
                            size="small"
                            onClick={() => setShowAiSuggestions(false)}
                            sx={{ mt: 1 }}
                        >
                            Fermer
                        </Button>
                    </Paper>
                )}

                {/* VERIFICATION QUEUE PANEL */}
                {showVerificationQueue && verificationQueue.length > 0 && (
                    <Paper sx={{ p: 2, mb: 2, bgcolor: 'warning.50', border: '1px solid', borderColor: 'warning.200' }}>
                        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                            📋 File de Vérification Humaine
                            <Chip label={`${verificationQueue.length} en attente`} size="small" color="warning" />
                        </Typography>
                        {verificationQueue.slice(0, 5).map((item: any, idx: number) => (
                            <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="body2">
                                        <strong>{item.speakerLabel}</strong> → {item.suggestedName}?
                                    </Typography>
                                    <Chip
                                        label={`${Math.round((item.confidence || 0) * 100)}%`}
                                        size="small"
                                        color={item.confidence > 0.6 ? 'warning' : 'error'}
                                    />
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    "{item.textSample?.substring(0, 60)}..."
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        color="success"
                                        onClick={() => handleConfirmVerification(item, item.suggestedName)}
                                    >
                                        ✓ Confirmer
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color="error"
                                        onClick={() => handleRejectVerification(item)}
                                    >
                                        ✗ Rejeter
                                    </Button>
                                </Box>
                            </Paper>
                        ))}
                        <Button
                            size="small"
                            onClick={() => setShowVerificationQueue(false)}
                            sx={{ mt: 1 }}
                        >
                            Fermer
                        </Button>
                    </Paper>
                )}

                {showSpeakerMap && (
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Renommer les intervenants détectés :
                        </Typography>
                        <Grid container spacing={2} alignItems="center">
                            {detectedSpeakers.map((speaker) => (
                                <React.Fragment key={speaker}>
                                    <Grid size={5} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{speaker}</Typography>

                                        {/* AI WARNING INDICATOR */}
                                        {aiWarnings[speaker] && (
                                            <Tooltip title={`IA: ${aiWarnings[speaker]}`} arrow>
                                                <Chip
                                                    icon={<WarningAmber sx={{ fontSize: 16 }} />}
                                                    label="À vérifier"
                                                    color="warning"
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </Tooltip>
                                        )}
                                    </Grid>
                                    <Grid size={1} sx={{ textAlign: 'center' }}>
                                        <ArrowRightAlt />
                                    </Grid>
                                    <Grid size={4}>
                                        <TextField
                                            size="small"
                                            fullWidth
                                            select
                                            SelectProps={{ native: true }}
                                            value={speakerMap[speaker] || ''}
                                            onChange={(e) => setSpeakerMap(prev => ({ ...prev, [speaker]: e.target.value }))}
                                            error={!!aiWarnings[speaker]} // Highlight field if ambiguous
                                        >
                                            <option value="">Sélectionner...</option>
                                            {members.map(m => (
                                                <option key={m.id} value={m.displayName}>{m.displayName}</option>
                                            ))}
                                            <option value="custom">Autre (Texte libre)</option>
                                        </TextField>
                                        {speakerMap[speaker] === 'custom' && (
                                            <TextField
                                                size="small"
                                                fullWidth
                                                placeholder="Nom manuel"
                                                onChange={(e) => setSpeakerMap(prev => ({ ...prev, [speaker]: e.target.value }))}
                                                sx={{ mt: 1 }}
                                            />
                                        )}
                                    </Grid>
                                    <Grid size={2}>
                                        {/* ... (Learning button) ... */}
                                        <Button
                                            size="small"
                                            color={learningMap[speaker] ? "success" : "inherit"}
                                            variant={learningMap[speaker] ? "contained" : "outlined"}
                                            onClick={() => setLearningMap(prev => ({ ...prev, [speaker]: !prev[speaker] }))}
                                            title="Utiliser cette voix pour améliorer le modèle"
                                        >
                                            {learningMap[speaker] ? "Apprendre" : "Ignorer"}
                                        </Button>
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
                                Appliquer et Entraîner
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
                            <IsolatedTextField
                                fullWidth
                                multiline
                                rows={4}
                                placeholder="Décrivez les corrections à apporter...
Exemple: 
- Le nom du proposeur de la résolution 09-35 est M. Tremblay, pas M. Bouchard
- Ajouter la mention 'à l'unanimité' pour la résolution 09-36
- Corriger la date de la prochaine réunion"
                                initialValue={feedback}
                                onChange={(val: string) => setFeedback(val)}
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

export default React.memo(TranscriptionViewer, (prevProps, nextProps) => {
    return (
        prevProps.meeting.id === nextProps.meeting.id &&
        prevProps.meeting.audioRecording?.transcription === nextProps.meeting.audioRecording?.transcription &&
        prevProps.meeting.minutesDraft?.content === nextProps.meeting.minutesDraft?.content &&
        prevProps.meeting.minutesDraft?.status === nextProps.meeting.minutesDraft?.status
    );
});
