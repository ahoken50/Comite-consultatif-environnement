import React, { useEffect, useMemo } from 'react';
import { Box, Typography, Paper, Grid, Accordion, AccordionSummary, AccordionDetails, Chip } from '@mui/material';
import { ExpandMore, Folder } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchDocuments, deleteDocument } from '../../features/documents/documentsSlice';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';
import type { Document } from '../../types/document.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const DocumentsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: documents } = useSelector((state: RootState) => state.documents);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const { items: projects } = useSelector((state: RootState) => state.projects);

    useEffect(() => {
        dispatch(fetchDocuments());
        dispatch(fetchMeetings());
        dispatch(fetchProjects());
    }, [dispatch]);

    const handleDelete = async (id: string, storagePath: string) => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer ce document ?')) {
            await dispatch(deleteDocument({ id, storagePath }));
        }
    };

    const groupedDocuments = useMemo(() => {
        const groups: Record<string, { title: string; type: 'meeting' | 'project' | 'other'; date: string; documents: Document[]; entityId?: string }> = {};

        // Initialize groups for all meetings (even empty ones, optional, but user might want to see them)
        // For now, let's only show groups that have documents OR just iterate documents.
        // Actually, usually better to show folders for existing entities if we want to "file" things, 
        // but here we are viewing existing documents. Let's group existing documents.

        documents.forEach(doc => {
            let key = 'other';
            let title = 'Documents Généraux';
            let type: 'meeting' | 'project' | 'other' = 'other';
            let date = '';
            let entityId = '';

            if (doc.linkedEntityType === 'meeting' && doc.linkedEntityId) {
                const meeting = meetings.find(m => m.id === doc.linkedEntityId);
                if (meeting) {
                    key = `meeting-${meeting.id}`;
                    title = `Assemblée: ${meeting.title}`;
                    type = 'meeting';
                    date = meeting.date;
                    entityId = meeting.id;
                } else {
                    // Meeting not found (maybe deleted), keep as other or separate group?
                    // Let's keep in a "Orphaned" or just fallback to Other for now, or display ID.
                    title = `Assemblée (Introuvable: ${doc.linkedEntityId})`;
                    key = `meeting-${doc.linkedEntityId}`;
                }
            } else if (doc.linkedEntityType === 'project' && doc.linkedEntityId) {
                const project = projects.find(p => p.id === doc.linkedEntityId);
                if (project) {
                    key = `project-${project.id}`;
                    title = `Projet: ${project.name}`;
                    type = 'project';
                    date = project.dateCreated; // Assuming createdAt exists, or updated...
                    entityId = project.id;
                } else {
                    title = `Projet (Introuvable: ${doc.linkedEntityId})`;
                    key = `project-${doc.linkedEntityId}`;
                }
            }

            if (!groups[key]) {
                groups[key] = { title, type, date, documents: [], entityId };
            }
            groups[key].documents.push(doc);
        });

        return Object.values(groups).sort((a, b) => {
            // Sort by date descending
            if (a.type === 'other') return 1; // Put General at bottom
            if (b.type === 'other') return -1;
            return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
        });
    }, [documents, meetings, projects]);

    return (
        <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
                Documents
            </Typography>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 8 }}>
                    <Paper sx={{ p: 3, mb: 3, bgcolor: 'transparent', boxShadow: 'none' }}>
                        <Typography variant="h6" gutterBottom>
                            Répertoire
                        </Typography>

                        {groupedDocuments.length === 0 && (
                            <Paper sx={{ p: 3, textAlign: 'center' }}>
                                <Typography color="text.secondary">Aucun document trouvé.</Typography>
                            </Paper>
                        )}

                        {groupedDocuments.map((group) => (
                            <Accordion key={group.title} defaultExpanded={group.type !== 'other'} sx={{ mb: 1, '&:before': { display: 'none' } }}>
                                <AccordionSummary
                                    expandIcon={<ExpandMore />}
                                    aria-controls={`panel-${group.title}-content`}
                                    id={`panel-${group.title}-header`}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                                        <Folder color={group.type === 'meeting' ? 'primary' : group.type === 'project' ? 'secondary' : 'action'} />
                                        <Typography sx={{ fontWeight: 500, flexGrow: 1 }}>
                                            {group.title}
                                        </Typography>
                                        <Chip label={group.documents.length} size="small" variant="outlined" />
                                        {group.date && (
                                            <Typography variant="caption" color="text.secondary" sx={{ mr: 2 }}>
                                                {format(new Date(group.date), 'd MMM yyyy', { locale: fr })}
                                            </Typography>
                                        )}
                                    </Box>
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 0 }}>
                                    <DocumentList
                                        documents={group.documents}
                                        onDelete={handleDelete}
                                        agendaItems={group.type === 'meeting' ? meetings.find(m => m.id === group.entityId)?.agendaItems : undefined}
                                    />
                                </AccordionDetails>
                            </Accordion>
                        ))}
                    </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            Ajouter un document
                        </Typography>
                        <DocumentUpload onUploadComplete={() => dispatch(fetchDocuments())} />
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DocumentsPage;
