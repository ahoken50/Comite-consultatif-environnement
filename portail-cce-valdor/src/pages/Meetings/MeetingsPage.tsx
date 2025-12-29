import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Box, Typography, Button, Grid, Tabs, Tab } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings, createMeeting, deleteMeeting } from '../../features/meetings/meetingsSlice';
import MeetingCard from '../../components/meetings/MeetingCard';
import MeetingForm from '../../components/meetings/MeetingForm';
import { MeetingStatus } from '../../types/meeting.types';

const MeetingsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [tabValue, setTabValue] = useState(0);

    useEffect(() => {
        dispatch(fetchMeetings());
    }, [dispatch]);

    const handleCreateMeeting = async (data: any) => {
        console.log('MeetingsPage: handleCreateMeeting called with data:', data);
        try {
            const resultAction = await dispatch(createMeeting({
                ...data,
                attendees: [],
                // agendaItems is now part of data
                minutes: '',
            }));

            if (createMeeting.fulfilled.match(resultAction)) {
                console.log('Meeting created successfully:', resultAction.payload);
                setIsFormOpen(false);
            } else {
                if (resultAction.payload) {
                    console.error('Failed to create meeting (payload):', resultAction.payload);
                } else {
                    console.error('Failed to create meeting (error):', resultAction.error);
                }
                alert('Erreur lors de la création de la réunion: ' + (resultAction.error?.message || 'Erreur inconnue'));
            }
        } catch (err) {
            console.error('Unexpected error creating meeting:', err);
            alert('Une erreur inattendue est survenue.');
        }
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
                alert('Erreur lors de la suppression de la réunion.');
            }
        }
    }, [dispatch]);

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
                <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={() => setIsFormOpen(true)}
                >
                    Nouvelle Réunion
                </Button>
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
        </Box>
    );
};

export default MeetingsPage;
