import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    Divider,
    Grid,
    CircularProgress
} from '@mui/material';
import { AttachmentOutlined, CloudUpload } from '@mui/icons-material';
import { useDispatch } from 'react-redux';
import { updateRecommendation } from '../../features/governance/governanceSlice';
import { documentsAPI } from '../../features/documents/documentsAPI';
import type { AppDispatch } from '../../store/store';
import type { CouncilRecommendation } from '../../types/recommendation.types';

interface RecommendationDetailsDialogProps {
    open: boolean;
    onClose: () => void;
    recommendation: CouncilRecommendation | null;
}

const RecommendationDetailsDialog: React.FC<RecommendationDetailsDialogProps> = ({
    open,
    onClose,
    recommendation
}) => {
    const dispatch = useDispatch<AppDispatch>();
    const [editMode, setEditMode] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [councilResolution, setCouncilResolution] = useState('');
    const [feedback, setFeedback] = useState('');
    const [attachment, setAttachment] = useState<{ url: string, name: string, uploadedAt: string } | undefined>(undefined);
    const [isUploading, setIsUploading] = useState(false);

    // Reset state when opening
    React.useEffect(() => {
        if (recommendation) {
            setStatus(recommendation.status);
            setCouncilResolution(recommendation.councilResolutionNumber || '');
            setFeedback(recommendation.notes || '');
            setAttachment(recommendation.councilFeedbackAttachment);
        }
    }, [recommendation]);

    const handleSave = async () => {
        if (!recommendation) return;

        await dispatch(updateRecommendation({
            id: recommendation.id,
            updates: {
                status: status as any,
                councilResolutionNumber: councilResolution,
                notes: feedback,
                councilFeedbackAttachment: attachment
            }
        }));
        setEditMode(false);
        onClose();
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            setIsUploading(true);
            try {
                const file = event.target.files[0];
                const doc = await documentsAPI.upload(file, recommendation?.id, 'project', 'Admin'); // Linking to project type for now or create new type
                setAttachment({
                    url: doc.url,
                    name: doc.name,
                    uploadedAt: new Date().toISOString()
                });
            } catch (error) {
                console.error("Upload failed", error);
            } finally {
                setIsUploading(false);
            }
        }
    };

    if (!recommendation) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                Détails de la Recommandation
                {recommendation.sourceResolutionNumber && (
                    <Chip
                        label={`Extrait #${recommendation.sourceResolutionNumber}`}
                        size="small"
                        color="primary"
                        sx={{ ml: 2 }}
                    />
                )}
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" gutterBottom>{recommendation.projectName}</Typography>
                    <Typography variant="body1" paragraph>{recommendation.description}</Typography>

                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 6 }}>
                            <Typography variant="caption" color="textSecondary">Date CCE</Typography>
                            <Typography variant="body2">
                                {recommendation.meetingDate ? new Date(recommendation.meetingDate).toLocaleDateString() : 'N/A'}
                            </Typography>
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                            <Typography variant="caption" color="textSecondary">Date d'envoi</Typography>
                            <Typography variant="body2">{recommendation.dateSent}</Typography>
                        </Grid>
                    </Grid>

                    {recommendation.strategicLinks && recommendation.strategicLinks.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Liens Stratégiques:</Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {recommendation.strategicLinks.map((link, i) => (
                                    <Chip key={i} label={`${link.policyName} (${link.regulationArticle})`} size="small" variant="outlined" />
                                ))}
                            </Box>
                        </Box>
                    )}
                </Box>

                <Divider sx={{ my: 2 }} />

                <Typography variant="h6" gutterBottom>Suivi du Conseil</Typography>

                {!editMode ? (
                    <Box>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Typography variant="subtitle2">Statut Actuel</Typography>
                                <Chip
                                    label={getStatusLabel(recommendation.status)}
                                    color={getStatusColor(recommendation.status)}
                                    sx={{ mt: 0.5 }}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Typography variant="subtitle2">Résolution Conseil</Typography>
                                <Typography variant="body2">{recommendation.councilResolutionNumber || '-'}</Typography>
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <Typography variant="subtitle2">Retour du Caucus (PDF / Notes)</Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 1, borderRadius: 1, mb: 1 }}>
                                    {recommendation.notes || 'Aucune note.'}
                                </Typography>
                                {recommendation.councilFeedbackAttachment && (
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<AttachmentOutlined />}
                                        href={recommendation.councilFeedbackAttachment.url}
                                        target="_blank"
                                    >
                                        Voir Pièce Jointe: {recommendation.councilFeedbackAttachment.name}
                                    </Button>
                                )}
                            </Grid>
                        </Grid>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                        <FormControl fullWidth>
                            <InputLabel>Statut Décisionnel</InputLabel>
                            <Select
                                value={status}
                                label="Statut Décisionnel"
                                onChange={(e) => setStatus(e.target.value)}
                            >
                                <MenuItem value="pending">En attente</MenuItem>
                                <MenuItem value="accepted">Acceptée</MenuItem>
                                <MenuItem value="modified">Acceptée avec modifications</MenuItem>
                                <MenuItem value="deferred">Reportée</MenuItem>
                                <MenuItem value="rejected">Refusée</MenuItem>
                            </Select>
                        </FormControl>

                        <TextField
                            label="Numéro de Résolution (Conseil)"
                            value={councilResolution}
                            onChange={(e) => setCouncilResolution(e.target.value)}
                            fullWidth
                        />

                        <TextField
                            label="Retour du Caucus / Notes"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            multiline
                            rows={4}
                            fullWidth
                            helperText="Inscrivez ici les commentaires ou raisons de la décision."
                        />

                        <Box>
                            <Typography variant="subtitle2" gutterBottom>Pièce jointe (Retour du Caucus / PDF)</Typography>
                            {attachment ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Chip
                                        icon={<AttachmentOutlined />}
                                        label={attachment.name}
                                        onDelete={() => setAttachment(undefined)}
                                    />
                                </Box>
                            ) : (
                                <Button
                                    variant="outlined"
                                    component="label"
                                    startIcon={isUploading ? <CircularProgress size={20} /> : <CloudUpload />}
                                    disabled={isUploading}
                                >
                                    {isUploading ? 'Téléversement...' : 'Joindre un PDF'}
                                    <input
                                        type="file"
                                        hidden
                                        accept="application/pdf"
                                        onChange={handleFileUpload}
                                    />
                                </Button>
                            )}
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                {!editMode ? (
                    <>
                        <Button onClick={onClose}>Fermer</Button>
                        <Button variant="contained" onClick={() => setEditMode(true)}>Mettre à jour le statut</Button>
                    </>
                ) : (
                    <>
                        <Button onClick={() => setEditMode(false)}>Annuler</Button>
                        <Button variant="contained" onClick={handleSave} color="primary">Enregistrer</Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
};

// Helpers
const getStatusLabel = (status: string) => {
    switch (status) {
        case 'pending': return 'En attente';
        case 'accepted': return 'Acceptée';
        case 'rejected': return 'Refusée';
        case 'modified': return 'Modifiée';
        case 'deferred': return 'Reportée';
        default: return status;
    }
};

const getStatusColor = (status: string): any => {
    switch (status) {
        case 'accepted': return 'success';
        case 'rejected': return 'error';
        case 'modified': return 'warning';
        case 'deferred': return 'info';
        default: return 'default';
    }
};

export default RecommendationDetailsDialog;
