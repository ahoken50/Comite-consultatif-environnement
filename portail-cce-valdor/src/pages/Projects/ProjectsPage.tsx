import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Box,
    Typography,
    Button,
    ToggleButton,
    ToggleButtonGroup,
    TextField,
    InputAdornment,
    Grid
} from '@mui/material';
import {
    Add,
    ViewModule,
    ViewList,
    ViewKanban,
    Search,
    FilterList
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchProjects } from '../../features/projects/projectsSlice';
import ProjectCard from '../../components/projects/ProjectCard';
import ProjectList from '../../components/projects/ProjectList';
import ProjectKanban from '../../components/projects/ProjectKanban';
import ProjectForm from '../../components/projects/ProjectForm';
import { ProjectStatus } from '../../types/project.types';

const ProjectsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { items: projects } = useSelector((state: RootState) => state.projects);
    const [view, setView] = useState<'grid' | 'list' | 'kanban'>('kanban');
    const [searchTerm, setSearchTerm] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);

    useEffect(() => {
        dispatch(fetchProjects());
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

    const handleCreateProject = useCallback(async (data: any) => {
        try {
            // Placeholder: Log data to avoid unused var warning
            console.log('Creating project with:', data);
            // await dispatch(createProject(data)).unwrap();
            setIsFormOpen(false);
        } catch (error) {
            console.error('Failed to create project:', error);
        }
    }, []);

    const handleStatusChange = useCallback(async (projectId: string, newStatus: ProjectStatus) => {
        try {
            // Placeholder: Log data to avoid unused var warning
            console.log('Updating status:', projectId, newStatus);
            // await dispatch(updateProject({ id: projectId, updates: { status: newStatus } })).unwrap();
        } catch (error) {
            console.error('Failed to update project status:', error);
        }
    }, []);

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
                </ToggleButtonGroup>
            </Box>

            {view === 'kanban' && (
                <ProjectKanban
                    projects={filteredProjects}
                    onProjectClick={handleProjectClick}
                    onStatusChange={handleStatusChange}
                />
            )}

            {view === 'list' && (
                <ProjectList
                    projects={filteredProjects}
                    onView={handleProjectClick}
                    onEdit={(id) => handleProjectClick(id)} // Navigate to detail for edit
                    onDelete={(id) => {
                        if (window.confirm('Voulez-vous vraiment supprimer ce projet ?')) {
                            // dispatch(deleteProject(id));
                            console.log('Delete project', id);
                        }
                    }}
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

            <ProjectForm
                open={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={handleCreateProject}
            />
        </Box>
    );
};

export default ProjectsPage;
