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
    LinearProgress,
    Alert,
    CircularProgress
} from '@mui/material';
import { Edit, Delete, AutoAwesome } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchDocumentsByEntity, deleteDocument, fetchDocuments } from '../../features/documents/documentsSlice';
import { fetchMembers } from '../../features/members/membersSlice';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { updateProject, deleteProject, fetchProjects } from '../../features/projects/projectsSlice';
import { fetchRecommendations } from '../../features/governance/governanceSlice';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';
import ProjectTasks from '../../components/projects/ProjectTasks';
import ProjectForm from '../../components/projects/ProjectForm';
import ProjectComments from '../../components/projects/ProjectComments';
import ProjectDecisions from '../../components/projects/ProjectDecisions';
import ProjectRecommendations from '../../components/projects/ProjectRecommendations';
import LinkedResolutions from '../../components/projects/LinkedResolutions';
import ProjectRegulations from '../../components/projects/ProjectRegulations';
import ProjectDependencies from '../../components/projects/ProjectDependencies';
import Breadcrumbs from '../../components/common/Breadcrumbs';
import { AccessControl } from '../../components/auth/AccessControl';
import { generateProjectSummary, isGroqConfigured } from '../../services/ai/projectSummaryService';

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

    // #11.1 AI Summary state
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

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
            dispatch(fetchDocuments()); // Fetch all documents for LinkedResolutions attachments
            if (members.length === 0) dispatch(fetchMembers());
            dispatch(fetchMeetings()); // Fetch meetings for LinkedResolutions
            dispatch(fetchRecommendations()); // Fetch recommendations for the new tab
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
                userId: user.id || user.uid || '',
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
                userId: user.id || user.uid || '',
                userName: user.displayName || 'Utilisateur',
                projectName: project.name
            }));
            navigate('/projects');
        }
    };

    // #11.1 Generate AI Summary handler
    const handleGenerateSummary = async () => {
        if (!project) return;

        setSummaryLoading(true);
        setSummaryError(null);

        try {
            const result = await generateProjectSummary(project);

            if (result.success && result.summary) {
                // Update project with summary
                await dispatch(updateProject({
                    id: project.id,
                    updates: {
                        aiSummary: result.summary,
                        aiSummaryGeneratedAt: new Date().toISOString(),
                        dateUpdated: new Date().toISOString()
                    },
                    userId: user?.id || user?.uid || '',
                    userName: user?.displayName || 'Utilisateur',
                    projectName: project.name
                }));
                // Refresh projects to get updated summary
                dispatch(fetchProjects());
            } else {
                setSummaryError(result.error || 'Erreur lors de la génération');
            }
        } catch (err) {
            console.error('Error generating summary:', err);
            setSummaryError('Erreur inattendue');
        } finally {
            setSummaryLoading(false);
        }
    };

    // #2.7 Refresh projects when dependencies change
    const handleDependencyUpdate = () => {
        dispatch(fetchProjects());
    };

    const coordinator = members.find(m => m.id === project.coordinatorId);

    // Calculate progress
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return (
        <Box>
            <Breadcrumbs
                items={[
                    { label: 'Accueil', to: '/dashboard' },
                    { label: 'Projets', to: '/projects' },
                    { label: project.name || 'Détail du projet' }
                ]}
            />

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
                        <AccessControl allowedRoles={['coordinator']}>
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
                        </AccessControl>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={handleTabChange} aria-label="project tabs" variant="scrollable" scrollButtons="auto">
                        <Tab label="Vue d'ensemble" />
                        <Tab label="Tâches" />
                        <Tab label="Dépendances" />
                        <Tab label="Résolutions CCE" />
                        <Tab label="Recommandations" />
                        <Tab label="Règlements" />
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
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default', mb: 2 }}>
                                <Typography variant="subtitle2" gutterBottom>Informations clés</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <Typography variant="body2"><strong>Créé le:</strong> {new Date(project.dateCreated).toLocaleDateString()}</Typography>
                                    <Typography variant="body2"><strong>Mis à jour:</strong> {new Date(project.dateUpdated).toLocaleDateString()}</Typography>
                                    <Typography variant="body2"><strong>Responsable:</strong> {coordinator?.displayName || project.coordinatorId || 'Non assigné'}</Typography>
                                    
                                    {/* Link to the most recent resolution number if available */}
                                    {(project.resolutionCCE || (project.linkedResolutions && project.linkedResolutions.length > 0)) && (
                                        <Typography variant="body2">
                                            <strong>Résolution:</strong> {
                                                project.linkedResolutions && project.linkedResolutions.length > 0
                                                    ? [...project.linkedResolutions].sort((a, b) => new Date(b.linkedAt).getTime() - new Date(a.linkedAt).getTime())[0].entryNumber
                                                    : project.resolutionCCE
                                            }
                                        </Typography>
                                    )}

                                    {/* Dynamic meeting count */}
                                    {((project.linkedMeetingIds && project.linkedMeetingIds.length > 0) || (project.linkedResolutions && project.linkedResolutions.length > 0)) && (
                                        <Typography variant="body2">
                                            <strong>Réunion:</strong> {
                                                project.linkedResolutions && project.linkedResolutions.length > 0
                                                    ? new Set(project.linkedResolutions.map(r => r.meetingId)).size
                                                    : project.linkedMeetingIds?.length || 0
                                            } liée(s)
                                        </Typography>
                                    )}
                                </Box>
                            </Paper>

                            {/* #11.1 AI Summary Widget */}
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                    <Typography variant="subtitle2">Résumé IA</Typography>
                                    {isGroqConfigured() && (
                                        <Button
                                            size="small"
                                            startIcon={summaryLoading ? <CircularProgress size={16} /> : <AutoAwesome />}
                                            onClick={handleGenerateSummary}
                                            disabled={summaryLoading}
                                        >
                                            {project.aiSummary ? 'Regénérer' : 'Générer'}
                                        </Button>
                                    )}
                                </Box>
                                {summaryError && (
                                    <Alert severity="error" sx={{ mb: 1 }} onClose={() => setSummaryError(null)}>
                                        {summaryError}
                                    </Alert>
                                )}
                                {project.aiSummary ? (
                                    <Box>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                                            {project.aiSummary}
                                        </Typography>
                                        {project.aiSummaryGeneratedAt && (
                                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                                Généré le {new Date(project.aiSummaryGeneratedAt).toLocaleDateString()}
                                            </Typography>
                                        )}
                                    </Box>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">
                                        {isGroqConfigured()
                                            ? 'Cliquez sur "Générer" pour créer un résumé automatique.'
                                            : 'Clé API Groq non configurée.'}
                                    </Typography>
                                )}
                            </Paper>
                        </Grid>
                    </Grid>
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <ProjectTasks project={project} />
                </TabPanel>

                {/* #2.7 Dependencies Tab */}
                <TabPanel value={tabValue} index={2}>
                    <ProjectDependencies project={project} onUpdate={handleDependencyUpdate} />
                </TabPanel>

                <TabPanel value={tabValue} index={3}>
                    <LinkedResolutions project={project} />
                </TabPanel>

                <TabPanel value={tabValue} index={4}>
                    <ProjectRecommendations projectId={project.id} />
                </TabPanel>

                <TabPanel value={tabValue} index={5}>
                    <ProjectRegulations project={project} />
                </TabPanel>

                <TabPanel value={tabValue} index={6}>
                    <ProjectDecisions project={project} />
                </TabPanel>

                <TabPanel value={tabValue} index={7}>
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

                <TabPanel value={tabValue} index={8}>
                    <ProjectComments project={project} />
                </TabPanel>
            </Paper>

            <ProjectForm
                open={editDialogOpen}
                initialData={project}
                onClose={() => setEditDialogOpen(false)}
                onSubmit={handleUpdateProject}
                members={members}
            />
        </Box>
    );
};

export default ProjectDetailPage;
