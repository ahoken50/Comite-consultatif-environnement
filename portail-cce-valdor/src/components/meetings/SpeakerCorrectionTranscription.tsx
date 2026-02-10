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
} from '@mui/material';
import {
    RecordVoiceOver as VoiceIcon,
    CheckCircle as CheckIcon,
    Psychology as MLIcon,
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

    // Handle speaker correction
    const handleSpeakerChange = useCallback(async (
        event: SelectChangeEvent<string>,
        segment: TranscriptionSegment,
    ) => {
        const newName = event.target.value;
        const oldName = segment.speakerName || '';

        if (newName === oldName) return;

        // 1. Update transcription text
        let newTranscription = transcription;
        const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Replace all occurrences of this speaker name
        const bracketPattern = new RegExp(`\\[${escapedOldName}\\]`, 'g');
        newTranscription = newTranscription.replace(bracketPattern, `[${newName}]`);

        const boldPattern = new RegExp(`\\*\\*${escapedOldName}\\*\\*:?`, 'g');
        newTranscription = newTranscription.replace(boldPattern, `**${newName}**:`);

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
        if (audioUrl && audioDuration > 0) {
            correction.isLearning = true;
            setCorrections(prev => prev.map(c => 
                c.position === correction.position ? { ...c, isLearning: true } : c
            ));
            setLearningStatus(`🧠 Apprentissage en cours pour ${newName}...`);

            try {
                // Find nearest timestamp markers for better accuracy
                const { start, end } = estimateSegmentTime(
                    transcription, segment.position, audioDuration
                );

                const segmentDuration = end - start;

                // Only trigger ML if segment is long enough (>5 seconds)
                if (segmentDuration >= 5) {
                    // Find member IDs
                    const correctMember = members.find(m => m.displayName === newName);
                    if (correctMember) {
                        // Call closed_feedback_loop for correction logging + embedding reinforcement
                        const { getFunctions, httpsCallable } = await import('firebase/functions');
                        const functions = getFunctions();
                        
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

                        setSnackMessage(
                            `✅ Correction appliquée: ${oldName} → ${newName}. ` +
                            `Profil vocal renforcé (${Math.round(segmentDuration)}s d'audio).`
                        );
                    } else {
                        setSnackMessage(`✅ Correction appliquée: ${oldName} → ${newName}`);
                    }
                } else {
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
                    c.position === correction.position ? { ...c, isLearning: false, learned: true } : c
                ));
                setLearningStatus(null);
            }
        } else {
            setSnackMessage(`✅ Correction appliquée: ${oldName} → ${newName}`);
        }
    }, [transcription, members, meetingId, audioUrl, audioDuration, onTranscriptionUpdate, onCorrectionMade]);

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
                    maxHeight: 400,
                    overflow: 'auto',
                    bgcolor: 'grey.50',
                    fontSize: '0.85rem',
                    lineHeight: 1.8,
                }}
            >
                {segments.map((segment, idx) => {
                    if (segment.type === 'speaker') {
                        const correctionForThis = corrections.find(
                            c => c.originalName === segment.speakerName && !c.learned
                        );
                        const wasLearned = corrections.find(
                            c => (c.originalName === segment.speakerName || c.correctedName === segment.speakerName) && c.learned
                        );

                        return (
                            <Tooltip
                                key={idx}
                                title="Cliquez pour corriger le locuteur"
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
                                        minWidth: 'auto',
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
                                }}
                            />
                        );
                    }

                    // Regular text
                    return (
                        <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
                            {segment.content}
                        </span>
                    );
                })}
            </Paper>

            {/* Legend */}
            <Box sx={{ mt: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                    💡 Cliquez sur un nom de locuteur pour le corriger.
                </Typography>
                {audioUrl && (
                    <Typography variant="caption" color="success.main">
                        🧠 Les corrections longues (&gt;5s) entraînent automatiquement l'IA.
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
 * Handles formats: [Speaker Name], **Speaker Name**:, [HH:MM:SS]
 */
function parseTranscription(text: string): TranscriptionSegment[] {
    if (!text) return [];

    const segments: TranscriptionSegment[] = [];
    
    // Combined regex to match speakers and timestamps
    // Group 1: [Speaker Name] (not timestamps)
    // Group 2: **Speaker Name**
    // Group 3: [HH:MM:SS] timestamps
    const pattern = /(\[([A-Za-zÀ-ÿ][^\]]*)\])|(\*\*([^*]+)\*\*:?)|(\[\d{1,2}:\d{2}(?::\d{2})?\])/g;
    
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        // Add text before this match
        if (match.index > lastIndex) {
            const textBefore = text.substring(lastIndex, match.index);
            if (textBefore) {
                segments.push({
                    type: 'text',
                    content: textBefore,
                    position: lastIndex,
                });
            }
        }

        if (match[5]) {
            // Timestamp [HH:MM:SS]
            segments.push({
                type: 'timestamp',
                content: match[5],
                position: match.index,
            });
        } else if (match[1]) {
            // [Speaker Name] — check it's not a timestamp
            const name = match[2].trim();
            if (/^\d{1,2}:\d{2}/.test(name)) {
                // It's a timestamp
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
        } else if (match[3]) {
            // **Speaker Name**
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
        segments.push({
            type: 'text',
            content: text.substring(lastIndex),
            position: lastIndex,
        });
    }

    return segments;
}

/**
 * Estimate the audio time range for a segment based on its position in the text.
 * Uses timestamp markers if available, otherwise estimates from text position ratio.
 */
function estimateSegmentTime(
    text: string,
    position: number,
    totalDuration: number
): { start: number; end: number } {
    // Find timestamp markers
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
        // Find surrounding timestamps
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

        return {
            start: prevTs.seconds,
            end: Math.min(nextTs.seconds, prevTs.seconds + 45),
        };
    }

    // Fallback: estimate from position ratio
    const ratio = position / Math.max(text.length, 1);
    const start = Math.floor(ratio * totalDuration);
    return {
        start,
        end: Math.min(start + 30, totalDuration),
    };
}

export default SpeakerCorrectionTranscription;