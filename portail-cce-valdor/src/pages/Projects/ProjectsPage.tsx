import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Box,
    Typography,
    Button,
    ToggleButton,
    ToggleButtonGroup,
    TextField,
    InputAdornment,
    Grid,
    Snackbar,
    Alert
} from '@mui/material';
import {
    Add,
    ViewModule,
    ViewList,
    ViewKanban,
    Search,
    CalendarMonth,
    FilterList
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchProjects, createProject, updateProject, deleteProject } from '../../features/projects/projectsSlice';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import ProjectCard from '../../components/projects/ProjectCard';
import ProjectList from '../../components/projects/ProjectList';
import ProjectKanbanBoard from '../../components/projects/ProjectKanbanBoard';
import ProjectCalendar from '../../components/projects/ProjectCalendar';
import ProjectForm from '../../components/projects/ProjectForm';
import { ProjectStatus } from '../../types/project.types';
import type { Project } from '../../types/project.types';

const ProjectsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { items: projects, error } = useSelector((state: RootState) => state.projects);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const { user } = useSelector((state: RootState) => state.auth);
    const [view, setView] = useState<'grid' | 'list' | 'kanban' | 'calendar'>('kanban');
    const [searchTerm, setSearchTerm] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
        open: false,
        message: '',
        severity: 'success'
    });

    useEffect(() => {
        dispatch(fetchProjects());
        dispatch(fetchMeetings());
    }, [dispatch]);

    const handleViewChange = (_: React.MouseEvent<HTMLElement>, newView: 'grid' | 'list' | 'kanban' | null) => {
        if (newView !== null) {
            setView(newView);
        }
    };

    const filteredProjects = useMemo(() => projects.filter(project =>
        project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.code.toLowerCase().includes(searchTerm.toLowerCase())
    ), [projects, searchTerm]);

    const handleProjectClick = useCallback((id: string) => {
        navigate(`/projects/${id}`);
    }, [navigate]);

    const handleCreateProject = useCallback(async (data: Partial<Project>) => {
        if (!user) return;

        try {
            const now = new Date().toISOString();
            const newProject: Omit<Project, 'id'> = {
                code: data.code || '',
                name: data.name || '',
                status: data.status || 'pending',
                priority: data.priority || 'medium',
                category: data.category || 'water',
                resolutionCCE: null,
                dateCreated: now,
                dateUpdated: now,
                dateCompleted: null,
                coordinatorId: user.uid,
                description: data.description || '',
                currentDetails: '',
                nextSteps: '',
                linkedMeetingIds: [],
                linkedDocumentIds: [],
                linkedResolutionIds: [],
                tags: [],
                isUrgent: data.isUrgent || false,
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

            setIsFormOpen(false);
            setSnackbar({ open: true, message: 'Projet créé avec succès!', severity: 'success' });
        } catch (err) {
            console.error('Failed to create project:', err);
            setSnackbar({ open: true, message: 'Erreur lors de la création du projet', severity: 'error' });
        }
    }, [dispatch, user]);

    const handleStatusChange = useCallback(async (projectId: string, newStatus: ProjectStatus) => {
        if (!user) return;

        const project = projects.find(p => p.id === projectId);
        if (!project) return;

        try {
            const updates: Partial<Project> = {
                status: newStatus,
                updatedBy: user.uid
            };

            // If completing, set completion date
            if (newStatus === 'completed') {
                updates.dateCompleted = new Date().toISOString();
                updates.completionPercentage = 100;
            }

            await dispatch(updateProject({
                id: projectId,
                updates,
                userId: user.uid,
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: project.name
            })).unwrap();

            setSnackbar({ open: true, message: 'Statut mis à jour!', severity: 'success' });
        } catch (err) {
            console.error('Failed to update project status:', err);
            setSnackbar({ open: true, message: 'Erreur lors de la mise à jour', severity: 'error' });
        }
    }, [dispatch, user, projects]);

    const handleDeleteProject = useCallback(async (id: string, projectName: string) => {
        if (!user) return;

        if (!window.confirm(`Voulez-vous vraiment supprimer le projet "${projectName}"?`)) {
            return;
        }

        try {
            await dispatch(deleteProject({
                id,
                userId: user.uid,
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: projectName
            })).unwrap();

            setSnackbar({ open: true, message: 'Projet supprimé', severity: 'success' });
        } catch (err) {
            console.error('Failed to delete project:', err);
            setSnackbar({ open: true, message: 'Erreur lors de la suppression', severity: 'error' });
        }
    }, [dispatch, user]);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    Projets
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={() => setIsFormOpen(true)}
                >
                    Nouveau Projet
                </Button>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', gap: 2, flex: 1 }}>
                    <TextField
                        placeholder="Rechercher un projet..."
                        size="small"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search color="action" />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ maxWidth: 400, bgcolor: 'background.paper' }}
                    />
                    <Button variant="outlined" startIcon={<FilterList />}>
                        Filtres
                    </Button>
                </Box>

                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    aria-label="view mode"
                    size="small"
                >
                    <ToggleButton value="kanban" aria-label="kanban view">
                        <ViewKanban />
                    </ToggleButton>
                    <ToggleButton value="grid" aria-label="grid view">
                        <ViewModule />
                    </ToggleButton>
                    <ToggleButton value="list" aria-label="list view">
                        <ViewList />
                    </ToggleButton>
                    <ToggleButton value="calendar" aria-label="calendar view">
                        <CalendarMonth />
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {view === 'kanban' && (
                <ProjectKanbanBoard
                    projects={filteredProjects}
                    onStatusChange={handleStatusChange}
                />
            )}

            {view === 'list' && (
                <ProjectList
                    projects={filteredProjects}
                    onView={handleProjectClick}
                    onEdit={handleProjectClick}
                    onDelete={handleDeleteProject}
                />
            )}

            {view === 'grid' && (
                <Grid container spacing={3}>
                    {filteredProjects.map((project) => (
                        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={project.id}>
                            <ProjectCard project={project} onClick={handleProjectClick} />
                        </Grid>
                    ))}
                </Grid>
            )}

            {view === 'calendar' && (
                <ProjectCalendar
                    projects={filteredProjects}
                    meetings={meetings}
                />
            )}

            <ProjectForm
                open={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={handleCreateProject}
            />

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ProjectsPage;
