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
    IconButton
} from '@mui/material';
import { ArrowBack, Edit, Delete } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchDocumentsByEntity, deleteDocument } from '../../features/documents/documentsSlice';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';

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

    // Select project from Redux store (assuming it's already loaded in the list, or we should fetch it)
    // For now, we'll try to find it in the list. In a real app, we might need a fetchProjectById thunk.
    const project = useSelector((state: RootState) =>
        state.projects.items.find(p => p.id === id)
    );

    const { items: documents } = useSelector((state: RootState) => state.documents);

    useEffect(() => {
        if (id) {
            dispatch(fetchDocumentsByEntity({ entityId: id, entityType: 'project' }));
        }
    }, [dispatch, id]);

    if (!project) {
        return <Typography>Projet non trouvé</Typography>;
    }

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

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
                        <Button startIcon={<Edit />} variant="outlined" sx={{ mr: 1 }}>
                            Modifier
                        </Button>
                        <IconButton color="error">
                            <Delete />
                        </IconButton>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={handleTabChange} aria-label="project tabs">
                        <Tab label="Vue d'ensemble" />
                        <Tab label="Commentaires" />
                        <Tab label="Historique" />
                        <Tab label="Documents" />
                    </Tabs>
                </Box>

                <TabPanel value={tabValue} index={0}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Typography variant="h6" gutterBottom>Description</Typography>
                            <Typography paragraph>{project.description}</Typography>

                            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>État d'avancement</Typography>
                            <Typography paragraph>{project.currentDetails}</Typography>

                            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Prochaines étapes</Typography>
                            <Typography paragraph>{project.nextSteps}</Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                                <Typography variant="subtitle2" gutterBottom>Informations clés</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <Typography variant="body2"><strong>Créé le:</strong> {new Date(project.dateCreated).toLocaleDateString()}</Typography>
                                    <Typography variant="body2"><strong>Mis à jour:</strong> {new Date(project.dateUpdated).toLocaleDateString()}</Typography>
                                    <Typography variant="body2"><strong>Responsable:</strong> {project.coordinatorId}</Typography>
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <Typography color="textSecondary">Section commentaires à venir...</Typography>
                </TabPanel>

                <TabPanel value={tabValue} index={2}>
                    <Typography color="textSecondary">Historique des modifications à venir...</Typography>
                </TabPanel>

                <TabPanel value={tabValue} index={3}>
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
            </Paper>
        </Box>
    );
};

export default ProjectDetailPage;
