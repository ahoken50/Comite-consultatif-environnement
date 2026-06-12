/**
 * SpeakerCorrectionTranscription — Interactive transcription with inline speaker correction
 * 
 * Renders the transcription text with clickable speaker names that open a dropdown
 * to reassign the speaker. When a correction is made:
 * 1. The transcription text is updated locally
 * 2. If the segment is long enough (>5s), the audio embedding is extracted
 * 3. The correction is sent to the ML feedback loop for active learning
 * 4. The correct member's voice profile is reinforced (2x weight)
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Box,
    Typography,
    Select,
    MenuItem,
    Chip,
    Tooltip,
    Paper,
    Alert,
    CircularProgress,
    Snackbar,
    IconButton,
    Popover,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Checkbox,
    FormControlLabel,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Divider,
} from '@mui/material';
import {
    RecordVoiceOver as VoiceIcon,
    CheckCircle as CheckIcon,
    Psychology as MLIcon,
    PersonAdd as PersonAddIcon,
    AutoAwesome as SparklesIcon,
    HelpOutline as HelpIcon,
} from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material';
import type { Member } from '../../types/member.types';

interface TranscriptionSegment {
    type: 'speaker' | 'text' | 'timestamp';
    content: string;
    speakerName?: string;
    position: number; // character position in original text
}

interface SpeakerCorrection {
    originalName: string;
    correctedName: string;
    position: number;
    timestamp?: string;
    isLearning: boolean;
    learned: boolean;
}

interface SpeakerCorrectionTranscriptionProps {
    transcription: string;
    members: Member[];
    meetingId: string;
    audioUrl?: string;
    audioDuration?: number;
    currentTime?: number;
    onSeek?: (seconds: number) => void;
    onTranscriptionUpdate?: (newTranscription: string) => void;
    onCorrectionMade?: (original: string, corrected: string) => void;
    partIndex?: number;
}

export const SpeakerCorrectionTranscription: React.FC<SpeakerCorrectionTranscriptionProps> = React.memo(({
    transcription,
    members,
    meetingId,
    audioUrl,
    audioDuration = 0,
    currentTime = 0,
    onSeek,
    onTranscriptionUpdate,
    onCorrectionMade,
    partIndex,
}) => {
    const [corrections, setCorrections] = useState<SpeakerCorrection[]>([]);
    const [learningStatus, setLearningStatus] = useState<string | null>(null);
    const [snackMessage, setSnackMessage] = useState<string | null>(null);

    const storageKey = partIndex !== undefined ? `cce_transcription_draft_${meetingId}_part_${partIndex}` : `cce_transcription_draft_${meetingId}`;

    // Save transcription backup to localStorage on update
    useEffect(() => {
        if (transcription && transcription.trim()) {
            localStorage.setItem(storageKey, transcription);
        }
    }, [transcription, meetingId, storageKey]);

    // Restore draft backup on mount if live transcription is missing
    useEffect(() => {
        if (!transcription || !transcription.trim()) {
            const savedDraft = localStorage.getItem(storageKey);
            if (savedDraft && savedDraft.trim()) {
                console.log(`[Backup] Recovered transcription draft from localStorage for meeting ${meetingId}`);
                onTranscriptionUpdate?.(savedDraft);
                setSnackMessage("✏️ Brouillon de transcription restauré localement.");
            }
        }
    }, [meetingId, onTranscriptionUpdate, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Split Popover State
    const [splitAnchorEl, setSplitAnchorEl] = useState<HTMLElement | null>(null);
    const [activeSplitSegment, setActiveSplitSegment] = useState<TranscriptionSegment | null>(null);

    // AI Speaker Reevaluation States
    const [reevalConfirmOpen, setReevalConfirmOpen] = useState(false);
    const [reevalDialogOpen, setReevalDialogOpen] = useState(false);
    const [reevalLoading, setReevalLoading] = useState(false);
    const [reevalOldName, setReevalOldName] = useState('');
    const [reevalNewName, setReevalNewName] = useState('');
    const [reevalCandidates, setReevalCandidates] = useState<Array<{
        index: number;
        startTime: number;
        endTime: number;
        duration: number;
        text: string;
        score: number;
        confidence: 'high' | 'medium' | 'low';
        recommendation: string;
    }>>([]);
    const [selectedCandidateIndexes, setSelectedCandidateIndexes] = useState<Set<number>>(new Set());
    const [reevalRefSegment, setReevalRefSegment] = useState<{
        startTime: number;
        endTime: number;
        text: string;
    } | null>(null);

    // Parse transcription into segments
    const segments = useMemo(() => parseTranscription(transcription), [transcription]);

    // Get unique speaker names from transcription
    const detectedSpeakers = useMemo(() => {
        const speakers = new Set<string>();
        segments.forEach(seg => {
            if (seg.type === 'speaker' && seg.speakerName) {
                speakers.add(seg.speakerName);
            }
        });
        return Array.from(speakers).sort();
    }, [segments]);

    // Build member options for dropdown
    const memberOptions = useMemo((): Array<{ value: string; label: string; role: string; id: string }> => {
        const options: Array<{ value: string; label: string; role: string; id: string }> = members
            .filter(m => m.displayName)
            .map(m => ({
                value: m.displayName,
                label: m.displayName,
                role: m.role || '',
                id: m.id,
            }));

        // Also include detected speakers that aren't members
        detectedSpeakers.forEach(name => {
            if (!options.find(o => o.value === name)) {
                options.push({
                    value: name,
                    label: `${name} (non-membre)`,
                    role: '',
                    id: '',
                });
            }
        });

        return options.sort((a, b) => a.label.localeCompare(b.label));
    }, [members, detectedSpeakers]);

    // Handle existing speaker label change (Rename speaker for this segment)
    const handleSpeakerChange = useCallback(async (
        event: SelectChangeEvent<string>,
        segment: TranscriptionSegment,
    ) => {
        const newName = event.target.value;
        const oldName = segment.speakerName || '';

        if (newName === oldName) return;

        // 1. Update transcription text LOCALLY (Only replace THIS instance)
        // We depend on segment.position to find the exact occurrence
        const before = transcription.substring(0, segment.position);

        // Find the length of the tag we are replacing
        // It could be [Name] or **Name**:
        let tagLength = 0;
        if (transcription.substring(segment.position).startsWith('[')) {
            tagLength = oldName.length + 2; // [Name]
        } else {
            // **Name**: or **Name**
            const suffix = transcription.substring(segment.position + oldName.length + 4).startsWith(':') ? 1 : 0;
            tagLength = oldName.length + 4 + suffix;
        }

        const after = transcription.substring(segment.position + tagLength);
        const newTranscription = before + `[${newName}]` + after;

        // 2. Track correction
        const correction: SpeakerCorrection = {
            originalName: oldName,
            correctedName: newName,
            position: segment.position,
            isLearning: false,
            learned: false,
        };

        setCorrections(prev => [...prev, correction]);
        onTranscriptionUpdate?.(newTranscription);
        onCorrectionMade?.(oldName, newName);

        // 3. Trigger ML learning if audio is available
        triggerLearning(correction, newName, oldName, segment.position);

        // 4. Trigger AI Speaker Reevaluation if conditions are met
        const { start, end } = estimateSegmentTime(newTranscription, segment.position, audioDuration);
        const hasOtherSegments = segments.some(
            s => s.type === 'speaker' && s.speakerName === oldName && s.position !== segment.position
        );

        if (audioUrl && audioDuration > 0 && hasOtherSegments) {
            const segmentIdx = segments.findIndex(s => s.position === segment.position);
            const nextTextSeg = segmentIdx !== -1 ? segments.slice(segmentIdx + 1).find(s => s.type === 'text') : null;

            setReevalOldName(oldName);
            setReevalNewName(newName);
            setReevalRefSegment({
                startTime: start,
                endTime: end,
                text: nextTextSeg?.content || '',
            });
            setReevalConfirmOpen(true);
        }

    }, [transcription, members, meetingId, audioUrl, audioDuration, onTranscriptionUpdate, onCorrectionMade, segments]);

    // Handle splitting a text line to assign a new speaker
    const handleSplitSpeaker = (newName: string) => {
        if (!activeSplitSegment) return;

        const position = activeSplitSegment.position;
        // Insert \n\n[New Name] at the start of this line
        const before = transcription.substring(0, position);
        const after = transcription.substring(position);

        // Add double newline to ensure clean separation if not already there
        // Actually, since we split by lines, 'before' ends right before this line.
        // If the previous char is not \n, add one.
        const prefix = (position > 0 && transcription[position - 1] !== '\n') ? '\n' : '';
        const newTag = `${prefix}[${newName}] `;

        const newTranscription = before + newTag + after;

        onTranscriptionUpdate?.(newTranscription);
        setSplitAnchorEl(null);
        setActiveSplitSegment(null);

        setSnackMessage(`✅ Nouveau locuteur assigné : ${newName}`);
    };

    const triggerLearning = async (
        correction: SpeakerCorrection,
        newName: string,
        oldName: string,
        position: number
    ) => {
        console.log('[SpeakerCorrection] triggerLearning called', { newName, oldName, audioUrl, audioDuration });

        if (audioUrl && audioDuration > 0) {

            // Update local state to show loading
            setCorrections(prev => {
                const existing = prev.find(c => c.position === position);
                if (existing) {
                    return prev.map(c => c.position === position ? { ...c, isLearning: true } : c);
                }
                return [...prev, { ...correction, isLearning: true }];
            });

            setLearningStatus(`🧠 Apprentissage en cours pour ${newName}...`);

            try {
                // Find nearest timestamp markers for better accuracy
                const { start, end } = estimateSegmentTime(
                    transcription, position, audioDuration
                );

                const segmentDuration = end - start;
                console.log('[SpeakerCorrection] Segment timing', { start, end, segmentDuration });

                // Only trigger ML if segment is long enough (>5 seconds)
                if (segmentDuration >= 5) {
                    // Find member IDs
                    const correctMember = members.find(m => m.displayName === newName);
                    console.log('[SpeakerCorrection] correctMember found:', !!correctMember, correctMember?.id);
                    if (correctMember) {
                        // Call closed_feedback_loop
                        const { getFunctions, httpsCallable } = await import('firebase/functions');
                        const functions = getFunctions();

                        console.log('[SpeakerCorrection] Calling closed_feedback_loop...');
                        const feedbackFn = httpsCallable(functions, 'closed_feedback_loop', { timeout: 540000 });
                        await feedbackFn({
                            meetingId,
                            speakerLabel: oldName,
                            wrongName: oldName,
                            correctName: newName,
                            correctMemberId: correctMember.id,
                            audioUrl,
                            start,
                            end,
                            originalConfidence: 0.5,
                        });
                        console.log('[SpeakerCorrection] closed_feedback_loop SUCCESS');

                        setSnackMessage(
                            `✅ Correction appliquée: ${oldName} → ${newName}. ` +
                            `Profil vocal renforcé (${Math.round(segmentDuration)}s d'audio).`
                        );
                    } else {
                        console.warn('[SpeakerCorrection] Member not found in members list for:', newName);
                    }
                } else {
                    console.log('[SpeakerCorrection] Segment too short:', segmentDuration);
                    setSnackMessage(
                        `✅ Correction appliquée: ${oldName} → ${newName}. ` +
                        `⚠️ Segment trop court (${Math.round(segmentDuration)}s) pour l'apprentissage vocal.`
                    );
                }
            } catch (err) {
                console.error('[SpeakerCorrection] ML learning error:', err);
                setSnackMessage(`✅ Correction appliquée. ⚠️ Apprentissage ML échoué.`);
            } finally {
                setCorrections(prev => prev.map(c =>
                    c.position === position ? { ...c, isLearning: false, learned: true } : c
                ));
                setLearningStatus(null);
            }
        } else {
            console.warn('[SpeakerCorrection] Skipped: audioUrl=', audioUrl, 'audioDuration=', audioDuration);
        }
    };

    // Run AI speaker similarity reevaluation across all segments with the old name
    const runReevaluation = async () => {
        if (!reevalOldName || !reevalNewName || !reevalRefSegment) return;

        setReevalConfirmOpen(false);
        setReevalDialogOpen(true);
        setReevalLoading(true);
        setReevalCandidates([]);
        setSelectedCandidateIndexes(new Set());

        try {
            const projectId = 'comite-cce';
            const region = 'us-central1';
            const functionName = 'reevaluate_speaker_segments';
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            const url = isLocal
                ? `http://127.0.0.1:5001/${projectId}/${region}/${functionName}`
                : `/api/${functionName}`;

            console.log('[SpeakerCorrection] Requesting reevaluation:', {
                meetingId,
                oldName: reevalOldName,
                newName: reevalNewName,
                startTime: reevalRefSegment.startTime,
                endTime: reevalRefSegment.endTime,
            });

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    meetingId,
                    oldName: reevalOldName,
                    newName: reevalNewName,
                    startTime: reevalRefSegment.startTime,
                    endTime: reevalRefSegment.endTime,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Erreur serveur (${response.status}): ${errorText}`);
            }

            const result = await response.json();
            console.log('[SpeakerCorrection] Reevaluation results:', result);

            if (result.success && Array.isArray(result.candidates)) {
                setReevalCandidates(result.candidates);
                // Pre-select high and medium confidence matches by default (User prompt preference)
                const initialSelected = new Set<number>();
                result.candidates.forEach((cand: any) => {
                    if (cand.confidence === 'high' || cand.confidence === 'medium') {
                        initialSelected.add(cand.index);
                    }
                });
                setSelectedCandidateIndexes(initialSelected);
            } else {
                setSnackMessage("⚠️ Aucun candidat similaire trouvé par l'IA.");
            }
        } catch (err) {
            console.error('[SpeakerCorrection] Reevaluation error:', err);
            setSnackMessage("❌ Échec de la réévaluation vocale. Veuillez réessayer.");
            setReevalDialogOpen(false);
        } finally {
            setReevalLoading(false);
        }
    };

    // Apply the selected speaker corrections globally to the transcription
    const handleApplyReevaluation = () => {
        if (selectedCandidateIndexes.size === 0) return;

        // 1. Gather all speaker segments matching the old name in the frontend
        const frontendSpeakerSegs = segments.filter(
            s => s.type === 'speaker' && s.speakerName === reevalOldName
        );

        if (frontendSpeakerSegs.length === 0) {
            setSnackMessage("⚠️ Aucun segment correspondant trouvé dans la transcription.");
            setReevalDialogOpen(false);
            return;
        }

        const replacements: Array<{ position: number; oldName: string }> = [];

        // 2. Map selected candidate indexes to their closest frontend speaker segments
        selectedCandidateIndexes.forEach(index => {
            const candidate = reevalCandidates.find(c => c.index === index);
            if (!candidate) return;

            let closestSeg: TranscriptionSegment | null = null;
            let minDiff = Infinity;

            frontendSpeakerSegs.forEach(seg => {
                const segTime = estimateSegmentTime(transcription, seg.position, audioDuration);
                const diff = Math.abs(segTime.start - candidate.startTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestSeg = seg;
                }
            });

            // If the closest segment starts within 15 seconds, consider it a match
            if (closestSeg && minDiff < 15) {
                const pos = (closestSeg as TranscriptionSegment).position;
                if (!replacements.some(r => r.position === pos)) {
                    replacements.push({
                        position: pos,
                        oldName: (closestSeg as TranscriptionSegment).speakerName || reevalOldName,
                    });
                }
            }
        });

        if (replacements.length === 0) {
            setSnackMessage("⚠️ Impossible d'associer précisément ces segments dans le texte.");
            setReevalDialogOpen(false);
            return;
        }

        // 3. Robust Replacement Algorithm: Sort replacements by position DESCENDING
        // Edits from end-to-start prevent character index shifting and text corruption
        replacements.sort((a, b) => b.position - a.position);

        let updatedTranscription = transcription;
        const newCorrections: SpeakerCorrection[] = [];

        replacements.forEach(rep => {
            updatedTranscription = replaceSpeakerAtPosition(
                updatedTranscription,
                rep.position,
                rep.oldName,
                reevalNewName
            );

            newCorrections.push({
                originalName: rep.oldName,
                correctedName: reevalNewName,
                position: rep.position,
                isLearning: false,
                learned: false,
            });
        });

        // 4. Update the transcription text globally
        onTranscriptionUpdate?.(updatedTranscription);

        // Keep the corrections in history (User preference)
        setCorrections(prev => [...prev, ...newCorrections]);

        setSnackMessage(`✅ Propagation réussie : ${replacements.length} segments mis à jour (${reevalOldName} → ${reevalNewName}).`);
        setReevalDialogOpen(false);
    };

    return (
        <Box>
            {/* Correction stats */}
            {corrections.length > 0 && (
                <Alert
                    severity="info"
                    icon={<MLIcon />}
                    sx={{ mb: 1 }}
                >
                    <Typography variant="body2">
                        {corrections.length} correction(s) appliquée(s)
                        {corrections.filter(c => c.learned).length > 0 && (
                            <> — {corrections.filter(c => c.learned).length} profil(s) vocal(aux) renforcé(s)</>
                        )}
                    </Typography>
                </Alert>
            )}

            {/* Learning indicator */}
            {learningStatus && (
                <Alert severity="info" icon={<CircularProgress size={16} />} sx={{ mb: 1 }}>
                    {learningStatus}
                </Alert>
            )}

            {/* Interactive transcription */}
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    maxHeight: 600,
                    overflow: 'auto',
                    bgcolor: 'grey.50',
                    fontSize: '0.9rem',
                    lineHeight: 1.8,
                }}
            >
                {segments.map((segment, idx) => {
                    // 1. SPEAKER TAG
                    if (segment.type === 'speaker') {
                        const correctionForThis = corrections.find(
                            c => c.position === segment.position
                        );
                        const wasLearned = correctionForThis?.learned;

                        return (
                            <Tooltip
                                key={idx}
                                title="Cliquez pour changer ce locuteur (seulement ici)"
                                arrow
                                placement="top"
                            >
                                <Select
                                    value={segment.speakerName || ''}
                                    onChange={(e) => handleSpeakerChange(e, segment)}
                                    variant="standard"
                                    size="small"
                                    sx={{
                                        fontWeight: 700,
                                        fontSize: '0.85rem',
                                        color: wasLearned ? 'success.main' : 'primary.main',
                                        bgcolor: wasLearned ? 'success.50' : 'primary.50',
                                        borderRadius: 1,
                                        px: 0.5,
                                        mx: 0.25,
                                        mt: 1, // Add space before new speaker block
                                        mb: 0.5,
                                        display: 'block', // Force new line for speaker tags usually
                                        width: 'fit-content',
                                        '& .MuiSelect-select': {
                                            py: 0.25,
                                            pr: '20px !important',
                                        },
                                        '& .MuiInput-underline:before': { borderBottom: 'none' },
                                        '& .MuiInput-underline:after': { borderBottom: '2px solid' },
                                        '&:hover': {
                                            bgcolor: 'primary.100',
                                        },
                                    }}
                                    renderValue={(value) => (
                                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                            <VoiceIcon sx={{ fontSize: 14 }} />
                                            {value}
                                            {wasLearned && <CheckIcon sx={{ fontSize: 12, color: 'success.main' }} />}
                                            {correctionForThis?.isLearning && <CircularProgress size={10} />}
                                        </Box>
                                    )}
                                >
                                    {memberOptions.map(option => (
                                        <MenuItem key={option.value} value={option.value}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                <VoiceIcon sx={{ fontSize: 16, color: 'action.active' }} />
                                                <Typography variant="body2">{option.label}</Typography>
                                                {option.role && (
                                                    <Chip
                                                        label={option.role}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ ml: 'auto', fontSize: '0.65rem', height: 20 }}
                                                    />
                                                )}
                                                {option.value === segment.speakerName && (
                                                    <CheckIcon sx={{ fontSize: 16, color: 'success.main', ml: 'auto' }} />
                                                )}
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </Tooltip>
                        );
                    }

                    // 2. TIMESTAMP
                    if (segment.type === 'timestamp') {
                        return (
                            <Chip
                                key={idx}
                                label={segment.content}
                                size="small"
                                variant="outlined"
                                sx={{
                                    fontSize: '0.7rem',
                                    height: 20,
                                    mx: 0.5,
                                    color: 'text.secondary',
                                    borderColor: 'divider',
                                    verticalAlign: 'middle',
                                }}
                            />
                        );
                    }

                    // 3. TEXT (with split capability, dynamic highlighting and click-to-seek)
                    const { start, end } = estimateSegmentTime(transcription, segment.position, audioDuration);
                    const isActive = currentTime >= start && currentTime <= end;

                    return (
                        <Box
                            component="span"
                            key={idx}
                            onClick={() => {
                                if (onSeek && segment.content.trim()) {
                                    onSeek(start);
                                }
                            }}
                            sx={{
                                position: 'relative',
                                display: 'inline',
                                cursor: onSeek ? 'pointer' : 'default',
                                bgcolor: isActive ? '#e0f2fe' : 'transparent',
                                borderBottom: isActive ? '2px solid #0284c7' : 'none',
                                transition: 'all 0.3s ease',
                                px: isActive ? 0.5 : 0,
                                borderRadius: isActive ? '4px' : 0,
                                '&:hover': {
                                    bgcolor: isActive ? '#bae6fd' : 'action.hover',
                                },
                                '&:hover .split-btn': { opacity: 1 }
                            }}
                        >
                            {/* Split Button (appears on hover) */}
                            <Tooltip title="Définir un locuteur à partir d'ici" arrow placement="top">
                                <IconButton
                                    className="split-btn"
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent seeking when splitting speaker
                                        setSplitAnchorEl(e.currentTarget);
                                        setActiveSplitSegment(segment);
                                    }}
                                    sx={{
                                        position: 'absolute',
                                        left: -28,
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        opacity: 0,
                                        transition: 'opacity 0.2s',
                                        bgcolor: 'background.paper',
                                        boxShadow: 1,
                                        width: 24,
                                        height: 24,
                                        zIndex: 10,
                                        '&:hover': { bgcolor: 'primary.50' }
                                    }}
                                >
                                    <PersonAddIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                                </IconButton>
                            </Tooltip>

                            <span style={{ whiteSpace: 'pre-wrap' }}>{segment.content}</span>
                        </Box>
                    );
                })}
            </Paper>

            {/* Split/New Speaker Popover */}
            <Popover
                open={Boolean(splitAnchorEl)}
                anchorEl={splitAnchorEl}
                onClose={() => {
                    setSplitAnchorEl(null);
                    setActiveSplitSegment(null);
                }}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'left',
                }}
            >
                <Box sx={{ p: 2, maxHeight: 300, overflow: 'auto', width: 300 }}>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PersonAddIcon fontSize="small" /> Qui parle ici ?
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {memberOptions.map(option => (
                            <MenuItem
                                key={option.value}
                                onClick={() => handleSplitSpeaker(option.value)}
                                sx={{ borderRadius: 1, py: 1 }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Typography variant="body2">{option.label}</Typography>
                                    {option.role && (
                                        <Chip
                                            label={option.role}
                                            size="small"
                                            variant="outlined"
                                            sx={{ ml: 'auto', fontSize: '0.65rem', height: 20 }}
                                        />
                                    )}
                                </Box>
                            </MenuItem>
                        ))}
                    </Box>
                </Box>
            </Popover>

            {/* Legend */}
            <Box sx={{ mt: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                    💡 Cliquez sur un nom pour corriger. Survolez une ligne de texte pour changer de locuteur.
                </Typography>
                {audioUrl && (
                    <Typography variant="caption" color="success.main">
                        🧠 L'IA apprend de vos corrections.
                    </Typography>
                )}
            </Box>

            {/* 1. Prompt de Confirmation de Réévaluation */}
            <Dialog
                open={reevalConfirmOpen}
                onClose={() => setReevalConfirmOpen(false)}
                PaperProps={{
                    sx: {
                        borderRadius: 3,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
                        p: 1,
                        maxWidth: 480
                    }
                }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
                    <SparklesIcon sx={{ color: 'primary.main', fontSize: 28 }} />
                    <Typography variant="h6" fontWeight={700}>
                        Réévaluation par l'IA
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Vous avez corrigé le locuteur <strong>{reevalOldName}</strong> en <strong>{reevalNewName}</strong>. 
                        L'IA peut analyser le reste de la transcription et comparer les empreintes vocales pour identifier automatiquement d'autres segments qui pourraient appartenir à <strong>{reevalNewName}</strong>.
                    </Typography>
                    {reevalRefSegment && reevalRefSegment.text && (
                        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2, borderStyle: 'dashed' }}>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5, fontWeight: 600 }}>
                                Extrait de référence ({Math.round(reevalRefSegment.startTime)}s) :
                            </Typography>
                            <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.primary' }}>
                                "{reevalRefSegment.text.length > 100 ? `${reevalRefSegment.text.substring(0, 100)}...` : reevalRefSegment.text}"
                            </Typography>
                        </Paper>
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
                    <Button 
                        onClick={() => setReevalConfirmOpen(false)} 
                        color="inherit" 
                        variant="text"
                        sx={{ borderRadius: 2, textTransform: 'none' }}
                    >
                        Plus tard
                    </Button>
                    <Button 
                        onClick={runReevaluation} 
                        variant="contained" 
                        color="primary"
                        startIcon={<SparklesIcon />}
                        sx={{ 
                            borderRadius: 2, 
                            textTransform: 'none',
                            boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                            fontWeight: 600
                        }}
                    >
                        Analyser la séance
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 2. Dialogue de Résultats de la Réévaluation */}
            <Dialog
                open={reevalDialogOpen}
                onClose={reevalLoading ? undefined : () => setReevalDialogOpen(false)}
                maxWidth="md"
                fullWidth
                PaperProps={{
                    sx: {
                        borderRadius: 3,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                        maxHeight: '85vh'
                    }
                }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', py: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <MLIcon sx={{ color: 'primary.main', fontSize: 26 }} />
                        <Box>
                            <Typography variant="h6" fontWeight={700}>
                                Réévaluation Vocale IA
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Comparaison d'empreinte : {reevalOldName} → {reevalNewName}
                            </Typography>
                        </Box>
                    </Box>
                    {!reevalLoading && (
                        <Chip 
                            label={`${reevalCandidates.length} segment(s) trouvé(s)`} 
                            size="small" 
                            color="primary" 
                            variant="outlined" 
                            sx={{ fontWeight: 600 }}
                        />
                    )}
                </DialogTitle>

                <DialogContent sx={{ p: 0, bgcolor: 'grey.50' }}>
                    {reevalLoading ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, px: 3, gap: 3 }}>
                            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                                <CircularProgress size={64} thickness={4} />
                                <Box
                                    sx={{
                                        top: 0,
                                        left: 0,
                                        bottom: 0,
                                        right: 0,
                                        position: 'absolute',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <MLIcon color="primary" sx={{ fontSize: 28, animation: 'pulse 1.5s infinite ease-in-out' }} />
                                </Box>
                            </Box>
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                    L'IA analyse les segments vocaux...
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
                                    Extraction de l'empreinte vocale de référence et comparaison par similarité cosinus avec les autres segments de la séance.
                                </Typography>
                            </Box>
                            <style>{`
                                @keyframes pulse {
                                    0% { transform: scale(0.9); opacity: 0.6; }
                                    50% { transform: scale(1.1); opacity: 1; }
                                    100% { transform: scale(0.9); opacity: 0.6; }
                                }
                            `}</style>
                        </Box>
                    ) : reevalCandidates.length === 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, px: 3, textAlign: 'center' }}>
                            <HelpIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                Aucun autre segment similaire détecté
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 450 }}>
                                L'IA n'a pas détecté d'autres interventions de {reevalOldName} partageant une empreinte vocale suffisamment proche de votre extrait de référence.
                            </Typography>
                        </Box>
                    ) : (
                        <Box>
                            <Box sx={{ px: 3, py: 1.5, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={selectedCandidateIndexes.size === reevalCandidates.length}
                                            indeterminate={selectedCandidateIndexes.size > 0 && selectedCandidateIndexes.size < reevalCandidates.length}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedCandidateIndexes(new Set(reevalCandidates.map(c => c.index)));
                                                } else {
                                                    setSelectedCandidateIndexes(new Set());
                                                }
                                            }}
                                            size="small"
                                        />
                                    }
                                    label={
                                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                            Tout sélectionner
                                        </Typography>
                                    }
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                    💡 Cliquez sur le badge de temps pour écouter l'extrait
                                </Typography>
                            </Box>

                            <List disablePadding sx={{ maxHeight: '50vh', overflow: 'auto' }}>
                                {reevalCandidates.map((candidate, idx) => {
                                    const isSelected = selectedCandidateIndexes.has(candidate.index);
                                    
                                    // Colors based on confidence
                                    let badgeColor: 'success' | 'warning' | 'default' = 'default';
                                    let badgeBg = 'grey.100';
                                    let badgeText = 'text.secondary';
                                    if (candidate.confidence === 'high') {
                                        badgeColor = 'success';
                                        badgeBg = 'success.50';
                                        badgeText = 'success.dark';
                                    } else if (candidate.confidence === 'medium') {
                                        badgeColor = 'warning';
                                        badgeBg = 'warning.50';
                                        badgeText = 'warning.dark';
                                    }

                                    // Format time
                                    const formatTime = (seconds: number) => {
                                        const mins = Math.floor(seconds / 60);
                                        const secs = Math.floor(seconds % 60);
                                        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                                    };

                                    return (
                                        <React.Fragment key={candidate.index}>
                                            <ListItem
                                                disablePadding
                                                secondaryAction={
                                                    <Chip
                                                        label={candidate.recommendation}
                                                        size="small"
                                                        color={badgeColor}
                                                        variant="outlined"
                                                        sx={{
                                                            fontSize: '0.75rem',
                                                            fontWeight: 600,
                                                            bgcolor: badgeBg,
                                                            borderColor: 'transparent',
                                                            color: badgeText,
                                                            mr: 1
                                                        }}
                                                    />
                                                }
                                                sx={{
                                                    bgcolor: isSelected ? 'primary.50' : 'background.paper',
                                                    transition: 'background-color 0.2s',
                                                    '&:hover': {
                                                        bgcolor: isSelected ? 'primary.100' : 'action.hover'
                                                    }
                                                }}
                                            >
                                                <ListItemButton
                                                    onClick={() => {
                                                        const newSelected = new Set(selectedCandidateIndexes);
                                                        if (newSelected.has(candidate.index)) {
                                                            newSelected.delete(candidate.index);
                                                        } else {
                                                            newSelected.add(candidate.index);
                                                        }
                                                        setSelectedCandidateIndexes(newSelected);
                                                    }}
                                                    sx={{ py: 1.5, pr: 24 }}
                                                >
                                                    <ListItemIcon sx={{ minWidth: 40 }}>
                                                        <Checkbox
                                                            edge="start"
                                                            checked={isSelected}
                                                            tabIndex={-1}
                                                            disableRipple
                                                            size="small"
                                                        />
                                                    </ListItemIcon>
                                                    
                                                    {/* Clickable timestamp badge */}
                                                    <Tooltip title="Écouter cet extrait" arrow>
                                                        <Chip
                                                            label={formatTime(candidate.startTime)}
                                                            size="small"
                                                            color="primary"
                                                            onClick={(e) => {
                                                                e.stopPropagation(); // Avoid toggling selection
                                                                if (onSeek) {
                                                                    onSeek(candidate.startTime);
                                                                    setSnackMessage(`🎵 Lecture à ${formatTime(candidate.startTime)}`);
                                                                }
                                                            }}
                                                            sx={{
                                                                mr: 2,
                                                                fontWeight: 700,
                                                                fontSize: '0.75rem',
                                                                borderRadius: 1.5,
                                                                cursor: 'pointer',
                                                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                                                '&:hover': {
                                                                    bgcolor: 'primary.dark',
                                                                }
                                                            }}
                                                        />
                                                    </Tooltip>

                                                    <ListItemText
                                                        primary={
                                                            <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.primary', pr: 2 }}>
                                                                "{candidate.text}"
                                                            </Typography>
                                                        }
                                                        secondary={
                                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                                                Durée : {Math.round(candidate.duration)} secondes
                                                            </Typography>
                                                        }
                                                    />
                                                </ListItemButton>
                                            </ListItem>
                                            {idx < reevalCandidates.length - 1 && <Divider />}
                                        </React.Fragment>
                                    );
                                })}
                            </List>
                        </Box>
                    )}
                </DialogContent>

                <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', gap: 1 }}>
                    <Button
                        onClick={() => setReevalDialogOpen(false)}
                        color="inherit"
                        variant="text"
                        disabled={reevalLoading}
                        sx={{ borderRadius: 2, textTransform: 'none' }}
                    >
                        Conserver tels quels
                    </Button>
                    <Button
                        onClick={handleApplyReevaluation}
                        variant="contained"
                        color="success"
                        disabled={reevalLoading || selectedCandidateIndexes.size === 0}
                        startIcon={<CheckIcon />}
                        sx={{
                            borderRadius: 2,
                            textTransform: 'none',
                            fontWeight: 600,
                            boxShadow: '0 4px 12px rgba(46, 125, 50, 0.2)',
                            '&:hover': {
                                bgcolor: 'success.dark',
                            }
                        }}
                    >
                        Appliquer la sélection ({selectedCandidateIndexes.size})
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar for feedback */}
            <Snackbar
                open={!!snackMessage}
                autoHideDuration={5000}
                onClose={() => setSnackMessage(null)}
                message={snackMessage}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />
        </Box>
    );
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse transcription text into typed segments for rendering.
 * Splits text by newlines to allow line-level interactivity.
 */
