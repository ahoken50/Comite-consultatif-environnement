import React, { useEffect, useState } from 'react';
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
import { AppDispatch } from '../../store/store';
import { RootState } from '../../store/rootReducer';
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

    const handleViewChange = (event: React.MouseEvent<HTMLElement>, newView: 'grid' | 'list' | 'kanban' | null) => {
        if (newView !== null) {
            setView(newView);
        }
    };

    const filteredProjects = projects.filter(project =>
        project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.code.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleProjectClick = (id: string) => {
        navigate(`/projects/${id}`);
    };

    const handleCreateProject = (data: any) => {
        console.log('Create project', data);
        // Dispatch create action here
        setIsFormOpen(false);
    };

    const handleStatusChange = (projectId: string, newStatus: ProjectStatus) => {
        console.log('Status change', projectId, newStatus);
        // Dispatch update action here
    };

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
                    onEdit={(id) => console.log('Edit', id)}
                    onDelete={(id) => console.log('Delete', id)}
                />
            )}

            {view === 'grid' && (
                <Grid container spacing={3}>
                    {filteredProjects.map((project) => (
                        <Grid item xs={12} sm={6} md={4} key={project.id}>
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
