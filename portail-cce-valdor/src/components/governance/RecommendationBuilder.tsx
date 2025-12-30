import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    Stepper,
    Step,
    StepLabel,
    Button,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    Alert,
    Chip,
    Divider,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    List,
    ListItemText,
    ListItemButton
} from '@mui/material';
import { Add, Delete, RecordVoiceOver, Download, FileDownload } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { addRecommendation } from '../../features/governance/governanceSlice';
import { generateSpeakingPoints } from '../../services/geminiService';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import type { CouncilRecommendation } from '../../types/recommendation.types';
import type { Meeting, AgendaItem } from '../../types/meeting.types';
import { useNavigate } from 'react-router-dom';
import { generateResolutionPDF } from '../../services/pdfServiceResolution';

const steps = ['Détails de base', 'Considérants & Analyse', 'Liaisons Stratégiques', 'Révision'];

interface RecommendationBuilderProps {
    onClose?: () => void;
}

const RecommendationBuilder: React.FC<RecommendationBuilderProps> = ({ onClose }) => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const [activeStep, setActiveStep] = useState(0);

    // Import State
    const [importOpen, setImportOpen] = useState(false);
    const [selectedMeetingId, setSelectedMeetingId] = useState<string>('');
    const { items: meetings } = useSelector((state: RootState) => state.meetings);

    useEffect(() => {
        if (importOpen && meetings.length === 0) {
            dispatch(fetchMeetings());
        }
    }, [importOpen, dispatch, meetings.length]);

    // Form State
    const [formData, setFormData] = useState<Partial<CouncilRecommendation>>({
        status: 'pending',
        dateSent: new Date().toISOString().split('T')[0],
        impactAnalysis: {
            financial: '',
            social: 'medium',
            implementationEffort: 'medium',
            environmentalImpact: 'positive'
        },
        strategicLinks: []
    });

    const [considerants, setConsiderants] = useState<string[]>(['']);
    const [newLink, setNewLink] = useState({ policyName: '', regulationArticle: '' });

    // Helper to extract keywords for considerants from text
    const extractConsiderants = (text: string) => {
        if (!text) return [''];

        // Try to split by "CONSIDÉRANT QUE" or similar patterns
        const regex = /(?:CONSID[ÉE]RANT|ATTENDU)(?:\s+QUE)?\s+((?:(?!CONSID[ÉE]RANT|ATTENDU|IL EST R[ÉE]SOLU).)+)/gi;
        const matches = [...text.matchAll(regex)];

        if (matches.length > 0) {
            return matches.map(m => m[1].trim());
        }

        return ['']; // Return empty if no clear structure found
    };

    const handleImportSelection = (meeting: Meeting, item: AgendaItem) => {
        // Extract resolution info
        const resolutionEntry = item.minuteEntries?.find(e => e.type === 'resolution');

        // Use resolution content if available, otherwise decision, otherwise description
        const rawContent = resolutionEntry?.content || item.decision || item.description || '';
        const resolutionNumber = resolutionEntry?.number || item.minuteNumber || '';

        // Extract title
        const title = item.title;

        // Extract considerants (rudimentary)
        // If content has "CONSIDÉRANT", we might want to parse it better, 
        // but for now let's just put the whole text in description and maybe try to split it
        const extractedConsiderants = extractConsiderants(rawContent);

        // Remove considerants from description for cleaner view?
        // Ideally description is "IL EST RÉSOLU..." part.
        let mainDescription = rawContent;
        const resoluMatch = rawContent.match(/IL EST R[ÉE]SOLU\s*:?\s*(.*)/i);
        if (resoluMatch) {
            mainDescription = resoluMatch[1].trim();
        }

        setFormData(prev => ({
            ...prev,
            projectName: title,
            meetingId: meeting.id,
            meetingDate: meeting.date,
            sourceResolutionNumber: resolutionNumber,
            sourceResolutionContent: rawContent,
            description: mainDescription
        }));

        if (extractedConsiderants.length > 0 && extractedConsiderants[0] !== '') {
            setConsiderants(extractedConsiderants);
        }

        setSelectedMeetingId('');
        setImportOpen(false);
    };

    const handleNext = () => setActiveStep((prev) => prev + 1);
    const handleBack = () => setActiveStep((prev) => prev - 1);

    const handleSubmit = async () => {
        try {
            const finalData = {
                ...formData,
                description: `${formData.description || ''}\n\nCONSIDÉRANTS:\n${considerants.map(c => `- ${c}`).join('\n')}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: 'user-id-placeholder'
            } as Omit<CouncilRecommendation, 'id'>;

            await dispatch(addRecommendation(finalData)).unwrap();
            if (onClose) onClose();
            else navigate('/governance');
        } catch (error) {
            console.error('Failed to create recommendation:', error);
        }
    };

    const handleConsiderantChange = (index: number, value: string) => {
        const newConsiderants = [...considerants];
        newConsiderants[index] = value;
        setConsiderants(newConsiderants);
    };

    const addConsiderant = () => setConsiderants([...considerants, '']);
    const removeConsiderant = (index: number) => {
        const newConsiderants = considerants.filter((_, i) => i !== index);
        setConsiderants(newConsiderants);
    };

    const addStrategicLink = () => {
        if (newLink.policyName) {
            setFormData(prev => ({
                ...prev,
                strategicLinks: [...(prev.strategicLinks || []), { ...newLink }]
            }));
            setNewLink({ policyName: '', regulationArticle: '' });
        }
    };

    const handleGenerateExtractPDF = async () => {
        // Create a temporary object linking the current form data to a "meeting" structure
        // Since we might not have the full meeting object here if it wasn't imported or if we are just creating from scratch
        // We'll do a "best effort" using the imported meeting info if available

        let meetingContext: Meeting | undefined;
        if (formData.meetingId) {
            meetingContext = meetings.find(m => m.id === formData.meetingId);
            if (!meetingContext) {
                // Try to fetch or just stub it?
                // For now, if missing, we can stub meaningful parts
                meetingContext = {
                    id: formData.meetingId,
                    date: formData.meetingDate || new Date().toISOString(),
                    title: 'Réunion CCE (Référence)',
                    type: 'regular',
                    status: 'completed',
                    agendaItems: [],
                    attendees: [] // Signatures might be missing if meeting not found
                } as any;
            }
        } else {
            alert("Veuillez lier une réunion (Import) pour générer l'extrait officiel.");
            return;
        }

        if (meetingContext) {
            await generateResolutionPDF(meetingContext, formData as CouncilRecommendation, 'recommendation');
        }
    };

    const renderStepContent = (step: number) => {
        switch (step) {
            case 0:
                return (
                    <Box sx={{ mt: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={<Download />}
                            onClick={() => setImportOpen(true)}
                            sx={{ mb: 2, width: '100%' }}
                        >
                            Importer d'un Procès-Verbal Existant
                        </Button>

                        {formData.sourceResolutionNumber && (
                            <Alert severity="success" sx={{ mb: 2 }}>
                                Lié à la résolution {formData.sourceResolutionNumber} (Réunion du {formData.meetingDate?.split('T')[0]})
                            </Alert>
                        )}

                        <TextField
                            fullWidth
                            label="Titre / Sujet"
                            value={formData.projectName || ''}
                            onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                            margin="normal"
                        />
                        <TextField
                            fullWidth
                            type="date"
                            label="Date d'envoi cible"
                            InputLabelProps={{ shrink: true }}
                            value={formData.dateSent}
                            onChange={(e) => setFormData({ ...formData, dateSent: e.target.value })}
                            margin="normal"
                        />
                        <TextField
                            fullWidth
                            multiline
                            rows={4}
                            label="Description / Résolution proposée"
                            value={formData.description || ''}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            margin="normal"
                            helperText="Le texte principal de la recommandation (Il est résolu de...)"
                        />
                    </Box>
                );
            case 1:
                return (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle1" gutterBottom>Considérants (Le "Pourquoi")</Typography>
                        {considerants.map((cons, index) => (
                            <Box key={index} sx={{ display: 'flex', gap: 1, mb: 2 }}>
                                <TextField
                                    fullWidth
                                    label={`Considérant #${index + 1}`}
                                    value={cons}
                                    onChange={(e) => handleConsiderantChange(index, e.target.value)}
                                    size="small"
                                />
                                <IconButton onClick={() => removeConsiderant(index)} color="error">
                                    <Delete />
                                </IconButton>
                            </Box>
                        ))}
                        <Button startIcon={<Add />} onClick={addConsiderant} size="small">
                            Ajouter un considérant
                        </Button>

                        <Divider sx={{ my: 3 }} />

                        <Typography variant="subtitle1" gutterBottom>Analyse d'impact</Typography>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Impact Environnemental</InputLabel>
                                    <Select
                                        value={formData.impactAnalysis?.environmentalImpact || 'neutral'}
                                        label="Impact Environnemental"
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            impactAnalysis: { ...formData.impactAnalysis!, environmentalImpact: e.target.value as any }
                                        })}
                                    >
                                        <MenuItem value="positive">Positif</MenuItem>
                                        <MenuItem value="neutral">Neutre</MenuItem>
                                        <MenuItem value="negative">Négatif</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Effort de Mise en œuvre</InputLabel>
                                    <Select
                                        value={formData.impactAnalysis?.implementationEffort || 'medium'}
                                        label="Effort de Mise en œuvre"
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            impactAnalysis: { ...formData.impactAnalysis!, implementationEffort: e.target.value as any }
                                        })}
                                    >
                                        <MenuItem value="low">Faible</MenuItem>
                                        <MenuItem value="medium">Moyen</MenuItem>
                                        <MenuItem value="high">Élevé</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    fullWidth
                                    label="Impact Financier (Estimation)"
                                    placeholder="Ex: 5 000 $ - Budget de fonctionnement"
                                    value={formData.impactAnalysis?.financial || ''}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        impactAnalysis: { ...formData.impactAnalysis!, financial: e.target.value }
                                    })}
                                    size="small"
                                />
                            </Grid>
                        </Grid>
                    </Box>
                );
            case 2:
                return (
                    <Box sx={{ mt: 2 }}>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Liez cette recommandation aux politiques existantes pour renforcer son poids décisionnel.
                        </Alert>

                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 3 }}>
                            <TextField
                                label="Politique / Règlement"
                                value={newLink.policyName}
                                onChange={(e) => setNewLink({ ...newLink, policyName: e.target.value })}
                                size="small"
                                sx={{ flexGrow: 1 }}
                            />
                            <TextField
                                label="Article / Section"
                                value={newLink.regulationArticle}
                                onChange={(e) => setNewLink({ ...newLink, regulationArticle: e.target.value })}
                                size="small"
                                sx={{ width: '150px' }}
                            />
                            <Button variant="contained" onClick={addStrategicLink} disabled={!newLink.policyName}>
                                Ajouter
                            </Button>
                        </Box>

                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {formData.strategicLinks?.map((link, idx) => (
                                <Chip
                                    key={idx}
                                    label={`${link.policyName} ${link.regulationArticle ? `(${link.regulationArticle})` : ''}`}
                                    onDelete={() => {
                                        const newLinks = [...(formData.strategicLinks || [])];
                                        newLinks.splice(idx, 1);
                                        setFormData({ ...formData, strategicLinks: newLinks });
                                    }}
                                />
                            ))}
                        </Box>
                    </Box>
                );
            case 3:
                return (
                    <Box sx={{ mt: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6" gutterBottom>{formData.projectName}</Typography>
                            {formData.meetingId && (
                                <Button
                                    variant="outlined"
                                    color="secondary"
                                    startIcon={<FileDownload />}
                                    onClick={handleGenerateExtractPDF}
                                >
                                    Extraire PDF Officiel
                                </Button>
                            )}
                        </Box>

                        <Typography variant="body1" paragraph>{formData.description}</Typography>

                        <Typography variant="subtitle2" color="primary">Considérants:</Typography>
                        <ul>
                            {considerants.filter(c => c).map((c, i) => <li key={i}>{c}</li>)}
                        </ul>

                        <Typography variant="subtitle2" color="primary">Impacts:</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                            <Chip label={`Env: ${formData.impactAnalysis?.environmentalImpact}`} size="small" />
                            <Chip label={`Coût: ${formData.impactAnalysis?.financial || 'N/A'}`} size="small" />
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                            <Button
                                variant="outlined"
                                startIcon={<RecordVoiceOver />}
                                size="small"
                                onClick={async () => {
                                    const tempRec = {
                                        ...formData,
                                        description: `${formData.description || ''}\n\nCONSIDÉRANTS:\n${considerants.map(c => `- ${c}`).join('\n')}`
                                    };
                                    const result = await generateSpeakingPoints(tempRec);
                                    if (result.success && result.speakingPoints) {
                                        setFormData(prev => ({ ...prev, notes: result.speakingPoints }));
                                    }
                                }}
                            >
                                Générer Points de Discussion (IA)
                            </Button>
                        </Box>

                        {formData.notes && (
                            <Paper sx={{ p: 2, bgcolor: 'grey.50' }} variant="outlined">
                                <Typography variant="subtitle2" gutterBottom>Points de discussion suggérés :</Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{formData.notes}</Typography>
                            </Paper>
                        )}
                    </Box>
                );
            default:
                return "Unknown step";
        }
    };

    return (
        <Paper sx={{ p: 4, maxWidth: 800, mx: 'auto', my: 4 }}>
            <Typography variant="h5" gutterBottom align="center">
                Créateur de Recommandation
            </Typography>

            <Stepper activeStep={activeStep} alternativeLabel>
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <Box sx={{ minHeight: 400, py: 2 }}>
                {renderStepContent(activeStep)}
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
                <Button disabled={activeStep === 0} onClick={handleBack}>
                    Précédent
                </Button>
                {activeStep === steps.length - 1 ? (
                    <Button variant="contained" onClick={handleSubmit} color="primary">
                        Créer la Recommandation
                    </Button>
                ) : (
                    <Button variant="contained" onClick={handleNext}>
                        Suivant
                    </Button>
                )}
            </Box>

            {/* Impot Dialog */}
            <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Importer d'un Procès-Verbal</DialogTitle>
                <DialogContent>
                    {!selectedMeetingId ? (
                        <List>
                            {meetings
                                .filter(m => m.minutes || (m.agendaItems && m.agendaItems.some(i => i.decision))) // Filter meetings with content
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                .map(meeting => (
                                    <ListItemButton key={meeting.id} onClick={() => setSelectedMeetingId(meeting.id)}>
                                        <ListItemText
                                            primary={meeting.title}
                                            secondary={new Date(meeting.date).toLocaleDateString()}
                                        />
                                    </ListItemButton>
                                ))
                            }
                            {meetings.length === 0 && <Typography sx={{ p: 2 }}>Aucune réunion disponible.</Typography>}
                        </List>
                    ) : (
                        <Box>
                            <Button onClick={() => setSelectedMeetingId('')} sx={{ mb: 2 }}>Retour aux réunions</Button>
                            <Typography variant="subtitle2" gutterBottom>Sélectionnez une résolution :</Typography>
                            <List>
                                {meetings.find(m => m.id === selectedMeetingId)?.agendaItems
                                    ?.filter(i => i.decision || i.minuteEntries?.length) // Show mostly resolved items
                                    .map(item => (
                                        <ListItemButton key={item.id} onClick={() => handleImportSelection(meetings.find(m => m.id === selectedMeetingId)!, item)}>
                                            <ListItemText
                                                primary={item.title}
                                                secondary={item.minuteNumber ? `Résolution: ${item.minuteNumber}` : (item.decision ? 'Décision prise' : 'Point')}
                                            />
                                        </ListItemButton>
                                    ))
                                }
                            </List>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setImportOpen(false)}>Annuler</Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default RecommendationBuilder;
