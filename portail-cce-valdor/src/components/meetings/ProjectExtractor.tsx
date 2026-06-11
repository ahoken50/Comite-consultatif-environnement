import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Checkbox,
    FormControlLabel,
    Chip,
    CircularProgress,
    Alert,
    Divider,
    Paper,
    TextField,
    Select,
    MenuItem,
    FormControl,
    InputLabel
} from '@mui/material';
import { AutoAwesome, CheckCircle, Edit } from '@mui/icons-material';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { Meeting } from '../../types/meeting.types';
import type { Project } from '../../types/project.types';
import { aiService } from '../../services/ai/UnifiedAIService';
import type { SuggestedProject } from '../../services/ai/ai.types';
import { createProject } from '../../features/projects/projectsSlice';

interface ProjectExtractorProps {
    meeting: Meeting;
    onComplete?: () => void;
    user?: any;
}

const CATEGORY_LABELS: Record<string, string> = {
    water: 'Eau',
    biodiversity: 'Biodiversité',
    regulation: 'Réglementation',
    waste: 'Déchets',
    emergency: 'Urgence',
    innovation: 'Innovation',
    operations: 'Opérations',
    climate: 'Climat'
};

const PRIORITY_LABELS: Record<string, { label: string; color: 'default' | 'warning' | 'error' | 'info' }> = {
    low: { label: 'Basse', color: 'default' },
    medium: { label: 'Moyenne', color: 'info' },
    high: { label: 'Élevée', color: 'warning' },
    critical: { label: 'Critique', color: 'error' }
};

