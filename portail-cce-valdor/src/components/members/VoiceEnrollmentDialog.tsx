
import React, { useState, useRef, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    IconButton,
    LinearProgress,
    Alert,
    Tabs,
    Tab,
    Input
} from '@mui/material';
import { Mic, Stop, Save, Delete, CloudUpload } from '@mui/icons-material';
import { keyframes } from '@emotion/react';

interface VoiceEnrollmentDialogProps {
    open: boolean;
    memberName: string;
    onClose: () => void;
    onSave: (audioBlobs: Blob[]) => Promise<void>;
}

const pulse = keyframes`
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 0, 78, 0.7); }
  70% { transform: scale(1.1); box-shadow: 0 0 0 10px rgba(220, 0, 78, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 0, 78, 0); }
`;

const VoiceEnrollmentDialog: React.FC<VoiceEnrollmentDialogProps> = ({
    open,
    memberName,
    onClose,
    onSave
}) => {
    const [tab, setTab] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [uploadFiles, setUploadFiles] = useState<File[]>([]);
    const [duration, setDuration] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Cleanup URL on unmount
    useEffect(() => {
        return () => {
            if (audioUrl) URL.revokeObjectURL(audioUrl);
        };
    }, [audioUrl]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            setUploadFiles(Array.from(event.target.files));
        }
    };

    const startRecording = async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(track => track.stop()); // Stop mic
            };

            mediaRecorder.start();
            setIsRecording(true);
            setDuration(0);

            timerRef.current = setInterval(() => {
                setDuration(prev => prev + 1);
            }, 1000);

        } catch (err) {
            console.error("Error accessing microphone:", err);
            setError("Impossible d'accéder au microphone. Veuillez vérifier vos permissions.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
    };

    const handleReset = () => {
        setAudioBlob(null);
        setAudioUrl(null);
        setUploadFiles([]);
        setDuration(0);
        setError(null);
    };

    const handleSave = async () => {
        const blobsToSave: Blob[] = [];

        if (tab === 0 && audioBlob) {
            blobsToSave.push(audioBlob);
        } else if (tab === 1 && uploadFiles.length > 0) {
            blobsToSave.push(...uploadFiles);
        }

        if (blobsToSave.length === 0) return;

        setIsSaving(true);
        // We'll update parent to handle progress or just wait
        try {
            await onSave(blobsToSave);
            onClose();
        } catch (err: any) {
            setError(err.message || "Erreur lors de l'enrôlement.");
        } finally {
            setIsSaving(false);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <Dialog open={open} onClose={!isSaving ? onClose : undefined} maxWidth="sm" fullWidth>
            <DialogTitle>Enrôlement Vocal : {memberName}</DialogTitle>
            <DialogContent>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <Tab label="Enregistrement" />
                    <Tab label="Téléversement" />
                </Tabs>

                <Box sx={{ my: 2 }}>
                    <Typography variant="body1" paragraph>
                        {tab === 0
                            ? "Veuillez lire le texte ci-dessous pour créer votre empreinte vocale (environ 30 secondes)."
                            : "Vous pouvez téléverser un ou plusieurs fichiers audio existants (MP3, WAV, M4A) contenant votre voix."}
                    </Typography>

                    {tab === 0 && (
                        <Box sx={{
                            p: 3,
                            bgcolor: 'grey.100',
                            borderRadius: 2,
                            border: '1px solid',
                            borderColor: 'grey.300',
                            mb: 3,
                            fontStyle: 'italic',
                            lineHeight: 1.6
                        }}>
                            "Je m'appelle {memberName} et je suis membre du comité consultatif en environnement de Val-d'Or.
                            Nous travaillons ensemble pour la protection de la biodiversité, la gestion des eaux et la lutte aux changements climatiques.
                            Ceci est un échantillon de ma voix pour le système de transcription automatique."
                        </Box>
                    )}

                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

                        {tab === 0 && (
                            <>
                                {!audioBlob ? (
                                    <IconButton
                                        onClick={isRecording ? stopRecording : startRecording}
                                        sx={{
                                            width: 80,
                                            height: 80,
                                            bgcolor: isRecording ? 'error.main' : 'primary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: isRecording ? 'error.dark' : 'primary.dark' },
                                            animation: isRecording ? `${pulse} 1.5s infinite` : 'none'
                                        }}
                                    >
                                        {isRecording ? <Stop fontSize="large" /> : <Mic fontSize="large" />}
                                    </IconButton>
                                ) : (
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', width: '100%' }}>
                                        <audio src={audioUrl!} controls style={{ flex: 1 }} />
                                        <IconButton onClick={handleReset} color="error" title="Recommencer">
                                            <Delete />
                                        </IconButton>
                                    </Box>
                                )}

                                {isRecording && (
                                    <Typography variant="h6" color="error">
                                        Enregistrement... {formatTime(duration)}
                                    </Typography>
                                )}
                            </>
                        )}

                        {tab === 1 && (
                            <Box sx={{ width: '100%', textAlign: 'center' }}>
                                <Button
                                    component="label"
                                    variant="outlined"
                                    startIcon={<CloudUpload />}
                                    sx={{ mb: 2 }}
                                >
                                    Sélectionner des fichiers
                                    <input
                                        type="file"
                                        hidden
                                        multiple
                                        accept="audio/*"
                                        onChange={handleFileChange}
                                    />
                                </Button>
                                {uploadFiles.length > 0 && (
                                    <Box sx={{ textAlign: 'left', mt: 1 }}>
                                        <Typography variant="subtitle2" gutterBottom>{uploadFiles.length} fichier(s) sélectionné(s) :</Typography>
                                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                                            {uploadFiles.map((f, i) => (
                                                <li key={i}>{f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)</li>
                                            ))}
                                        </ul>
                                    </Box>
                                )}
                            </Box>
                        )}

                        {isSaving && <LinearProgress sx={{ width: '100%', mt: 2 }} />}
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isSaving}>Annuler</Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={(!audioBlob && uploadFiles.length === 0) || isSaving}
                    startIcon={<Save />}
                >
                    {isSaving ? "Enregistrement..." : "Enrôler"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default VoiceEnrollmentDialog;
