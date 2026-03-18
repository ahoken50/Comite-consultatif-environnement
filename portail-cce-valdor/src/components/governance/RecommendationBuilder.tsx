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
    ListItemButton,
    Card,
    CardContent,
    ListItem,
    ListItemIcon,
    CircularProgress,
    Checkbox,
    FormControlLabel
} from '@mui/material';
import {
    Add,
    Delete,
    RecordVoiceOver,
    FileDownload,
    Psychology,
    CheckCircle,
    Warning,
    Info,
    Gavel
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { addRecommendation } from '../../features/governance/governanceSlice';
import { generateSpeakingPoints, analyzePVStructure, verifyPVClaims, draftAIRecommendations } from '../../services/geminiService';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import type { CouncilRecommendation } from '../../types/recommendation.types';
import type { Meeting, AgendaItem } from '../../types/meeting.types';
import { useNavigate } from 'react-router-dom';
import { generateResolutionPDF } from '../../services/pdfServiceResolution';
import type { PVStructure, VerificationResult, DraftRecommendation } from '../../types/ai-workflow.types';
import { useToast } from '../../hooks/useToast';

const steps = ['Détails de base', 'Considérants & Analyse', 'Liaisons Stratégiques', 'Révision'];

export interface RecommendationInitialData {
    meetingId: string;
    meetingDate: string;
    sourceResolutionNumber: string;
    sourceResolutionContent: string;
    projectName: string;
    description: string;
    notes?: string;
    resolutions?: { number: string; title: string; text: string; }[];
    considerants?: string[];
}

interface RecommendationBuilderProps {
    onClose?: () => void;
    initialData?: RecommendationInitialData | null;
}

const RecommendationBuilder: React.FC<RecommendationBuilderProps> = ({ onClose, initialData }) => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { showWarning } = useToast();
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

    // Structured Resolutions State
    const [resolutions, setResolutions] = useState<{ number: string; title: string; text: string; }[]>([
        { number: '', title: '', text: '' }
    ]);
    const [selectedDraftRecs, setSelectedDraftRecs] = useState<Set<string>>(new Set());

    // Handle Initial Data (Link from Resolution)
    useEffect(() => {
        if (initialData) {
            setFormData(prev => ({
                ...prev,
                projectName: initialData.projectName,
                meetingId: initialData.meetingId,
                meetingDate: initialData.meetingDate,
                sourceResolutionNumber: initialData.sourceResolutionNumber,
                sourceResolutionContent: initialData.sourceResolutionContent,
                description: initialData.description,
                notes: initialData.notes
            }));

            if (initialData.resolutions && initialData.resolutions.length > 0) {
                setResolutions(initialData.resolutions);
            } else if (initialData.description) {
                setResolutions([{ number: initialData.sourceResolutionNumber || '', title: initialData.projectName || '', text: initialData.description }]);
            }

            if (initialData.considerants && initialData.considerants.length > 0) {
                setConsiderants(initialData.considerants);
            }
        }
    }, [initialData]);

    // AI Workflow State
    const [aiWizardOpen, setAiWizardOpen] = useState(false);
    const [aiStep, setAiStep] = useState(0); // 0: Input, 1: Structure, 2: Verification, 3: Recommendation
    const [aiLoading, setAiLoading] = useState(false);
    const [pvText, setPvText] = useState('');
    const [structureData, setStructureData] = useState<PVStructure | null>(null);
    const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
    const [draftedRecommendations, setDraftedRecommendations] = useState<DraftRecommendation[]>([]);
    const [aiError, setAiError] = useState<string | null>(null);

    // Helper to extract keywords for considerants from text
    const extractConsiderants = (text: string) => {
        if (!text) return [''];
        const regex = /(?:CONSID[ÉE]RANT|ATTENDU)(?:\s+QUE)?\s+((?:(?!CONSID[ÉE]RANT|ATTENDU|IL EST R[ÉE]SOLU).)+)/gi;
        const matches = [...text.matchAll(regex)];
        if (matches.length > 0) {
            return matches.map(m => m[1].trim());
        }
        return [''];
    };

    // Helper to format meeting into text for AI
    const formatMeetingForAI = (meeting: Meeting): string => {
        let text = `PROCÈS-VERBAL: ${meeting.title || 'Sans titre'}\n`;
        text += `DATE: ${new Date(meeting.date).toLocaleDateString()}\n\n`;

        // Removed globalNotes check as it does not exist on Meeting type

        meeting.agendaItems?.forEach(item => {
            text += `POINT ${item.order}: ${item.title}\n`;
            if (item.description) text += `  DESCRIPTION: ${item.description}\n`;
            item.minuteEntries?.forEach(entry => {
                const typeLabel = entry.type === 'resolution' ? 'RÉSOLUTION' : 'COMMENTAIRE';
                text += `  [${typeLabel}] ${entry.content}\n`;
                if (entry.type === 'resolution' && entry.number) {
                    text += `  (No. Résolution: ${entry.number})\n`;
                }
            });
            if (item.decision) text += `  DÉCISION: ${item.decision}\n`;
            text += '\n';
        });
        return text;
    };

    // AI Workflow Handlers
    const handleAnalyze = async () => {
        if (!pvText.trim()) return;
        setAiLoading(true);
        setAiError(null);
        try {
            const result = await analyzePVStructure(pvText);
            if (result.success && result.data) {
                setStructureData(result.data);
                setAiStep(1);
            } else {
                setAiError(result.error || 'Erreur lors de l\'analyse');
            }
        } catch (e) {
            setAiError('Erreur inattendue');
        } finally {
            setAiLoading(false);
        }
    };

    const handleVerifySchema = async () => {
        if (!structureData) return;
        setAiLoading(true);
        setAiError(null);
        try {
            const result = await verifyPVClaims(structureData.laws, structureData.deadlines);
            if (result.success && result.results) {
                setVerificationResults(result.results);
                setAiStep(2);
            } else {
                setAiError(result.error || 'Erreur de vérification');
            }
        } catch (e) {
            setAiError('Erreur inattendue');
        } finally {
            setAiLoading(false);
        }
    };

    const handleDraftRecs = async () => {
        if (!structureData) return;
        setAiLoading(true);
        setAiError(null);
        try {
            const result = await draftAIRecommendations(structureData, verificationResults);
            if (result.success && result.recommendations) {
                setDraftedRecommendations(result.recommendations);
                setAiStep(3);
            } else {
                setAiError(result.error || 'Erreur de rédaction');
            }
        } catch (e) {
            setAiError('Erreur inattendue');
        } finally {
            setAiLoading(false);
        }
    };

    const toggleDraftRec = (id: string, title?: string) => {
        const identifier = id || title || '';
        const newSet = new Set(selectedDraftRecs);
        if (newSet.has(identifier)) newSet.delete(identifier);
        else newSet.add(identifier);
        setSelectedDraftRecs(newSet);
    };

    const applySelectedRecommendations = () => {
        const selected = draftedRecommendations.filter(r => selectedDraftRecs.has(r.id || r.title));
        if (selected.length === 0) return;
        
        setFormData(prev => ({
            ...prev,
            projectName: prev.projectName || selected[0].title,
            priority: selected[0].priority === 'Haute' ? 'high' : selected[0].priority === 'Moyenne' ? 'medium' : 'low',
            // Store the rationale dynamically in the notes
            notes: selected.map(r => `[Commentaire / RATIONALE IA]:\n${r.rationale || r.title}`).join('\n\n')
        }));
        
        const newResolutions = selected.flatMap(r => {
            if (r.resolutions && r.resolutions.length > 0) {
                return r.resolutions.map((res: any) => ({
                    number: res.number || r.sourceResolutionNumber || '',
                    title: res.title || r.title || '',
                    text: res.text || ''
                }));
            }
            // Fallback if AI didn't return structured resolutions
            return [{
                number: r.sourceResolutionNumber || '',
                title: r.title || '',
                text: r.description || ''
            }];
        });
        
        if (resolutions.length === 1 && resolutions[0].text.trim() === '') {
            setResolutions(newResolutions);
        } else {
            setResolutions([...resolutions, ...newResolutions]);
        }
        
        setAiWizardOpen(false);
        setAiStep(0);
        setPvText('');
        setSelectedDraftRecs(new Set());
    };

    const handleImportSelection = (meeting: Meeting, item: AgendaItem) => {
        const newResolutions: { number: string; title: string; text: string; }[] = [];
        const title = item.title;
        let mainContent = '';
        let unnumberedComments: string[] = [];

        if (item.minuteEntries && item.minuteEntries.length > 0) {
            item.minuteEntries.forEach(entry => {
                if (entry.type === 'resolution' || entry.type === 'comment') {
                    if (entry.number || entry.type === 'resolution') {
                        // Create a specific boxed resolution for numbered entries or any formal resolution
                        newResolutions.push({
                            number: entry.number || item.minuteNumber || '',
                            title: title, 
                            text: entry.content
                        });
                        if (entry.type === 'resolution' && !mainContent) {
                            mainContent = entry.content; // Tracks the primary content
                        }
                    } else {
                        // Comment without a number goes into notes
                        unnumberedComments.push(entry.content);
                    }
                }
            });
        }
        
        // Fallback for legacy items without explicit minuteEntries
        if (newResolutions.length === 0) {
            const rawContent = item.decision || item.description || '';
            if (rawContent) {
                newResolutions.push({
                    number: item.minuteNumber || '',
                    title: title,
                    text: rawContent
                });
                mainContent = rawContent;
            }
        }

        const extractedConsiderants = extractConsiderants(mainContent || newResolutions[0]?.text || '');

        setFormData(prev => ({
            ...prev,
            projectName: title,
            meetingId: meeting.id,
            meetingDate: meeting.date,
            sourceResolutionNumber: newResolutions[0]?.number || item.minuteNumber || '',
            sourceResolutionContent: mainContent || newResolutions[0]?.text || '',
            description: mainContent || newResolutions[0]?.text || '',
            notes: unnumberedComments.length > 0 ? `[Commentaires du PV]:\n${unnumberedComments.join('\n\n')}` : ''
        }));

        if (newResolutions.length > 0) {
            setResolutions(newResolutions);
        }

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
            const combinedDescription = resolutions
                .filter(r => r.text.trim().length > 0)
                .map(r => `[${r.number}] ${r.title}\n${r.text}`)
                .join('\n\n---\n\n');

            const finalData = {
                ...formData,
                resolutions: resolutions.filter(r => r.text.trim().length > 0),
                description: `${combinedDescription}\n\nCONSIDÉRANTS:\n${considerants.map(c => `- ${c}`).join('\n')}`,
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
        let meetingContext: Meeting | undefined;
        if (formData.meetingId) {
            meetingContext = meetings.find(m => m.id === formData.meetingId);
            if (!meetingContext) {
                meetingContext = {
                    id: formData.meetingId,
                    date: formData.meetingDate || new Date().toISOString(),
                    title: 'Réunion CCE (Référence)',
                    type: 'regular',
                    status: 'completed',
                    agendaItems: [],
                    attendees: []
                } as any;
            }
        } else {
            showWarning("Veuillez lier une réunion (Import) pour générer l'extrait officiel.");
            return;
        }
        if (meetingContext) {
            const combined = resolutions.filter(r => r.text.trim().length > 0).map(r => `[${r.number}] ${r.title}\n${r.text}`).join('\n\n---\n\n');
            const dataToPrint = { ...formData, resolutions: resolutions.filter(r => r.text.trim().length > 0), description: combined };
            await generateResolutionPDF(meetingContext, dataToPrint as CouncilRecommendation, 'recommendation');
        }
    };

    const renderAiStep = () => {
        switch (aiStep) {
            case 0:
                return (
                    <Box sx={{ p: 2 }}>
                        <Typography variant="body2" gutterBottom>
                            Sélectionnez un Procès-Verbal existant pour démarrer l'analyse.
                        </Typography>
                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>Choisir un Procès-Verbal</InputLabel>
                            <Select
                                label="Choisir un Procès-Verbal"
                                value={selectedMeetingId}
                                onChange={(e) => {
                                    const mId = e.target.value;
                                    setSelectedMeetingId(mId);
                                    const meeting = meetings.find(m => m.id === mId);
                                    if (meeting) {
                                        setPvText(formatMeetingForAI(meeting));
                                    }
                                }}
                            >
                                {meetings
                                    .filter(m => m.minutes || (m.agendaItems && m.agendaItems.length > 0))
                                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                    .map(meeting => (
                                        <MenuItem key={meeting.id} value={meeting.id}>
                                            {new Date(meeting.date).toLocaleDateString()} - {meeting.title}
                                        </MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                        {pvText && (
                            <>
                                <Typography variant="caption" color="textSecondary">Aperçu du texte extrait :</Typography>
                                <Paper variant="outlined" sx={{ p: 1, maxHeight: 150, overflow: 'auto', bgcolor: '#f5f5f5', mb: 2 }}>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '11px' }}>{pvText.substring(0, 500)}...</pre>
                                </Paper>
                            </>
                        )}
                        <Button
                            variant="contained"
                            onClick={handleAnalyze}
                            disabled={aiLoading || !pvText.trim()}
                            startIcon={aiLoading ? <CircularProgress size={20} /> : <Psychology />}
                            fullWidth
                        >
                            {aiLoading ? 'Analyse en cours...' : 'Lancer l\'Analyse Automatique'}
                        </Button>
                    </Box>
                );
            case 1:
                return (
                    <Box sx={{ p: 2 }}>
                        <Typography variant="h6" gutterBottom>Structure Identifiée</Typography>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Vérifiez que les données extraites sont correctes avant de procéder à la vérification normative.
                        </Alert>
                        {structureData && (
                            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                                <Typography variant="subtitle2">Résumé:</Typography>
                                <Typography paragraph variant="body2">{structureData.summary}</Typography>

                                <Divider sx={{ my: 1 }} />
                                <Typography variant="subtitle2">Résolutions ({structureData.resolutions.length}):</Typography>
                                <List dense>
                                    {structureData.resolutions.map((r, i) => (
                                        <ListItem key={i}>
                                            <ListItemIcon><Gavel fontSize="small" /></ListItemIcon>
                                            <ListItemText primary={`Rés. ${r.number}`} secondary={r.text.substring(0, 100) + '...'} />
                                        </ListItem>
                                    ))}
                                </List>

                                <Divider sx={{ my: 1 }} />
                                <Typography variant="subtitle2">Lois Citées ({structureData.laws.length}):</Typography>
                                <List dense>
                                    {structureData.laws.map((l, i) => (
                                        <ListItem key={i}>
                                            <ListItemIcon><Info fontSize="small" /></ListItemIcon>
                                            <ListItemText primary={l.reference} secondary={l.description} />
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>
                        )}
                        <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
                            <Button onClick={() => setAiStep(0)}>Retour</Button>
                            <Button variant="contained" onClick={handleVerifySchema} disabled={aiLoading}>
                                {aiLoading ? 'Vérification...' : 'Vérifier Conformité (IA)'}
                            </Button>
                        </Box>
                    </Box>
                );
            case 2:
                return (
                    <Box sx={{ p: 2 }}>
                        <Typography variant="h6" gutterBottom>Vérification Normative</Typography>
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            L'IA a vérifié les références légales et les échéances.
                        </Alert>
                        <List>
                            {verificationResults.map((res, i) => (
                                <ListItem key={i}>
                                    <ListItemIcon>
                                        {res.status === 'verified' ? <CheckCircle color="success" /> :
                                            res.status === 'warning' ? <Warning color="warning" /> : <Info color="info" />}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={res.claim}
                                        secondary={
                                            <>
                                                <Typography component="span" variant="body2" display="block">{res.analysis}</Typography>
                                                {res.source && <Typography component="span" variant="caption" color="textSecondary">Source: {res.source}</Typography>}
                                            </>
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                        <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
                            <Button onClick={() => setAiStep(1)}>Retour</Button>
                            <Button variant="contained" onClick={handleDraftRecs} disabled={aiLoading}>
                                {aiLoading ? 'Rédaction...' : 'Rédiger Recommandations (IA)'}
                            </Button>
                        </Box>
                    </Box>
                );
            case 3:
                return (
                    <Box sx={{ p: 2 }}>
                        <Typography variant="h6" gutterBottom>Propositions de Recommandations</Typography>
                        <Grid container spacing={2}>
                            {draftedRecommendations.map((rec) => (
                                <Grid size={12} key={rec.id}>
                                    <Card variant="outlined">
                                        <CardContent>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <Typography variant="h6">{rec.title}</Typography>
                                                <Chip label={rec.priority} color={rec.priority === 'Haute' ? 'error' : 'default'} size="small" />
                                            </Box>
                                            <Typography variant="body2" paragraph sx={{ mt: 1 }}>{rec.description}</Typography>
                                            <Typography variant="caption" color="textSecondary">Rationale: {rec.rationale}</Typography>
                                            <Box sx={{ mt: 2, textAlign: 'right' }}>
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox 
                                                            checked={selectedDraftRecs.has(rec.id || rec.title)} 
                                                            onChange={() => toggleDraftRec(rec.id || '', rec.title)} 
                                                            color="primary"
                                                        />
                                                    }
                                                    label="Sélectionner"
                                                />
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
                            <Button onClick={() => setAiStep(2)}>Retour</Button>
                            <Button 
                                variant="contained" 
                                color="primary" 
                                onClick={applySelectedRecommendations}
                                disabled={selectedDraftRecs.size === 0}
                            >
                                Appliquer la sélection ({selectedDraftRecs.size})
                            </Button>
                        </Box>
                    </Box>
                );
            default:
                return null;
        }
    };

    const renderStepContent = (step: number) => {
        switch (step) {
            case 0:
                return (
                    <Box sx={{ mt: 2 }}>
                        <Box sx={{ mb: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
                            <Button
                                variant="outlined"
                                startIcon={<FileDownload />}
                                onClick={() => setImportOpen(true)}
                            >
                                Importer d'un PV
                            </Button>
                            <Button
                                variant="outlined"
                                color="secondary"
                                startIcon={<Psychology />}
                                onClick={() => setAiWizardOpen(true)}
                            >
                                Assistant IA (Workflow)
                            </Button>
                        </Box>

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
                        {resolutions.map((res, idx) => (
                            <Box key={idx} sx={{ p: 2, mb: 2, border: '1px solid #e0e0e0', borderRadius: 1, position: 'relative' }}>
                                <Typography variant="subtitle2" sx={{ mb: 2, color: 'primary.main' }}>
                                    Résolution #{idx + 1}
                                </Typography>
                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <TextField
                                            fullWidth
                                            label="N° (ex: 14-C ou 2024-X)"
                                            value={res.number}
                                            onChange={(e) => {
                                                const newR = [...resolutions];
                                                newR[idx].number = e.target.value;
                                                setResolutions(newR);
                                            }}
                                            size="small"
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 8 }}>
                                        <TextField
                                            fullWidth
                                            label="Titre du sujet spécifique"
                                            value={res.title}
                                            onChange={(e) => {
                                                const newR = [...resolutions];
                                                newR[idx].title = e.target.value;
                                                setResolutions(newR);
                                            }}
                                            size="small"
                                        />
                                    </Grid>
                                    <Grid size={12}>
                                        <TextField
                                            fullWidth
                                            multiline
                                            rows={4}
                                            label="Texte Complet / Description"
                                            value={res.text}
                                            onChange={(e) => {
                                                const newR = [...resolutions];
                                                newR[idx].text = e.target.value;
                                                setResolutions(newR);
                                            }}
                                            helperText={idx === 0 ? "Le texte principal (Il est résolu de...)" : ""}
                                        />
                                    </Grid>
                                </Grid>
                                <IconButton 
                                    onClick={() => setResolutions(resolutions.length > 1 ? resolutions.filter((_, i) => i !== idx) : [{ number: '', title: '', text: '' }])} 
                                    color="error" 
                                    sx={{ position: 'absolute', top: 8, right: 8 }}
                                    title="Supprimer cette case"
                                >
                                    <Delete />
                                </IconButton>
                            </Box>
                        ))}
                        <Button startIcon={<Add />} onClick={() => setResolutions([...resolutions, { number: '', title: '', text: '' }])} size="small" sx={{ mb: 3 }}>
                            Ajouter une résolution proposée
                        </Button>
                        <TextField
                            fullWidth
                            multiline
                            rows={4}
                            label="Notes de contexte (Commentaires du PV, Historique)"
                            value={formData.notes || ''}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            margin="normal"
                            helperText="Informations pertinentes pour la recommandation. Vous pouvez modifier ou retirer le contenu."
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

                        {resolutions.filter(r => r.text.trim().length > 0).map((res, idx) => (
                            <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
                                <Typography variant="subtitle2" color="primary" gutterBottom>
                                    {res.number ? `${res.number} - ` : ''}{res.title || `Résolution #${idx + 1}`}
                                </Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{res.text}</Typography>
                            </Paper>
                        ))}

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
                                        description: `${resolutions.filter(r => r.text.trim().length > 0).map(r => `[${r.number}] ${r.title}\n${r.text}`).join('\n\n---\n\n')}\n\nCONSIDÉRANTS:\n${considerants.map(c => `- ${c}`).join('\n')}`,
                                        notes: formData.notes
                                    };
                                    const result = await generateSpeakingPoints(tempRec);
                                    if (result.success && result.speakingPoints) {
                                        const currentNotes = formData.notes || '';
                                        const separator = currentNotes ? '\n\n---\n\n' : '';
                                        setFormData(prev => ({ ...prev, notes: `${currentNotes}${separator}${result.speakingPoints}` }));
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

            {/* Import Dialog */}
            <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Importer d'un Procès-Verbal</DialogTitle>
                <DialogContent>
                    {!selectedMeetingId ? (
                        <List>
                            {meetings
                                .filter(m => m.minutes || (m.agendaItems && m.agendaItems.some(i => i.decision)))
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
                                    ?.filter(i => i.decision || i.minuteEntries?.length)
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

            {/* AI Wizard Dialog */}
            <Dialog open={aiWizardOpen} onClose={() => setAiWizardOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Assistant IA - Analyse et Recommandation</DialogTitle>
                <DialogContent dividers>
                    <Stepper activeStep={aiStep} sx={{ mb: 3 }}>
                        <Step><StepLabel>Source</StepLabel></Step>
                        <Step><StepLabel>Structure</StepLabel></Step>
                        <Step><StepLabel>Normes</StepLabel></Step>
                        <Step><StepLabel>Recommandations</StepLabel></Step>
                    </Stepper>

                    {aiError && <Alert severity="error" sx={{ mb: 2 }}>{aiError}</Alert>}

                    {renderAiStep()}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAiWizardOpen(false)}>Fermer</Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default RecommendationBuilder;
