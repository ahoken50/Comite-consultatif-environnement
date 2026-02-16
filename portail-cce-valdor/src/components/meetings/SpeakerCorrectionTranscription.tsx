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

import React, { useState, useMemo, useCallback } from 'react';
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
} from '@mui/material';
import {
    RecordVoiceOver as VoiceIcon,
    CheckCircle as CheckIcon,
    Psychology as MLIcon,
    PersonAdd as PersonAddIcon,
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
    onTranscriptionUpdate?: (newTranscription: string) => void;
    onCorrectionMade?: (original: string, corrected: string) => void;
}

export const SpeakerCorrectionTranscription: React.FC<SpeakerCorrectionTranscriptionProps> = ({
    transcription,
    members,
    meetingId,
    audioUrl,
    audioDuration = 0,
    onTranscriptionUpdate,
    onCorrectionMade,
}) => {
    const [corrections, setCorrections] = useState<SpeakerCorrection[]>([]);
    const [learningStatus, setLearningStatus] = useState<string | null>(null);
    const [snackMessage, setSnackMessage] = useState<string | null>(null);

    // Split Popover State
    const [splitAnchorEl, setSplitAnchorEl] = useState<HTMLElement | null>(null);
    const [activeSplitSegment, setActiveSplitSegment] = useState<TranscriptionSegment | null>(null);

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

    }, [transcription, members, meetingId, audioUrl, audioDuration, onTranscriptionUpdate, onCorrectionMade]);

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
                        const feedbackFn = httpsCallable(functions, 'closed_feedback_loop');
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

                    // 3. TEXT (with split capability)
                    return (
                        <Box
                            component="span"
                            key={idx}
                            sx={{
                                position: 'relative',
                                display: 'inline',
                                '&:hover .split-btn': { opacity: 1 }
                            }}
                        >
                            {/* Split Button (appears on hover) */}
                            <Tooltip title="Définir un locuteur à partir d'ici" arrow placement="top">
                                <IconButton
                                    className="split-btn"
                                    size="small"
                                    onClick={(e) => {
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
};

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
    const pattern = /(\[([A-Za-zÀ-ÿ][^\]]*)\])|(\*\*([^*]+)\*\*:?)|(\[\d{1,2}:\d{2}(?::\d{2})?\])/g;

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
    const tsPattern = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
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
        let prevTs = timestamps[0];
        let nextTs = timestamps[timestamps.length - 1];

        for (const ts of timestamps) {
            if (ts.pos <= position) {
                prevTs = ts;
            } else {
                nextTs = ts;
                break;
            }
        }

        // If we are closer to the next TS than the prev (short segment at end of block), adjust?
        // For now, simple window
        return {
            start: prevTs.seconds,
            end: Math.min(nextTs.seconds, prevTs.seconds + 45),
        };
    }

    const ratio = position / Math.max(text.length, 1);
    const start = Math.floor(ratio * totalDuration);
    return {
        start,
        end: Math.min(start + 30, totalDuration),
    };
}

export default SpeakerCorrectionTranscription;