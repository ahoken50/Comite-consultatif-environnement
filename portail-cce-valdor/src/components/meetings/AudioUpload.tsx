import React, { useState, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    LinearProgress,
    IconButton,
    Alert,
    Chip,
    CircularProgress
} from '@mui/material';
import {
    CloudUpload,
    AudioFile,
    Delete,
    PlayArrow,
    Pause,
    Merge,
    QueueMusic
} from '@mui/icons-material';
// import { aiService } from '../../services/ai/UnifiedAIService'; // Removed unused import

import type { AudioRecording } from '../../types/meeting.types';
import type { UploadProgress } from '../../services/audioStorageService';
import {
    uploadAudioFile,
    deleteAudioFile,
    validateAudioFile,
    formatFileSize,
    formatDuration
} from '../../services/audioStorageService';
import { isGeminiConfigured, transcribeAudio } from '../../services/geminiService';

interface AudioUploadProps {
    meetingId: string;
    audioRecording?: AudioRecording; // Legacy
    audioRecordings?: AudioRecording[]; // New
    onUploadComplete?: (recording: AudioRecording) => void;
    onDelete?: (recording?: AudioRecording) => void;
    onTranscriptionComplete?: (mergedTranscription?: string) => void;
}

const AudioUpload: React.FC<AudioUploadProps> = ({
    meetingId,
    audioRecording,
    audioRecordings,
    onUploadComplete,
    onDelete,
    onTranscriptionComplete
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [playingUrl, setPlayingUrl] = useState<string | null>(null); // Track which file is playing
    const [isTranscribing, setIsTranscribing] = useState(false);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);

    // Use audioRecordings array if available, otherwise fall back to legacy single recording
    // Avoid mixing both to prevent duplicates and stale data issues
    const recordings: AudioRecording[] = (() => {
        const arr = Array.isArray(audioRecordings) ? audioRecordings : [];
        if (arr.length > 0) {
            return arr;
        }
        // Fall back to legacy single recording only if array is empty
        return audioRecording ? [audioRecording] : [];
    })();

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            // Handle all dropped files
            Array.from(files).forEach(file => handleFileUpload(file));
        }
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            Array.from(files).forEach(file => handleFileUpload(file));
        }
    }, []);

    const handleFileUpload = async (file: File) => {
        setError(null);

        // Validate first
        const validation = validateAudioFile(file);
        if (!validation.valid) {
            setError(validation.error || 'Fichier invalide');
            return;
        }

        // Start upload
        const result = await uploadAudioFile(
            meetingId,
            file,
            (progress) => setUploadProgress(progress)
        );

        if (result.success && result.audioRecording) {
            setUploadProgress(null);
            onUploadComplete?.(result.audioRecording);
        } else {
            setError(result.error || 'Erreur lors du téléchargement');
            setUploadProgress(null);
        }
    };

    const handleDelete = async (rec: AudioRecording) => {
        if (rec.storagePath) {
            const success = await deleteAudioFile(rec.storagePath);
            if (success) {
                onDelete?.(rec);
            } else {
                setError('Erreur lors de la suppression');
            }
        } else {
            onDelete?.(rec);
        }
    };

    const togglePlayback = (url: string) => {
        if (audioRef.current) {
            if (playingUrl === url && !audioRef.current.paused) {
                audioRef.current.pause();
                setPlayingUrl(null);
            } else {
                setPlayingUrl(url);
                audioRef.current.src = url;
                audioRef.current.play();
            }
        }
    };

    const handleMergeAndTranscribe = async () => {
        if (recordings.length === 0) return;

        if (!isGeminiConfigured()) {
            setError('Clé API Gemini non configurée.');
            return;
        }

        setIsTranscribing(true);
        setError(null);

        try {
            // Process all recordings in parallel
            const promises = recordings.map(async (rec) => {
                // Skip already completed ones
                if (rec.transcriptionStatus === 'completed' && rec.transcription) {
                    return;
                }

                console.log(`[AudioUpload] Submitting transcription for ${rec.fileName}`);

                // Call server-side transcription trigger (Speechmatics Webhook)
                const result = await transcribeAudio(
                    meetingId,
                    rec.fileUrl,
                    rec.mimeType,
                    rec.storagePath
                );

                if (!result.success) {
                    console.error(`Failed to submit ${rec.fileName}:`, result.error);
                    // Don't throw, let others proceed. Errors will be visible in status if applicable.
                }
            });

            await Promise.all(promises);

            // We don't wait for text, we wait for submission.
            // Feedback to user
            onTranscriptionComplete?.('Transcription démarrée. Veuillez patienter, les statuts se mettront à jour automatiquement.');

        } catch (err) {
            console.error('Transcription submission failed:', err);
            setError(err instanceof Error ? err.message : 'Erreur de soumission');
        }

        setIsTranscribing(false);
    };



    const getStatusColor = (status: AudioRecording['transcriptionStatus']) => {
        switch (status) {
            case 'completed': return 'success';
            case 'processing': return 'info';
            case 'error': return 'error';
            default: return 'warning';
        }
    };

    const getStatusLabel = (status: AudioRecording['transcriptionStatus']) => {
        switch (status) {
            case 'completed': return 'Transcrit';
            case 'processing': return 'Transcription en cours...';
            case 'error': return 'Erreur de transcription';
            default: return 'En attente de transcription';
        }
    };

    // If there are existing recordings, show list
    if (recordings.length > 0) {
        return (
            <Paper sx={{ p: 3, mb: 3, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" gutterBottom color="text.secondary">
                    Fichiers Audio ({recordings.length})
                </Typography>

                {recordings.map((rec, index) => (
                    <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
                        <AudioFile color="primary" />
                        <Box sx={{ flexGrow: 1 }}>
                            <Typography variant="subtitle2" fontWeight={600}>
                                {rec.fileName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {formatFileSize(rec.fileSize)} • {formatDuration(rec.duration)}
                            </Typography>
                            <Chip
                                label={getStatusLabel(rec.transcriptionStatus)}
                                color={getStatusColor(rec.transcriptionStatus)}
                                size="small"
                                sx={{ ml: 2, height: 20, fontSize: '0.65rem' }}
                            />
                        </Box>
                        <IconButton onClick={() => togglePlayback(rec.fileUrl)} color="primary">
                            {playingUrl === rec.fileUrl ? <Pause /> : <PlayArrow />}
                        </IconButton>
                        <IconButton onClick={() => handleDelete(rec)} color="error">
                            <Delete />
                        </IconButton>
                    </Box>
                ))}

                {/* Merge Transcription Button */}
                <Box sx={{ mt: 2 }}>
                    <Button
                        variant="contained"
                        color="secondary"
                        fullWidth
                        startIcon={isTranscribing ? <CircularProgress size={20} color="inherit" /> : <Merge />}
                        onClick={handleMergeAndTranscribe}
                        disabled={isTranscribing}
                    >
                        {isTranscribing ? 'Démarrage des transcriptions...' : 'Lancer la Transcription (Tout)'}
                    </Button>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
                )}

                <audio
                    ref={audioRef}
                    onEnded={() => setPlayingUrl(null)}
                    style={{ display: 'none' }}
                />

                {/* Allow adding MORE files */}
                <Box sx={{ mt: 3, borderTop: '1px dashed', borderColor: 'divider', pt: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>Ajouter une autre partie :</Typography>
                    <Box
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        sx={{
                            p: 2, textAlign: 'center', border: '2px dashed', borderColor: isDragging ? 'primary.main' : 'divider',
                            bgcolor: isDragging ? 'action.hover' : 'background.paper', cursor: 'pointer', borderRadius: 1
                        }}
                    >
                        <Button component="label" startIcon={<QueueMusic />}>
                            Ajouter un fichier
                            <input type="file" hidden accept="audio/*,video/*" multiple onChange={handleFileSelect} />
                        </Button>
                    </Box>
                </Box>
            </Paper>
        );
    }

    // Upload in progress
    if (uploadProgress && uploadProgress.state === 'running') {
        return (
            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                    Téléchargement en cours...
                </Typography>
                <LinearProgress
                    variant="determinate"
                    value={uploadProgress.progress}
                    sx={{ mb: 1 }}
                />
                <Typography variant="body2" color="text.secondary">
                    {formatFileSize(uploadProgress.bytesTransferred)} / {formatFileSize(uploadProgress.totalBytes)}
                    {' '}({uploadProgress.progress.toFixed(0)}%)
                </Typography>
            </Paper>
        );
    }

    // Upload zone
    return (
        <Box sx={{ mb: 3 }}>
            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}
            <Paper
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                sx={{
                    p: 4,
                    textAlign: 'center',
                    border: '2px dashed',
                    borderColor: isDragging ? 'primary.main' : 'divider',
                    bgcolor: isDragging ? 'action.hover' : 'background.paper',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        borderColor: 'primary.light',
                        bgcolor: 'action.hover'
                    }
                }}
            >
                <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                    Importer un enregistrement
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                    Glissez-déposez un fichier audio/vidéo ou cliquez pour sélectionner
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                    Formats: MP3, M4A, WAV, MP4, WEBM • Max: 500 MB / 2h30
                </Typography>
                <Button
                    variant="contained"
                    component="label"
                    startIcon={<CloudUpload />}
                >
                    Sélectionner des fichiers
                    <input
                        type="file"
                        hidden
                        accept="audio/*,video/*"
                        multiple
                        onChange={handleFileSelect}
                    />
                </Button>
            </Paper>
        </Box>
    );
};

export default AudioUpload;
