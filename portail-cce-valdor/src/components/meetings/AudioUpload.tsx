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
    Psychology,
    UploadFile
} from '@mui/icons-material';

import type { AudioRecording } from '../../types/meeting.types';
import type { UploadProgress } from '../../services/audioStorageService';
import {
    uploadAudioFile,
    deleteAudioFile,
    validateAudioFile,
    formatFileSize,
    formatDuration
} from '../../services/audioStorageService';
import { transcribeAudio, transcribeLocalFile, isGeminiConfigured } from '../../services/geminiService';

interface AudioUploadProps {
    meetingId: string;
    audioRecording?: AudioRecording;
    onUploadComplete?: (recording: AudioRecording) => void;
    onDelete?: () => void;
    onTranscriptionComplete?: () => void;
}

const AudioUpload: React.FC<AudioUploadProps> = ({
    meetingId,
    audioRecording,
    onUploadComplete,
    onDelete,
    onTranscriptionComplete
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);

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
            handleFileUpload(files[0]);
        }
    }, []);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFileUpload(files[0]);
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

    const handleDelete = async () => {
        if (audioRecording?.storagePath) {
            const success = await deleteAudioFile(meetingId, audioRecording.storagePath);
            if (success) {
                onDelete?.();
            } else {
                setError('Erreur lors de la suppression');
            }
        }
    };

    const togglePlayback = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleTranscribe = async () => {
        if (!audioRecording) return;

        if (!isGeminiConfigured()) {
            setError('Clé API Gemini non configurée. Ajoutez VITE_GEMINI_API_KEY dans votre fichier .env');
            return;
        }

        setIsTranscribing(true);
        setError(null);

        const result = await transcribeAudio(
            meetingId,
            audioRecording.fileUrl,
            audioRecording.mimeType,
            audioRecording.storagePath
        );

        if (result.success) {
            onTranscriptionComplete?.();
        } else {
            console.error('Auto-transcription failed:', result.error);
            // Show specific error for manual upload suggestion
            if (result.error?.includes('Failed to fetch') || result.error?.includes('NetworkError')) {
                setError('Le téléchargement automatique a échoué (blocage réseau/navigateur). Veuillez utiliser l\'option de transcription manuelle ci-dessous.');
            } else {
                setError(result.error || 'Erreur lors de la transcription');
            }
        }

        setIsTranscribing(false);
    };

    const handleManualTranscription = async (file: File) => {
        setIsTranscribing(true);
        setError(null);

        const result = await transcribeLocalFile(meetingId, file);

        if (result.success) {
            onTranscriptionComplete?.();
        } else {
            setError(result.error || 'Erreur lors de la transcription manuelle');
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

    // If there's an existing recording, show it
    if (audioRecording) {
        return (
            <Paper
                sx={{
                    p: 3,
                    mb: 3,
                    bgcolor: 'background.default',
                    border: '1px solid',
                    borderColor: 'divider'
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <AudioFile color="primary" sx={{ fontSize: 40 }} />
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600}>
                            {audioRecording.fileName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {formatFileSize(audioRecording.fileSize)} • {formatDuration(audioRecording.duration)}
                        </Typography>
                        <Chip
                            label={getStatusLabel(audioRecording.transcriptionStatus)}
                            color={getStatusColor(audioRecording.transcriptionStatus)}
                            size="small"
                            sx={{ mt: 1 }}
                        />
                    </Box>
                    <IconButton onClick={togglePlayback} color="primary">
                        {isPlaying ? <Pause /> : <PlayArrow />}
                    </IconButton>
                    <IconButton onClick={handleDelete} color="error">
                        <Delete />
                    </IconButton>
                </Box>

                {/* Transcription Button */}
                {audioRecording.transcriptionStatus === 'pending' && (
                    <Box sx={{ mt: 2 }}>
                        <Button
                            variant="contained"
                            color="primary"
                            fullWidth
                            startIcon={isTranscribing ? <CircularProgress size={20} color="inherit" /> : <Psychology />}
                            onClick={handleTranscribe}
                            disabled={isTranscribing}
                        >
                            {isTranscribing ? 'Transcription en cours...' : 'Lancer la transcription IA'}
                        </Button>
                    </Box>
                )}

                {audioRecording.transcriptionStatus === 'processing' && (
                    <Box sx={{ mt: 2, textAlign: 'center' }}>
                        <CircularProgress size={24} sx={{ mr: 1 }} />
                        <Typography variant="body2" color="text.secondary" component="span">
                            Transcription en cours, veuillez patienter...
                        </Typography>
                    </Box>
                )}

                {audioRecording.transcriptionStatus === 'error' && (
                    <Box sx={{ mt: 2 }}>
                        <Alert severity="error">
                            {audioRecording.transcriptionError || 'Erreur de transcription'}
                        </Alert>
                        <Button
                            variant="outlined"
                            color="primary"
                            fullWidth
                            sx={{ mt: 1 }}
                            startIcon={<Psychology />}
                            onClick={handleTranscribe}
                            disabled={isTranscribing}
                        >
                            Réessayer
                        </Button>

                        {/* Fallback Manual Upload Button */}
                        <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed', borderColor: 'divider' }}>
                            <Typography variant="body2" color="info.main" sx={{ mb: 1 }}>
                                Si le bouton "Réessayer" échoue (erreur réseau), téléchargez le fichier manuellement ici :
                            </Typography>
                            <input
                                accept="audio/*"
                                style={{ display: 'none' }}
                                id="manual-upload-file"
                                type="file"
                                onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                        handleManualTranscription(e.target.files[0]);
                                    }
                                }}
                            />
                            <label htmlFor="manual-upload-file">
                                <Button
                                    variant="contained"
                                    color="secondary"
                                    component="span"
                                    fullWidth
                                    startIcon={<UploadFile />}
                                    disabled={isTranscribing}
                                >
                                    Transcription Manuelle (Upload Local)
                                </Button>
                            </label>
                        </Box>
                    </Box>
                )}


                <audio
                    ref={audioRef}
                    src={audioRecording.fileUrl}
                    onEnded={() => setIsPlaying(false)}
                    style={{ display: 'none' }}
                />
            </Paper >
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
                    Sélectionner un fichier
                    <input
                        type="file"
                        hidden
                        accept="audio/*,video/*"
                        onChange={handleFileSelect}
                    />
                </Button>
            </Paper>
        </Box>
    );
};

export default AudioUpload;
