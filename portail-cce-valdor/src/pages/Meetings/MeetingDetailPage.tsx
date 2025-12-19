import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useMeetingSubscription } from '../../hooks/useMeetingSubscription';
import {
    Box,
    Typography,
    Button,
    Paper,
    Tabs,
    Tab,
    Divider,
    Chip,
    Grid
} from '@mui/material';
import { ArrowBack, CalendarToday, LocationOn } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { updateMeeting } from '../../features/meetings/meetingsSlice';
import { fetchDocumentsByEntity, deleteDocument, updateDocument } from '../../features/documents/documentsSlice';
import AgendaBuilder from '../../components/meetings/AgendaBuilder';
import MinutesEditor from '../../components/meetings/MinutesEditor';
import AttendanceManager from '../../components/meetings/AttendanceManager';
import MeetingForm from '../../components/meetings/MeetingForm';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';
import type { AgendaItem } from '../../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

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
            id={`meeting-tabpanel-${index}`}
            aria-labelledby={`meeting-tab-${index}`}
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

const MeetingDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    useMeetingSubscription(id);
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const meeting = useSelector((state: RootState) =>
        state.meetings.items.find(m => m.id === id)
    );
    const { items: documents } = useSelector((state: RootState) => state.documents);
    const [tabValue, setTabValue] = useState(0);

    const location = useLocation();

    useEffect(() => {
        if (id) {
            dispatch(fetchDocumentsByEntity({ entityId: id, entityType: 'meeting' }));
        }
    }, [dispatch, id]);

    useEffect(() => {
        if (location.state && (location.state as any).tab !== undefined) {
            setTabValue((location.state as any).tab);
        }
    }, [location.state]);



    const handleAgendaUpdate = (newItems: AgendaItem[]) => {
        if (id) {
            dispatch(updateMeeting({ id, updates: { agendaItems: newItems } }));
        }
    };

    const handleDocumentUnlink = (docId: string) => {
        // Unlink by setting agendaItemId to null (or we could use deleteField if preferred, but null is safer for now if type allows)
        // Since API uses Partial<Document>, and agendaItemId is string | undefined.
        // We probably want to update it to be 'undefined' or empty.
        // However, updating to undefined usually means "no change" in many update logics unless explicit.
        // Let's rely on the fact that Firestore treats null as a value, or we might need a specific sentinel if we really want to remove the field.
        // For this app, let's try setting it to null (casted as any if needed, or if the type allows null).
        // The type is `agendaItemId?: string`. So strictly it shouldn't be null.
        // But Firestore can store null.
        dispatch(updateDocument({ id: docId, updates: { agendaItemId: null as any } }));
    };

    const handleDocumentDelete = (docId: string, storagePath: string) => {
        dispatch(deleteDocument({ id: docId, storagePath }));
    };

    // Patch: Ensure all agenda items have IDs (fixes legacy data issue)
    useEffect(() => {
        if (meeting && meeting.agendaItems) {
            const itemsWithoutIds = meeting.agendaItems.filter(item => !item.id);
            if (itemsWithoutIds.length > 0) {
                const patchedItems = meeting.agendaItems.map((item, index) => ({
                    ...item,
                    id: item.id || `patched-${Date.now()}-${index}`
                }));
                dispatch(updateMeeting({ id: meeting.id, updates: { agendaItems: patchedItems } }));
            }
        }
    }, [meeting, dispatch]);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // Early return moved to after all hooks to satisfy Rules of Hooks
    if (!meeting) {
        return <Typography>Réunion non trouvée</Typography>;
    }

    const handleMeetingUpdate = (updatedData: any) => {
        if (id) {
            dispatch(updateMeeting({
                id,
                updates: {
                    ...updatedData,
                    // Ensure we don't overwrite agenda items if they weren't part of the form data explicitly, 
                    // though MeetingForm includes them.
                    agendaItems: updatedData.agendaItems
                }
            }));
            setIsEditModalOpen(false);
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Button
                    startIcon={<ArrowBack />}
                    onClick={() => navigate('/meetings')}
                >
                    Retour aux réunions
                </Button>
                <Button
                    variant="contained"
                    onClick={() => setIsEditModalOpen(true)}
                >
                    Modifier la réunion
                </Button>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box>
                        <Typography variant="h4" fontWeight={700} gutterBottom>
                            {meeting.title}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                            <Chip label={meeting.type === 'regular' ? 'Régulière' : meeting.type === 'special' ? 'Spéciale' : 'Urgence'} variant="outlined" />
                            <Chip label={meeting.status === 'scheduled' ? 'Planifiée' : meeting.status === 'in_progress' ? 'En cours' : meeting.status === 'completed' ? 'Terminée' : 'Annulée'} color="primary" />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 3, color: 'text.secondary' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CalendarToday fontSize="small" />
                                <Typography variant="body2">
                                    {format(new Date(meeting.date), 'd MMMM yyyy à HH:mm', { locale: fr })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LocationOn fontSize="small" />
                                <Typography variant="body2">{meeting.location}</Typography>
                            </Box>
                        </Box>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                        <Tab label="Ordre du jour" />
                        <Tab label="Procès-verbal" />
                        <Tab label="Présences" />
                        <Tab label="Documents" />
                    </Tabs>
                </Box>

                <TabPanel value={tabValue} index={0}>
                    <AgendaBuilder
                        items={meeting.agendaItems || []}
                        onItemsChange={handleAgendaUpdate}
                        meetingId={meeting.id}
                        meeting={meeting}
                        documents={documents.filter(d => d.linkedEntityId === meeting.id)}
                        onDocumentUpload={() => dispatch(fetchDocumentsByEntity({ entityId: meeting.id, entityType: 'meeting' }))}
                        initialAgendaItemId={(location.state as any)?.agendaItemId}
                        onDocumentUnlink={handleDocumentUnlink}
                        onDocumentDelete={handleDocumentDelete}
                    />
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <MinutesEditor
                        meeting={meeting}
                        onUpdate={handleMeetingUpdate}
                    />
                </TabPanel>

                <TabPanel value={tabValue} index={2}>
                    <AttendanceManager
                        meeting={meeting}
                        onUpdate={handleMeetingUpdate}
                    />
                </TabPanel>

                <TabPanel value={tabValue} index={3}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Typography variant="h6" gutterBottom>Documents de la réunion</Typography>
                            <DocumentList
                                documents={documents.filter(d => d.linkedEntityId === meeting.id)}
                                onDelete={(docId, path) => dispatch(deleteDocument({ id: docId, storagePath: path }))}
                                agendaItems={meeting.agendaItems}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Typography variant="h6" gutterBottom>Ajouter</Typography>
                            <DocumentUpload
                                linkedEntityId={meeting.id}
                                linkedEntityType="meeting"
                                onUploadComplete={() => dispatch(fetchDocumentsByEntity({ entityId: meeting.id, entityType: 'meeting' }))}
                            />
                        </Grid>
                    </Grid>
                </TabPanel>
            </Paper>

            {isEditModalOpen && (
                <MeetingForm
                    open={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    onSubmit={handleMeetingUpdate}
                    initialData={meeting}
                />
            )}
        </Box>
    );
};

export default MeetingDetailPage;
