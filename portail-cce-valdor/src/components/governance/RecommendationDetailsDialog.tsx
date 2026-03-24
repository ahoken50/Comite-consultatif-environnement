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
    CircularProgress,
    Menu,
    ListItemIcon,
    ListItemText
} from '@mui/material';
import { AttachmentOutlined, CloudUpload, Print, Gavel, Campaign } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { updateRecommendation, fetchRecommendations } from '../../features/governance/governanceSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import type { RootState } from '../../store/rootReducer';
import { documentsAPI } from '../../features/documents/documentsAPI';
import { AccessControl } from '../../components/auth/AccessControl';
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
    const { items: projects } = useSelector((state: RootState) => state.projects || { items: [] });
    const { recommendations } = useSelector((state: RootState) => state.governance || { recommendations: [] });

    React.useEffect(() => {
        if (open) {
            if (projects.length === 0) dispatch(fetchProjects());
            if (recommendations.length === 0) dispatch(fetchRecommendations());
        }
    }, [open, dispatch, projects.length, recommendations.length]);

    const [editMode, setEditMode] = useState(false);
    const [status, setStatus] = useState<string>(recommendation?.status || '');
    const [projectName, setProjectName] = useState(recommendation?.projectName || '');
    const [agendaItemOrder, setAgendaItemOrder] = useState<number | ''>(recommendation?.sourceAgendaItemOrder ?? '');
    const [councilResolution, setCouncilResolution] = useState(recommendation?.councilResolutionNumber || '');
    const [feedback, setFeedback] = useState(recommendation?.notes || '');
    const [attachment, setAttachment] = useState<{ url: string, name: string, uploadedAt: string } | undefined>(recommendation?.councilFeedbackAttachment);
    const [attachments, setAttachments] = useState<{ url: string, name: string, uploadedAt: string, resolutionNumber?: string }[]>(recommendation?.attachments || []);
    const [isUploading, setIsUploading] = useState(false);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

    // PDF Options State
    const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);
    const [pdfOptions, setPdfOptions] = useState<{
        includeComments: boolean;
        selectedResolutions: number[];
    }>({
        includeComments: false,
        selectedResolutions: []
    });

    const handleSave = async () => {
        if (!recommendation) return;

        await dispatch(updateRecommendation({
            id: recommendation.id,
            updates: {
                status: status as any,
                projectName: projectName,
                sourceAgendaItemOrder: agendaItemOrder !== '' ? Number(agendaItemOrder) : undefined,
                councilResolutionNumber: councilResolution,
                notes: feedback,
                councilFeedbackAttachment: attachment,
                attachments: attachments
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

    const handleRecAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            setIsUploadingAttachment(true);
            try {
                const file = event.target.files[0];
                const doc = await documentsAPI.upload(file, recommendation?.id, 'project', 'Admin');
                const newAtt = {
                    url: doc.url,
                    name: doc.name,
                    uploadedAt: new Date().toISOString()
                };
                
                const updatedAttachments = [...attachments, newAtt];
                setAttachments(updatedAttachments);
                
                if (!editMode && recommendation) {
                    dispatch(updateRecommendation({
                        id: recommendation.id,
                        updates: { attachments: updatedAttachments }
                    }));
                }
            } catch (error) {
                console.error("Upload failed", error);
            } finally {
                setIsUploadingAttachment(false);
            }
        }
    };

    const removeRecAttachment = (index: number) => {
        const updatedAttachments = attachments.filter((_, i) => i !== index);
        setAttachments(updatedAttachments);
        
        if (!editMode && recommendation) {
            dispatch(updateRecommendation({
                id: recommendation.id,
                updates: { attachments: updatedAttachments }
            }));
        }
    };

    if (!recommendation) return null;

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const openMenu = Boolean(anchorEl);

    const handlePrintClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handlePrintClose = () => {
        setAnchorEl(null);
    };

    const handleOpenPdfDialog = () => {
        handlePrintClose();
        if (recommendation) {
            setPdfOptions({
                includeComments: !!recommendation.notes,
                selectedResolutions: recommendation.resolutions ? recommendation.resolutions.map((_, i) => i) : []
            });
            setIsPdfDialogOpen(true);
        }
    };

    const confirmPdfGeneration = async () => {
        if (recommendation) {
            let meetingForPdf = null;
            if (recommendation.meetingId) {
                try {
                    const { meetingsAPI } = await import('../../features/meetings/meetingsAPI');
                    meetingForPdf = await meetingsAPI.fetchById(recommendation.meetingId);
                } catch (e) {
                    console.error("Failed to fetch meeting for PDF", e);
                }
            }

            if (!meetingForPdf) {
                meetingForPdf = {
                    id: 'temp',
                    date: recommendation.meetingDate || new Date().toISOString(),
                    attendees: [],
                    type: 'regular',
                    status: 'completed',
                    location: 'Hôtel de Ville'
                } as any;
            }

            const filteredResolutions = recommendation.resolutions ? recommendation.resolutions.filter((r, i) => pdfOptions.selectedResolutions.includes(i) && r.text.trim().length > 0) : [];
            const combined = filteredResolutions.map(r => `[${r.number}] ${r.title}\n${r.text}`).join('\n\n---\n\n');
            const resolutionNumbersArray = filteredResolutions.map(r => r.number).filter(Boolean);
            const mergedNumbers = resolutionNumbersArray.length > 0 ? resolutionNumbersArray.join(', ') : 'PROJET';

            // Try to find the agenda item order number (for PDF title "Sujet X - ...")
            // Priority 1: manually saved value from dialog
            let resolvedOrder: number | undefined = recommendation.sourceAgendaItemOrder;
            // Priority 2: lookup by title in meeting agendaItems
            if (!resolvedOrder && meetingForPdf?.agendaItems) {
                const srcNum = recommendation.sourceResolutionNumber;
                const recTitle = (recommendation.projectName || '').toLowerCase().trim();
                const matchedItem = (meetingForPdf.agendaItems as any[]).find((item: any) => {
                    const itemTitle = (item.title || '').toLowerCase().trim();
                    return (
                        (recTitle && itemTitle && itemTitle === recTitle) ||
                        item.minuteNumber === srcNum ||
                        item.minuteEntries?.some((e: any) => e.number === srcNum) ||
                        filteredResolutions.some((r: any) => r.number === item.minuteNumber ||
                            item.minuteEntries?.some((e: any) => e.number === r.number))
                    );
                });
                if (matchedItem?.order !== undefined && matchedItem.order !== null) {
                    resolvedOrder = matchedItem.order;
                }
            }
            
            const dataToPrint = { 
                ...recommendation,
                projectName: projectName || recommendation.projectName,
                sourceResolutionNumber: mergedNumbers,
                sourceAgendaItemOrder: resolvedOrder,
                resolutions: filteredResolutions, 
                description: combined,
                notes: (pdfOptions.includeComments && recommendation.notes ? recommendation.notes : '').replace(/^\[?[cC]ommentaires?\]?\s*:\s*/gi, '').trim()
            };

            console.log('[PDF] dataToPrint:', { sourceAgendaItemOrder: dataToPrint.sourceAgendaItemOrder, projectName: dataToPrint.projectName, sourceResolutionNumber: dataToPrint.sourceResolutionNumber });

            const { generateResolutionPDF } = await import('../../services/pdfServiceResolution');
            await generateResolutionPDF(meetingForPdf as any, dataToPrint as CouncilRecommendation, 'recommendation', 'official');
            setIsPdfDialogOpen(false);
        }
    };

    const handleGeneratePdf = async (mode: 'official' | 'campaign') => {
        handlePrintClose();
        // Fallback for campaign mode
        if (recommendation) {
            let meetingForPdf = null;
            if (recommendation.meetingId) {
                try {
                    const { meetingsAPI } = await import('../../features/meetings/meetingsAPI');
                    meetingForPdf = await meetingsAPI.fetchById(recommendation.meetingId);
                } catch (e) {
                    console.error("Failed to fetch meeting for PDF", e);
                }
            }

            if (!meetingForPdf) {
                meetingForPdf = { id: 'temp', date: recommendation.meetingDate || new Date().toISOString(), attendees: [] } as any;
            }

            const { generateResolutionPDF } = await import('../../services/pdfServiceResolution');
            await generateResolutionPDF(meetingForPdf as any, recommendation, 'recommendation', mode);
        }
    };

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

                    {recommendation.linkedProjectIds && recommendation.linkedProjectIds.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Projets Liés:</Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {recommendation.linkedProjectIds.map((id) => {
                                    const proj = projects.find(p => p.id === id);
                                    return <Chip key={id} label={proj ? proj.name : id} size="small" variant="outlined" color="secondary" />;
                                })}
                            </Box>
                        </Box>
                    )}

                    {recommendation.linkedRecommendationIds && recommendation.linkedRecommendationIds.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Recommandations / Résolutions antérieures:</Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {recommendation.linkedRecommendationIds.map((id) => {
                                    const rec = recommendations.find(r => r.id === id);
                                    return <Chip key={id} label={rec ? rec.projectName : id} size="small" variant="outlined" color="secondary" />;
                                })}
                            </Box>
                        </Box>
                    )}

                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>Pièces Jointes / Annexes:</Typography>
                        {attachments.length > 0 && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                                {attachments.map((att, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 1, border: '1px solid #eee', borderRadius: 1 }}>
                                        <Chip 
                                            icon={<AttachmentOutlined />}
                                            label={att.name} 
                                            component="a" 
                                            href={att.url} 
                                            target="_blank" 
                                            clickable 
                                            color="primary" 
                                            variant="outlined"
                                            onDelete={() => removeRecAttachment(i)}
                                        />
                                        {recommendation.resolutions && recommendation.resolutions.length > 0 && (
                                            <FormControl size="small" sx={{ minWidth: 200 }}>
                                                <Select
                                                    displayEmpty
                                                    value={att.resolutionNumber || ''}
                                                    onChange={(e) => {
                                                        const newAtts = [...attachments];
                                                        newAtts[i] = { ...newAtts[i], resolutionNumber: e.target.value as string };
                                                        setAttachments(newAtts);
                                                        
                                                        // Auto-save resolution link if not in edit mode
                                                        if (!editMode && recommendation) {
                                                            dispatch(updateRecommendation({
                                                                id: recommendation.id,
                                                                updates: { attachments: newAtts }
                                                            }));
                                                        }
                                                    }}
                                                >
                                                    <MenuItem value="">
                                                        <em>Globale (non lié)</em>
                                                    </MenuItem>
                                                    {recommendation.resolutions.map((r, rIdx) => (
                                                        <MenuItem key={rIdx} value={r.number || `temp-${rIdx}`}>
                                                            {r.number ? `RÉSOLUTION ${r.number}` : `Résolution #${rIdx + 1}`}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        )}
                        <AccessControl allowedRoles={['coordinator']}>
                            <Button
                                variant="outlined"
                                component="label"
                                size="small"
                                startIcon={isUploadingAttachment ? <CircularProgress size={20} /> : <CloudUpload />}
                                disabled={isUploadingAttachment}
                                sx={{ mt: 1 }}
                            >
                                {isUploadingAttachment ? 'Téléversement...' : 'Joindre un fichier (Annexe)'}
                                <input
                                    type="file"
                                    hidden
                                    accept="image/*,application/pdf"
                                    onChange={handleRecAttachmentUpload}
                                />
                            </Button>
                        </AccessControl>
                    </Box>
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
                    <Box>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle1" fontWeight="bold">Détails du retour du conseil</Typography>

                        <TextField
                            label="Titre / Nom du sujet"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            fullWidth
                            helperText="Modifiez le titre du sujet tel qu'il apparaîtra dans le PDF."
                            sx={{ mb: 2 }}
                        />

                        <TextField
                            label="N° à l'ordre du jour (ODJ)"
                            type="number"
                            value={agendaItemOrder}
                            onChange={(e) => setAgendaItemOrder(e.target.value === '' ? '' : Number(e.target.value))}
                            fullWidth
                            helperText="Entrez le numéro du sujet à l'ODJ (ex: 6). S'affichera comme 'Sujet 6 - ...' dans le PDF."
                            inputProps={{ min: 1 }}
                            sx={{ mb: 2 }}
                        />

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
                <Button
                    id="print-button"
                    aria-controls={openMenu ? 'print-menu' : undefined}
                    aria-haspopup="true"
                    aria-expanded={openMenu ? 'true' : undefined}
                    onClick={handlePrintClick}
                    startIcon={<Print />}
                >
                    Imprimer / PDF
                </Button>
                <Menu
                    id="print-menu"
                    anchorEl={anchorEl}
                    open={openMenu}
                    onClose={handlePrintClose}
                    MenuListProps={{
                        'aria-labelledby': 'print-button',
                    }}
                >
                    <MenuItem onClick={() => handleOpenPdfDialog()}>
                        <ListItemIcon><Gavel fontSize="small" /></ListItemIcon>
                        <ListItemText>Extrait Officiel (Strict)</ListItemText>
                    </MenuItem>
                    <MenuItem onClick={() => handleGeneratePdf('campaign')}>
                        <ListItemIcon><Campaign fontSize="small" /></ListItemIcon>
                        <ListItemText>Présentation Projet (Argumentaire)</ListItemText>
                    </MenuItem>
                </Menu>

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

            {/* PDF Options Dialog */}
            <Dialog open={isPdfDialogOpen} onClose={() => setIsPdfDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Paramètres d'extraction PDF</DialogTitle>
                <DialogContent dividers>
                    {(!recommendation?.resolutions || recommendation.resolutions.length === 0) ? (
                        <Typography variant="body1">
                            Aucune résolution n'est attachée à cet extrait pour la configuration avancée.
                        </Typography>
                    ) : (
                        <>
                            <Typography variant="subtitle2" gutterBottom color="text.secondary">
                                Sélectionnez les résolutions à inclure dans l'extrait :
                            </Typography>
                            <Box sx={{ pt: 0 }}>
                                {recommendation.resolutions.filter(r => r.text.trim().length > 0).map((res, idx) => (
                                    <Box key={idx} sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
                                        <input
                                            type="checkbox"
                                            checked={pdfOptions.selectedResolutions.includes(idx)}
                                            onChange={() => {
                                                setPdfOptions(prev => {
                                                    const isSelected = prev.selectedResolutions.includes(idx);
                                                    return {
                                                        ...prev,
                                                        selectedResolutions: isSelected 
                                                            ? prev.selectedResolutions.filter(i => i !== idx)
                                                            : [...prev.selectedResolutions, idx]
                                                    };
                                                });
                                            }}
                                            style={{ marginTop: 5, marginRight: 10, transform: 'scale(1.2)' }}
                                        />
                                        <Box>
                                            <Typography variant="body1">RÉSOLUTION {res.number || '---'}</Typography>
                                            <Typography variant="body2" color="textSecondary">{res.title || 'Sans titre'}</Typography>
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}

                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed #e0e0e0', display: 'flex', alignItems: 'center' }}>
                        <input
                            type="checkbox"
                            checked={pdfOptions.includeComments}
                            onChange={(e) => setPdfOptions(prev => ({ ...prev, includeComments: e.target.checked }))}
                            style={{ marginRight: 10, transform: 'scale(1.2)' }}
                        />
                        <Typography>Inclure les Commentaires / Contexte du PV dans le PDF</Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsPdfDialogOpen(false)}>Annuler</Button>
                    <Button 
                        onClick={confirmPdfGeneration} 
                        variant="contained" 
                        color="secondary"
                        disabled={recommendation?.resolutions && recommendation.resolutions.length > 0 && pdfOptions.selectedResolutions.length === 0}
                    >
                        Générer PDF
                    </Button>
                </DialogActions>
            </Dialog>
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
