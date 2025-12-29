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
    Paper
} from '@mui/material';
import { AutoAwesome, CheckCircle } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import type { Meeting } from '../../types/meeting.types';
import type { Project } from '../../types/project.types';
import { extractProjectsFromPV } from '../../services/geminiService';
import type { SuggestedProject } from '../../services/geminiService';
import { createProject } from '../../features/projects/projectsSlice';

interface ProjectExtractorProps {
    meeting: Meeting;
    onComplete?: () => void;
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

const ProjectExtractor: React.FC<ProjectExtractorProps> = ({ meeting, onComplete }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [suggestedProjects, setSuggestedProjects] = useState<SuggestedProject[]>([]);
    const [selectedProjects, setSelectedProjects] = useState<Set<number>>(new Set());
    const [isCreating, setIsCreating] = useState(false);
    const [createdCount, setCreatedCount] = useState(0);

    const handleExtract = async () => {
        setIsLoading(true);
        setError(null);
        setIsDialogOpen(true);
        setSuggestedProjects([]);
        setSelectedProjects(new Set());

        const result = await extractProjectsFromPV(meeting);

        setIsLoading(false);

        if (result.success && result.projects) {
            setSuggestedProjects(result.projects);
            // Select all by default
            setSelectedProjects(new Set(result.projects.map((_, i) => i)));
        } else {
            setError(result.error || 'Erreur inconnue');
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
                    coordinatorId: user.uid,
                    description: suggested.description,
                    currentDetails: '',
                    nextSteps: suggested.nextSteps,
                    linkedMeetingIds: [meeting.id],
                    linkedDocumentIds: [],
                    linkedResolutionIds: [],
                    tags: [],
                    isUrgent: suggested.isUrgent,
                    estimatedCompletionDate: null,
                    completionPercentage: 0,
                    createdBy: user.uid,
                    updatedBy: user.uid
                };

                await dispatch(createProject({
                    project: newProject,
                    userId: user.uid,
                    userName: user.displayName || user.email || 'Utilisateur'
                })).unwrap();

                created++;
            } catch (err) {
                console.error('Failed to create project:', err);
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
                                </Paper>
                            ))}
                        </>
                    )}
                </DialogContent>

                <DialogActions>
                    <Button
                        onClick={() => setIsDialogOpen(false)}
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

export default ProjectExtractor;
