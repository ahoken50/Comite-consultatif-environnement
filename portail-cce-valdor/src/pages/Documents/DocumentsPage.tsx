import React, { useEffect, useMemo, useCallback, useRef } from 'react';
import { Box, Typography, Paper, Grid, Accordion, AccordionSummary, AccordionDetails, Chip } from '@mui/material';
import { ExpandMore, Folder } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { deleteDocument } from '../../features/documents/documentsSlice';
import { fetchMeetings, updateMeeting } from '../../features/meetings/meetingsSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';
import type { Document } from '../../types/document.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AccessControl } from '../../components/auth/AccessControl';
import useServerPagination from '../../hooks/usePagination';
import PaginationControls from '../../components/common/PaginationControls';

const DocumentsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const { items: projects } = useSelector((state: RootState) => state.projects);

    // Server-side cursor-based pagination for documents
    const [docPagination, docActions] = useServerPagination<Document>({
        collectionName: 'documents',
        pageSize: 10,
        orderByField: 'dateUploaded',
        orderDirection: 'desc'
    });

    // Refs to access latest state in callbacks without triggering re-renders or recreating callbacks
    const meetingsRef = useRef(meetings);

    useEffect(() => {
        meetingsRef.current = meetings;
    }, [meetings]);

    useEffect(() => {
        dispatch(fetchMeetings());
        dispatch(fetchProjects());
    }, [dispatch]);

    // Optimize lookups by creating Maps (O(1) access) instead of using find() in loops (O(N))
    const meetingsMap = useMemo(() => new Map(meetings.map(m => [m.id, m])), [meetings]);
    const projectsMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

    const handleDelete = useCallback(async (id: string, storagePath: string) => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer ce document ?')) {
            try {
                // Check if this document is linked as a meeting's minutes file
                const currentMeetings = meetingsRef.current;

                // First try by documentId, then by storagePath as fallback for legacy data
                let linkedMeeting = currentMeetings.find(m => m.minutesFileDocumentId === id);

                if (!linkedMeeting) {
                    linkedMeeting = currentMeetings.find(m => m.minutesFileStoragePath === storagePath);
                }

                if (linkedMeeting) {
                    // Clear the minutes file reference in the meeting
                    await dispatch(updateMeeting({
                        id: linkedMeeting.id,
                        updates: {
                            minutesFileUrl: null as any,
                            minutesFileName: null as any,
                            minutesFileStoragePath: null as any,
                            minutesFileDocumentId: null as any
                        }
                    }));
                }

                await dispatch(deleteDocument({ id, storagePath }));
            } catch (error) {
                console.error('Error deleting document:', error);
            }
        }
    }, [dispatch]);

    const groupedDocuments = useMemo(() => {
        const groups: Record<string, { title: string; type: 'meeting' | 'project' | 'other'; date: string; documents: Document[]; entityId?: string }> = {};

        docPagination.items.forEach(doc => {
            let key = 'other';
            let title = 'Documents Généraux';
            let type: 'meeting' | 'project' | 'other' = 'other';
            let date = '';
            let entityId = '';

            if (doc.linkedEntityType === 'meeting' && doc.linkedEntityId) {
                // O(1) Lookup
                const meeting = meetingsMap.get(doc.linkedEntityId);
                if (meeting) {
                    key = `meeting-${meeting.id}`;
                    title = `Assemblée: ${meeting.title}`;
                    type = 'meeting';
                    date = meeting.date;
                    entityId = meeting.id;
                } else {
                    title = `Assemblée (Introuvable: ${doc.linkedEntityId})`;
                    key = `meeting-${doc.linkedEntityId}`;
                }
            } else if (doc.linkedEntityType === 'project' && doc.linkedEntityId) {
                // O(1) Lookup
                const project = projectsMap.get(doc.linkedEntityId);
                if (project) {
                    key = `project-${project.id}`;
                    title = `Projet: ${project.name}`;
                    type = 'project';
                    date = project.dateCreated;
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
    }, [docPagination.items, meetingsMap, projectsMap]); // Dependencies updated to use Maps

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
                                        onDelete={user?.role === 'coordinator' ? handleDelete : undefined}
                                        agendaItems={group.type === 'meeting' && group.entityId ? meetingsMap.get(group.entityId)?.agendaItems : undefined}
                                    />
                                </AccordionDetails>
                            </Accordion>
                        ))}

                        {docPagination.totalItems > 10 && (
                            <Box sx={{ mt: 3 }}>
                                <PaginationControls
                                    totalItems={docPagination.totalItems}
                                    page={docPagination.currentPage}
                                    rowsPerPage={10}
                                    onPageChange={(p) => docActions.goToPage(p)}
                                    onRowsPerPageChange={() => {}}
                                    rowsPerPageOptions={[10]}
                                />
                            </Box>
                        )}
                    </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <AccessControl allowedRoles={['coordinator']}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>
                                Ajouter un document
                            </Typography>
                            <DocumentUpload onUploadComplete={() => docActions.refresh()} />
                        </Paper>
                    </AccessControl>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DocumentsPage;
