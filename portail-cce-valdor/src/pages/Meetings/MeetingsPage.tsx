import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, Grid, Tabs, Tab } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings, createMeeting } from '../../features/meetings/meetingsSlice';
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
        await dispatch(createMeeting({
            ...data,
            attendees: [],
            agendaItems: [],
            minutes: '',
        }));
        setIsFormOpen(false);
    };

    const handleMeetingClick = (id: string) => {
        navigate(`/meetings/${id}`);
    };

    const upcomingMeetings = meetings.filter(m =>
        m.status === MeetingStatus.SCHEDULED || m.status === MeetingStatus.IN_PROGRESS
    );

    const pastMeetings = meetings.filter(m =>
        m.status === MeetingStatus.COMPLETED || m.status === MeetingStatus.CANCELLED
    );

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
                    <Grid item xs={12} sm={6} md={4} key={meeting.id}>
                        <MeetingCard
                            meeting={meeting}
                            onClick={handleMeetingClick}
                            onEdit={(id) => console.log('Edit', id)}
                            onDelete={(id) => console.log('Delete', id)}
                        />
                    </Grid>
                ))}
                {displayedMeetings.length === 0 && (
                    <Grid item xs={12}>
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
