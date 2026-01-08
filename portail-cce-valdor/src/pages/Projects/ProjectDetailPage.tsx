import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Button,
    Tabs,
    Tab,
    Paper,
    Grid,
    Chip,
    Divider,
    IconButton,
    LinearProgress
} from '@mui/material';
import { ArrowBack, Edit, Delete } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchDocumentsByEntity, deleteDocument } from '../../features/documents/documentsSlice';
import { fetchMembers } from '../../features/members/membersSlice';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { updateProject, deleteProject } from '../../features/projects/projectsSlice';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';
import ProjectTasks from '../../components/projects/ProjectTasks';
import ProjectForm from '../../components/projects/ProjectForm';
import ProjectComments from '../../components/projects/ProjectComments';
import ProjectDecisions from '../../components/projects/ProjectDecisions';
import LinkedResolutions from '../../components/projects/LinkedResolutions';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`project-tabpanel-${index}`}
            aria-labelledby={`project-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

const ProjectDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const [tabValue, setTabValue] = useState(0);
    const [editDialogOpen, setEditDialogOpen] = useState(false);

    // Selectors
    const project = useSelector((state: RootState) =>
        state.projects.items.find(p => p.id === id)
    );
    const { items: documents } = useSelector((state: RootState) => state.documents);
    const { items: members } = useSelector((state: RootState) => state.members);
    const { user } = useSelector((state: RootState) => state.auth);
    const tasks = useSelector((state: RootState) => id ? state.projects.tasksByProjectId[id] || [] : []);

    useEffect(() => {
        if (id) {
            dispatch(fetchDocumentsByEntity({ entityId: id, entityType: 'project' }));
            if (members.length === 0) dispatch(fetchMembers());
            dispatch(fetchMeetings()); // Fetch meetings for LinkedResolutions
        }
    }, [dispatch, id, members.length]);

    if (!project) {
        return <Typography>Projet non trouvé</Typography>;
    }

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const handleUpdateProject = async (data: any) => {
        if (project && id && user) {
            await dispatch(updateProject({
                id,
                updates: { ...data, dateUpdated: new Date().toISOString() },
                userId: user.uid,
                userName: user.displayName || 'Utilisateur',
                projectName: project.name
            }));
            setEditDialogOpen(false);
        }
    };

    const handleDeleteProject = async () => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer ce projet ?') && user) {
            await dispatch(deleteProject({
                id: project.id,
                userId: user.uid,
                userName: user.displayName || 'Utilisateur',
                projectName: project.name
            }));
            navigate('/projects');
        }
    };

    const coordinator = members.find(m => m.id === project.coordinatorId);

    // Calculate progress
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return (
        <Box>
            <Button
                startIcon={<ArrowBack />}
                onClick={() => navigate('/projects')}
                sx={{ mb: 2 }}
            >
                Retour aux projets
            </Button>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                            <Typography variant="h4" fontWeight={700}>
                                {project.name}
                            </Typography>
                            <Chip label={project.code} variant="outlined" />
                            <Chip label={project.status} color="primary" size="small" />
                        </Box>
                        <Typography variant="subtitle1" color="textSecondary">
                            Priorité: {project.priority}
                        </Typography>
                    </Box>
                    <Box>
                        <Button
                            startIcon={<Edit />}
                            variant="outlined"
                            sx={{ mr: 1 }}
                            onClick={() => setEditDialogOpen(true)}
                        >
                            Modifier
                        </Button>
                        <IconButton color="error" onClick={handleDeleteProject}>
                            <Delete />
                        </IconButton>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={handleTabChange} aria-label="project tabs">
                        <Tab label="Vue d'ensemble" />
                        <Tab label="Tâches" />
                        <Tab label="Résolutions CCE" />
                        <Tab label="Décisions Caucus" />
                        <Tab label="Documents" />
                        <Tab label="Commentaires" />
                    </Tabs>
                </Box>

                <TabPanel value={tabValue} index={0}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Typography variant="h6" gutterBottom>Description</Typography>
                            <Typography paragraph>{project.description}</Typography>

                            <Box sx={{ mt: 3, mb: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                    <Typography variant="h6">Avancement du projet</Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        {completedTasks}/{totalTasks} tâches ({progressPercentage.toFixed(0)}%)
                                    </Typography>
                                </Box>
                                <LinearProgress variant="determinate" value={progressPercentage} sx={{ height: 10, borderRadius: 5 }} />
                            </Box>

                            <Typography paragraph sx={{ whiteSpace: 'pre-line' }}>{project.currentDetails}</Typography>

                            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Prochaines étapes</Typography>
                            <Typography paragraph sx={{ whiteSpace: 'pre-line' }}>{project.nextSteps}</Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                                <Typography variant="subtitle2" gutterBottom>Informations clés</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <Typography variant="body2"><strong>Créé le:</strong> {new Date(project.dateCreated).toLocaleDateString()}</Typography>
                                    <Typography variant="body2"><strong>Mis à jour:</strong> {new Date(project.dateUpdated).toLocaleDateString()}</Typography>
                                    <Typography variant="body2"><strong>Responsable:</strong> {coordinator?.displayName || project.coordinatorId || 'Non assigné'}</Typography>
                                    {project.resolutionCCE && (
                                        <Typography variant="body2"><strong>Résolution:</strong> {project.resolutionCCE}</Typography>
                                    )}
                                    {project.linkedMeetingIds && project.linkedMeetingIds.length > 0 && (
                                        <Typography variant="body2"><strong>Réunion:</strong> {project.linkedMeetingIds.length} liée(s)</Typography>
                                    )}
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <ProjectTasks project={project} />
                </TabPanel>

                <TabPanel value={tabValue} index={2}>
                    <LinkedResolutions project={project} />
                </TabPanel>

                <TabPanel value={tabValue} index={3}>
                    <ProjectDecisions project={project} />
                </TabPanel>

                <TabPanel value={tabValue} index={4}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Typography variant="h6" gutterBottom>Documents du projet</Typography>
                            <DocumentList
                                documents={documents.filter(d => d.linkedEntityId === project.id)}
                                onDelete={(docId, path) => dispatch(deleteDocument({ id: docId, storagePath: path }))}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Typography variant="h6" gutterBottom>Ajouter</Typography>
                            <DocumentUpload
                                linkedEntityId={project.id}
                                linkedEntityType="project"
                                onUploadComplete={() => dispatch(fetchDocumentsByEntity({ entityId: project.id, entityType: 'project' }))}
                            />
                        </Grid>
                    </Grid>
                </TabPanel>

                <TabPanel value={tabValue} index={5}>
                    <ProjectComments project={project} />
                </TabPanel>
            </Paper>

            <ProjectForm
                open={editDialogOpen}
                initialData={project}
                onClose={() => setEditDialogOpen(false)}
                onSubmit={handleUpdateProject}
            />
        </Box>
    );
};

export default ProjectDetailPage;