function parseTranscription(text: string): TranscriptionSegment[] {
    if (!text) return [];

    const segments: TranscriptionSegment[] = [];

    // Combined regex to match speakers and timestamps
    const pattern = /(\[([A-Za-zÀ-ÿ][^\]]*)\])|(\*\*([^*]+)\*\*:?)|(\[\d+:\d{2}(?::\d{2})?\])/g;

    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        // Handle text BEFORE the match
        if (match.index > lastIndex) {
            const textChunk = text.substring(lastIndex, match.index);
            // Split by newline to create separate segments per line (preserves exact chars)
            // We use 'split' but need to keep delimiters or calculate positions manually.
            let currentPos = lastIndex;
            // Split by newline but keep the newline in the segment
            const lines = textChunk.split(/(\r\n|\r|\n)/);

            lines.forEach(line => {
                if (line) {
                    segments.push({
                        type: 'text',
                        content: line,
                        position: currentPos,
                    });
                    currentPos += line.length;
                }
            });
        }

        // Handle the MATCH itself
        if (match[5]) { // Timestamp
            segments.push({
                type: 'timestamp',
                content: match[5],
                position: match.index,
            });
        } else if (match[1]) { // [Speaker Name]
            const name = match[2].trim();
            if (/^\d{1,2}:\d{2}/.test(name)) { // Ignore timestamp-like
                segments.push({
                    type: 'timestamp',
                    content: match[1],
                    position: match.index,
                });
            } else {
                segments.push({
                    type: 'speaker',
                    content: match[1],
                    speakerName: name,
                    position: match.index,
                });
            }
        } else if (match[3]) { // **Speaker Name**
            const name = match[4].replace(/:$/, '').trim();
            segments.push({
                type: 'speaker',
                content: match[3],
                speakerName: name,
                position: match.index,
            });
        }

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        const textChunk = text.substring(lastIndex);
        let currentPos = lastIndex;
        const lines = textChunk.split(/(\r\n|\r|\n)/);

        lines.forEach(line => {
            if (line) {
                segments.push({
                    type: 'text',
                    content: line,
                    position: currentPos,
                });
                currentPos += line.length;
            }
        });
    }

    return segments;
}

