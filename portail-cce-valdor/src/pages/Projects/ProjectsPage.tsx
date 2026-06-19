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
    Alert
} from '@mui/material';
import {
    Add,
    ViewModule,
    ViewList,
    ViewKanban,
    Search,
    CalendarMonth,
    FilterList,
    Download
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchProjects, createProject, updateProject, deleteProject } from '../../features/projects/projectsSlice';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { fetchMembers } from '../../features/members/membersSlice';
import ProjectCard from '../../components/projects/ProjectCard';
import ProjectList from '../../components/projects/ProjectList';
import ProjectKanbanBoard from '../../components/projects/ProjectKanbanBoard';
import ProjectCalendar from '../../components/projects/ProjectCalendar';
import ProjectForm from '../../components/projects/ProjectForm';
import PaginationControls from '../../components/common/PaginationControls';
import { ProjectStatus } from '../../types/project.types';
import type { Project } from '../../types/project.types';
import ProjectMergeDialog from '../../components/projects/ProjectMergeDialog';
import ProjectSimilarityDialog from '../../components/projects/ProjectSimilarityDialog';
import { AccessControl } from '../../components/auth/AccessControl';
import { useToast } from '../../hooks/useToast';
import { generateStatusBrief } from '../../services/reportService';
import useServerPagination from '../../hooks/usePagination';

const ProjectsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();
    const { items: projects, error } = useSelector((state: RootState) => state.projects);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const { items: members } = useSelector((state: RootState) => state.members);
    const { user } = useSelector((state: RootState) => state.auth);
    const [view, setView] = useState<'grid' | 'list' | 'kanban' | 'calendar'>('kanban');
    const [searchTerm, setSearchTerm] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);

    // Merge State
    const [isMergeOpen, setIsMergeOpen] = useState(false);
    const [mergeSourceProject, setMergeSourceProject] = useState<Project | null>(null);
    const [isSimilarityOpen, setIsSimilarityOpen] = useState(false);


    useEffect(() => {
        dispatch(fetchProjects());
        dispatch(fetchMeetings());
        dispatch(fetchMembers());
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

    // Server-side cursor-based pagination for grid view
    const [serverPagination, serverActions] = useServerPagination<Project>({
        collectionName: 'projects',
        pageSize: 12,
        orderByField: 'dateUpdated',
        orderDirection: 'desc'
    });

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
                coordinatorId: user.id || user.uid || '',
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
                createdBy: user.id || user.uid || '',
                updatedBy: user.id || user.uid || ''
            };

            await dispatch(createProject({
                project: newProject,
                userId: user.id || user.uid || '',
                userName: user.displayName || user.email || 'Utilisateur'
            })).unwrap();

            setIsFormOpen(false);
            showSuccess('Projet créé avec succès !');
        } catch (err) {
            console.error('Failed to create project:', err);
            showError('Erreur lors de la création du projet');
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
                userId: user.id || user.uid || 'unknown',
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: project.name
            })).unwrap();

            showSuccess('Statut mis à jour !');
        } catch (err) {
            console.error('Failed to update project status:', err);
            showError('Erreur lors de la mise à jour');
        }
    }, [dispatch, user, projects]);

    const handleDeleteProject = useCallback(async (id: string) => {
        if (!user) return;

        const project = projects.find(p => p.id === id);
        if (!project) return;

        if (!window.confirm(`Voulez-vous vraiment supprimer le projet "${project.name}"?`)) {
            return;
        }

        try {
            await dispatch(deleteProject({
                id,
                userId: user.id || user.uid || 'unknown',
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: project.name
            })).unwrap();

            showSuccess('Projet supprimé');
        } catch (err) {
            console.error('Failed to delete project:', err);
            showError('Erreur lors de la suppression');
        }
    }, [dispatch, user, projects]);

    const handleMergeClick = useCallback((project: Project) => {
        setMergeSourceProject(project);
        setIsMergeOpen(true);
    }, []);

    const handleExportBrief = useCallback(() => {
        try {
            generateStatusBrief(filteredProjects);
            showSuccess('Brief de statut généré avec succès');
        } catch (err) {
            console.error('Error generating brief:', err);
            showError('Erreur lors de la génération du PDF');
        }
    }, [filteredProjects, showSuccess, showError]);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    Projets
                </Typography>
                <AccessControl allowedRoles={['coordinator']}>
                    <Button
                        variant="outlined"
                        color="secondary"
                        onClick={() => setIsSimilarityOpen(true)}
                        sx={{ mr: 2 }}
                    >
                        Détecter les doublons
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<Download />}
                        onClick={handleExportBrief}
                        sx={{ mr: 2 }}
                    >
                        Brief PDF
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={() => setIsFormOpen(true)}
                    >
                        Nouveau Projet
                    </Button>
                </AccessControl>
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
                    onMerge={handleMergeClick}
                />
            )}

            {view === 'grid' && (
                <Box>
                    <Grid container spacing={3}>
                        {serverPagination.items.map((project) => (
                            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={project.id}>
                                <ProjectCard project={project} onClick={handleProjectClick} />
                            </Grid>
                        ))}
                    </Grid>
                    {serverPagination.totalItems > 12 && (
                        <PaginationControls
                            totalItems={serverPagination.totalItems}
                            page={serverPagination.currentPage}
                            rowsPerPage={12}
                            onPageChange={(p) => serverActions.goToPage(p)}
                            onRowsPerPageChange={() => {}}
                            rowsPerPageOptions={[12]}
                        />
                    )}
                </Box>
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
                members={members}
            />

            <ProjectMergeDialog
                open={isMergeOpen}
                onClose={() => setIsMergeOpen(false)}
                sourceProject={mergeSourceProject}
                allProjects={projects}
            />

            <ProjectSimilarityDialog
                open={isSimilarityOpen}
                onClose={() => setIsSimilarityOpen(false)}
                allProjects={projects}
            />
        </Box>
    );
};

export default ProjectsPage;