const ProjectExtractor: React.FC<ProjectExtractorProps> = ({ meeting, onComplete, user }) => {
    const dispatch = useDispatch<AppDispatch>();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [suggestedProjects, setSuggestedProjects] = useState<SuggestedProject[]>([]);
    const [selectedProjects, setSelectedProjects] = useState<Set<number>>(new Set());
    const [isCreating, setIsCreating] = useState(false);
    const [createdCount, setCreatedCount] = useState(0);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    const handleUpdateProject = (index: number, updatedFields: Partial<SuggestedProject>) => {
        setSuggestedProjects(prev => {
            const newProjects = [...prev];
            newProjects[index] = { ...newProjects[index], ...updatedFields };
            return newProjects;
        });
    };

    const handleExtract = async () => {
        setIsLoading(true);
        setError(null);
        setIsDialogOpen(true);
        setSuggestedProjects([]);
        setSelectedProjects(new Set());
        setEditingIndex(null);

        try {
            const projects = await aiService.extractProjects(meeting);
            setSuggestedProjects(projects);
            // Select all by default
            setSelectedProjects(new Set(projects.map((_: SuggestedProject, i: number) => i)));
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Erreur inconnue');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleProject = (index: number) => {
        setSelectedProjects(prev => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    };

    const handleCreateProjects = async () => {
        if (!user) return;

        setIsCreating(true);
        let created = 0;

        const projectsToCreate = suggestedProjects.filter((_, i) => selectedProjects.has(i));

        for (const suggested of projectsToCreate) {
            try {
                const now = new Date().toISOString();
                const code = `${meeting.type?.toUpperCase().slice(0, 3) || 'PRJ'}-${Date.now().toString().slice(-4)}`;

                const newProject: Omit<Project, 'id'> = {
                    code,
                    name: suggested.name,
                    status: 'pending',
                    priority: suggested.priority,
                    category: suggested.category,
                    resolutionCCE: suggested.sourceResolution || null,
                    dateCreated: now,
                    dateUpdated: now,
                    dateCompleted: null,
                    coordinatorId: user.id,
                    description: suggested.description,
                    currentDetails: '',
                    nextSteps: suggested.nextSteps || '',
                    linkedMeetingIds: [meeting.id],
                    linkedDocumentIds: [],
                    linkedResolutionIds: [],
                    tags: [],
                    isUrgent: suggested.isUrgent,
                    estimatedCompletionDate: null,
                    completionPercentage: 0,
                    createdBy: user.id,
                    updatedBy: user.id
                };

                await dispatch(createProject({
                    project: newProject,
                    userId: user.id,
                    userName: user.displayName || user.email || 'Utilisateur'
                })).unwrap();

                created++;
            } catch (err) {
                console.error('Failed to create project:', err);
                if (err instanceof Error) {
                    console.error('Error details:', err.message);
                } else {
                    console.error('Unknown error:', JSON.stringify(err));
                }
            }
        }

        setCreatedCount(created);
        setIsCreating(false);

        if (created > 0) {
            setTimeout(() => {
                setIsDialogOpen(false);
                onComplete?.();
            }, 2000);
        }
    };

    const hasPV = meeting.agendaItems?.some(item =>
        item.minuteEntries?.length || item.decision
    ) || meeting.minutes;

    if (!hasPV) {
        return null; // Don't show button if no PV content
    }

    return (
        <>
            <Button
                variant="outlined"
                startIcon={<AutoAwesome />}
                onClick={handleExtract}
                disabled={isLoading}
            >
                Extraire projets avec IA
            </Button>

            <Dialog
                open={isDialogOpen}
                onClose={() => !isLoading && !isCreating && setIsDialogOpen(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AutoAwesome color="primary" />
                    Extraction de projets - {meeting.title}
                </DialogTitle>

                <DialogContent>
                    {isLoading && (
                        <Box display="flex" flexDirection="column" alignItems="center" py={4}>
                            <CircularProgress />
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                                Analyse du procès-verbal en cours...
                            </Typography>
                        </Box>
                    )}

                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                    )}

                    {!isLoading && !error && suggestedProjects.length === 0 && (
                        <Alert severity="info">
                            Aucun projet actionnable trouvé dans ce procès-verbal.
                        </Alert>
                    )}

                    {createdCount > 0 && (
                        <Alert severity="success" icon={<CheckCircle />}>
                            {createdCount} projet(s) créé(s) avec succès!
                        </Alert>
                    )}

                    {!isLoading && suggestedProjects.length > 0 && createdCount === 0 && (
                        <>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                {suggestedProjects.length} projet(s) suggéré(s). Sélectionnez ceux à créer:
                            </Typography>
                            <Divider sx={{ my: 2 }} />

                            {suggestedProjects.map((project, index) => (
                                <Paper
                                    key={index}
                                    sx={{
                                        p: 2,
                                        mb: 2,
                                        border: selectedProjects.has(index) ? 2 : 1,
                                        borderColor: selectedProjects.has(index) ? 'primary.main' : 'divider'
                                    }}
                                >
                                    {editingIndex === index ? (
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            <TextField
                                                label="Nom du projet"
                                                value={project.name}
                                                onChange={(e) => handleUpdateProject(index, { name: e.target.value })}
                                                fullWidth
                                                size="small"
                                            />
                                            <Box sx={{ display: 'flex', gap: 2 }}>
                                                <FormControl size="small" fullWidth>
                                                    <InputLabel>Catégorie</InputLabel>
                                                    <Select
                                                        value={project.category}
                                                        label="Catégorie"
                                                        onChange={(e) => handleUpdateProject(index, { category: e.target.value })}
                                                    >
                                                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                                                            <MenuItem key={value} value={value}>{label}</MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                                <FormControl size="small" fullWidth>
                                                    <InputLabel>Priorité</InputLabel>
                                                    <Select
                                                        value={project.priority}
                                                        label="Priorité"
                                                        onChange={(e) => handleUpdateProject(index, { priority: e.target.value as any })}
                                                    >
                                                        {Object.entries(PRIORITY_LABELS).map(([value, { label }]) => (
                                                            <MenuItem key={value} value={value}>{label}</MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                            </Box>
                                            <TextField
                                                label="Description"
                                                value={project.description}
                                                onChange={(e) => handleUpdateProject(index, { description: e.target.value })}
                                                fullWidth
                                                multiline
                                                rows={3}
                                                size="small"
                                            />
                                            <TextField
                                                label="Prochaines étapes"
                                                value={project.nextSteps || ''}
                                                onChange={(e) => handleUpdateProject(index, { nextSteps: e.target.value })}
                                                fullWidth
                                                multiline
                                                rows={2}
                                                size="small"
                                            />
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                                                <TextField
                                                    label="Résolution Source"
                                                    value={project.sourceResolution || ''}
                                                    onChange={(e) => handleUpdateProject(index, { sourceResolution: e.target.value })}
                                                    size="small"
                                                    sx={{ width: '200px' }}
                                                />
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            checked={!!project.isUrgent}
                                                            onChange={(e) => handleUpdateProject(index, { isUrgent: e.target.checked })}
                                                        />
                                                    }
                                                    label="Urgent"
                                                />
                                                <Button
                                                    variant="contained"
                                                    color="success"
                                                    size="small"
                                                    startIcon={<CheckCircle />}
                                                    onClick={() => setEditingIndex(null)}
                                                >
                                                    Enregistrer
                                                </Button>
                                            </Box>
                                        </Box>
                                    ) : (
                                        <>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            checked={selectedProjects.has(index)}
                                                            onChange={() => handleToggleProject(index)}
                                                        />
                                                    }
                                                    label={
                                                        <Typography variant="subtitle1" fontWeight="bold">
                                                            {project.name}
                                                        </Typography>
                                                    }
                                                />
                                                <Button
                                                    size="small"
                                                    startIcon={<Edit />}
                                                    onClick={() => setEditingIndex(index)}
                                                    sx={{ mt: 0.5 }}
                                                >
                                                    Modifier
                                                </Button>
                                            </Box>

                                            <Box sx={{ ml: 4, mt: 1 }}>
                                                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                                    <Chip
                                                        label={CATEGORY_LABELS[project.category] || project.category}
                                                        size="small"
                                                        color="primary"
                                                        variant="outlined"
                                                    />
                                                    <Chip
                                                        label={PRIORITY_LABELS[project.priority]?.label || project.priority}
                                                        size="small"
                                                        color={PRIORITY_LABELS[project.priority]?.color || 'default'}
                                                    />
                                                    {project.isUrgent && (
                                                        <Chip label="URGENT" size="small" color="error" />
                                                    )}
                                                    {project.sourceResolution && (
                                                        <Chip
                                                            label={project.sourceResolution}
                                                            size="small"
                                                            variant="outlined"
                                                        />
                                                    )}
                                                </Box>

                                                <Typography variant="body2" color="text.secondary" paragraph>
                                                    {project.description}
                                                </Typography>

                                                {project.nextSteps && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        <strong>Prochaines étapes:</strong> {project.nextSteps}
                                                    </Typography>
                                                )}
                                            </Box>
                                        </>
                                    )}
                                </Paper>
                            ))}
                        </>
                    )}
                </DialogContent>

                <DialogActions>
                    <Button
                        onClick={() => {
                            setIsDialogOpen(false);
                            setEditingIndex(null);
                        }}
                        disabled={isLoading || isCreating}
                    >
                        Fermer
                    </Button>
                    {suggestedProjects.length > 0 && createdCount === 0 && (
                        <Button
                            variant="contained"
                            onClick={handleCreateProjects}
                            disabled={selectedProjects.size === 0 || isCreating}
                            startIcon={isCreating ? <CircularProgress size={16} /> : undefined}
                        >
                            {isCreating ? 'Création...' : `Créer ${selectedProjects.size} projet(s)`}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
};

export default React.memo(ProjectExtractor);
