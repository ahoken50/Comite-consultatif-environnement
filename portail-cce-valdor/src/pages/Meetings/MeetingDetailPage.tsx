import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { fetchDocumentsByEntity, deleteDocument } from '../../features/documents/documentsSlice';
import AgendaBuilder from '../../components/meetings/AgendaBuilder';
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
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const meeting = useSelector((state: RootState) =>
        state.meetings.items.find(m => m.id === id)
    );
    const { items: documents } = useSelector((state: RootState) => state.documents);
    const [tabValue, setTabValue] = useState(0);

    useEffect(() => {
        if (id) {
            dispatch(fetchDocumentsByEntity({ entityId: id, entityType: 'meeting' }));
        }
    }, [dispatch, id]);

    if (!meeting) {
        return <Typography>Réunion non trouvée</Typography>;
    }

    const handleAgendaUpdate = (newItems: AgendaItem[]) => {
        if (id) {
            dispatch(updateMeeting({ id, updates: { agendaItems: newItems } }));
        }
    };

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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
                            <Chip label={meeting.type} variant="outlined" />
                            <Chip label={meeting.status} color="primary" />
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
                    />
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <Typography color="text.secondary">Éditeur de procès-verbal à venir...</Typography>
                </TabPanel>

                <TabPanel value={tabValue} index={2}>
                    <Typography color="text.secondary">Gestion des présences à venir...</Typography>
                </TabPanel>

                <TabPanel value={tabValue} index={3}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Typography variant="h6" gutterBottom>Documents de la réunion</Typography>
                            <DocumentList
                                documents={documents.filter(d => d.linkedEntityId === meeting.id)}
                                onDelete={(docId, path) => dispatch(deleteDocument({ id: docId, storagePath: path }))}
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
