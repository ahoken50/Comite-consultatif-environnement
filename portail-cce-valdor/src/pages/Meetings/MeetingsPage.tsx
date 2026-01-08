import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Box, Typography, Button, Grid, Tabs, Tab } from '@mui/material';
import { Add, AutoAwesome } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings, createMeeting, deleteMeeting } from '../../features/meetings/meetingsSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import MeetingCard from '../../components/meetings/MeetingCard';
import MeetingForm from '../../components/meetings/MeetingForm';
import SmartPlanningDialog from '../../components/meetings/SmartPlanningDialog';
import { MeetingStatus } from '../../types/meeting.types';
import { useToast } from '../../hooks/useToast';

const MeetingsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { showError } = useToast();
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSmartPlanningOpen, setIsSmartPlanningOpen] = useState(false);
    const [tabValue, setTabValue] = useState(0);

    useEffect(() => {
        dispatch(fetchMeetings());
    }, [dispatch]);

    const handleCreateMeeting = async (data: any) => {
        try {
            const resultAction = await dispatch(createMeeting({
                ...data,
                // Ensure array even if not provided
                attendees: data.attendees || [],
                // agendaItems is part of data from SmartPlanning
                minutes: '',
            }));

            if (createMeeting.fulfilled.match(resultAction)) {
                setIsFormOpen(false);
                setIsSmartPlanningOpen(false);

                // Index the new meeting in Typesense
                // We create a temporary object for indexing since we don't have the full object returned easily here
                // Ideal implementation would wait for fetchMeetings or use the returned payload if available
                const newMeetingId = resultAction.payload.id;
                if (newMeetingId) {
                    import('../../services/typesenseService').then(({ indexMeeting }) => {
                        indexMeeting({
                            id: newMeetingId,
                            title: data.title,
                            date: data.date,
                            dateTimestamp: data.date ? Math.floor(new Date(data.date).getTime() / 1000) : 0,
                            type: data.type,
                            status: data.status,
                            minutes: '',
                            agendaItemTitles: data.agendaItems?.map((i: any) => i.title) || [],
                            resolutions: [],
                            attendeeNames: data.attendees?.map((a: any) => a.name) || []
                        }).catch(err => console.error('Failed to index new meeting:', err));
                    });
                }
            } else {
                showError('Erreur lors de la création de la réunion');
            }
        } catch (err) {
            console.error('Unexpected error creating meeting:', err);
            showError('Une erreur inattendue est survenue.');
        }
    };

    const handleOpenSmartPlanning = () => {
        dispatch(fetchProjects());
        setIsSmartPlanningOpen(true);
    };

    // Optimize: Wrap handlers in useCallback to ensure referential stability
    const handleMeetingClick = useCallback((id: string) => {
        navigate(`/meetings/${id}`);
    }, [navigate]);

    const handleDeleteMeeting = useCallback(async (id: string) => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer cette réunion ?')) {
            try {
                await dispatch(deleteMeeting(id)).unwrap();
            } catch (err) {
                console.error('Failed to delete meeting:', err);
                showError('Erreur lors de la suppression de la réunion.');
            }
        }
    }, [dispatch, showError]);

    // Optimize: Memoize filtered lists to prevent recalculation on every render
    const upcomingMeetings = useMemo(() => meetings.filter(m =>
        m.status === MeetingStatus.SCHEDULED || m.status === MeetingStatus.IN_PROGRESS
    ), [meetings]);

    const pastMeetings = useMemo(() => meetings.filter(m =>
        m.status === MeetingStatus.COMPLETED || m.status === MeetingStatus.CANCELLED
    ), [meetings]);

    const displayedMeetings = tabValue === 0 ? upcomingMeetings : pastMeetings;

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    Réunions
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                        variant="outlined"
                        startIcon={<AutoAwesome />}
                        onClick={handleOpenSmartPlanning}
                    >
                        Assistant Planification
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={() => setIsFormOpen(true)}
                    >
                        Nouvelle Réunion
                    </Button>
                </Box>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                    <Tab label={`À venir (${upcomingMeetings.length})`} />
                    <Tab label="Passées" />
                </Tabs>
            </Box>

            <Grid container spacing={3}>
                {displayedMeetings.map((meeting) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={meeting.id}>
                        <MeetingCard
                            meeting={meeting}
                            onClick={handleMeetingClick}
                            onEdit={handleMeetingClick}
                            onDelete={handleDeleteMeeting}
                        />
                    </Grid>
                ))}
                {displayedMeetings.length === 0 && (
                    <Grid size={{ xs: 12 }}>
                        <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                            Aucune réunion trouvée.
                        </Typography>
                    </Grid>
                )}
            </Grid>

            <MeetingForm
                open={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={handleCreateMeeting}
            />

            <SmartPlanningDialog
                open={isSmartPlanningOpen}
                onClose={() => setIsSmartPlanningOpen(false)}
                onConfirm={handleCreateMeeting}
            />
        </Box>
    );
};

export default MeetingsPage;