/**
 * Estimate the audio time range for a segment based on its position in the text.
 */
function estimateSegmentTime(
    text: string,
    position: number,
    totalDuration: number
): { start: number; end: number } {
    const tsPattern = /\[(\d+:\d{2}(?::\d{2})?)\]/g;
    const timestamps: Array<{ pos: number; seconds: number }> = [];

    let match;
    while ((match = tsPattern.exec(text)) !== null) {
        const parts = match[1].split(':').map(Number);
        let seconds = 0;
        if (parts.length === 3) {
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            seconds = parts[0] * 60 + parts[1];
        }
        timestamps.push({ pos: match.index, seconds });
    }

    if (timestamps.length >= 2) {
        // Find the timestamp just before and just after the position
        let prevIdx = 0;
        let nextIdx = -1;

        for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i].pos <= position) {
                prevIdx = i;
            } else {
                nextIdx = i;
                break;
            }
        }

        const prevTs = timestamps[prevIdx];

        // Case 1: Position is AFTER the last timestamp
        // Interpolate based on how far into the remaining text we are
        if (nextIdx === -1) {
            const remainingText = text.length - prevTs.pos;
            const posInRemaining = position - prevTs.pos;
            const ratio = remainingText > 0 ? posInRemaining / remainingText : 0;
            const remainingAudio = totalDuration - prevTs.seconds;

            const start = Math.floor(prevTs.seconds + ratio * remainingAudio);
            return {
                start,
                end: Math.min(start + 30, totalDuration),
            };
        }

        // Case 2: Position is between two timestamps
        // Interpolate within the two timestamps based on text position
        const textSpan = nextIdx > 0 ? (timestamps[nextIdx].pos - prevTs.pos) : 1;
        const posInSpan = position - prevTs.pos;
        const ratio = textSpan > 0 ? posInSpan / textSpan : 0;
        const timeSpan = timestamps[nextIdx].seconds - prevTs.seconds;

        const start = Math.floor(prevTs.seconds + ratio * timeSpan);
        const end = Math.min(start + 30, timestamps[nextIdx].seconds);
        // BUGFIX: Removed `Math.max(end, start + 5)` which forced a 5s minimum.
        // If a person speaks for only 2 seconds, forcing 5s captures the NEXT person's voice
        // and severely pollutes the ML profile.
        return { start, end };
    }

    // Fallback: no timestamps found, estimate from text position ratio
    const ratio = position / Math.max(text.length, 1);
    const start = Math.floor(ratio * totalDuration);
    return {
        start,
        end: Math.min(start + 30, totalDuration),
    };
}

/**
 * Replace a speaker label at a specific character position with a new name,
 * matching either [Name] or **Name** formats.
 */
function replaceSpeakerAtPosition(text: string, position: number, oldName: string, newName: string): string {
    const before = text.substring(0, position);
    let tagLength = 0;
    if (text.substring(position).startsWith('[')) {
        tagLength = oldName.length + 2; // [Name]
    } else {
        const suffix = text.substring(position + oldName.length + 4).startsWith(':') ? 1 : 0;
        tagLength = oldName.length + 4 + suffix;
    }
    const after = text.substring(position + tagLength);
    return before + `[${newName}]` + after;
}

export default SpeakerCorrectionTranscription;