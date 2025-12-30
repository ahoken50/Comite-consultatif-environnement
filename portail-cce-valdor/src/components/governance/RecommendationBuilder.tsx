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
    CircularProgress
} from '@mui/material';
import {
    Add,
    Delete,
    RecordVoiceOver,
    Download,
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
        if (meeting.globalNotes) {
            text += `NOTES GÉNÉRALES:\n${meeting.globalNotes}\n\n`;
        }
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

    const handleApplyRecommendation = (rec: DraftRecommendation) => {
        setFormData(prev => ({
            ...prev,
            projectName: rec.title,
            description: rec.description,
            sourceResolutionNumber: rec.sourceResolutionNumber || '',
            priority: rec.priority === 'Haute' ? 'high' : rec.priority === 'Moyenne' ? 'medium' : 'low',
            notes: `RATIONALE IA: ${rec.rationale}`
        }));
        setAiWizardOpen(false);
        setAiStep(0);
        setPvText('');
    };

    const handleImportSelection = (meeting: Meeting, item: AgendaItem) => {
        const resolutionEntry = item.minuteEntries?.find(e => e.type === 'resolution');
        const comments = item.minuteEntries
            ?.filter(e => e.type === 'comment')
            .map(e => e.content)
            .join('\n\n') || '';

        const rawContent = resolutionEntry?.content || item.decision || item.description || '';
        const resolutionNumber = resolutionEntry?.number || item.minuteNumber || '';
        const title = item.title;
        const extractedConsiderants = extractConsiderants(rawContent);

        setFormData(prev => ({
            ...prev,
            projectName: title,
            meetingId: meeting.id,
            meetingDate: meeting.date,
            sourceResolutionNumber: resolutionNumber,
            sourceResolutionContent: rawContent,
            description: rawContent,
            notes: comments ? `[Commentaires du PV]:\n${comments}` : ''
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
            alert("Veuillez lier une réunion (Import) pour générer l'extrait officiel.");
            return;
        }
        if (meetingContext) {
            await generateResolutionPDF(meetingContext, formData as CouncilRecommendation, 'recommendation');
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
                                                <Button size="small" variant="contained" onClick={() => handleApplyRecommendation(rec)}>Utiliser cette recommandation</Button>
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                        <Box sx={{ mt: 2 }}>
                            <Button onClick={() => setAiStep(2)}>Retour</Button>
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
                                        description: `${formData.description || ''}\n\nCONSIDÉRANTS:\n${considerants.map(c => `- ${c}`).join('\n')}`,
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
