import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Grid, Typography, Alert } from '@mui/material';
import { CheckCircle, Autorenew, NewReleases, Warning } from '@mui/icons-material';
import StatsCard from '../../components/dashboard/StatsCard';
import AlertsPanel from '../../components/dashboard/AlertsPanel';
import NextMeetingCard from '../../components/dashboard/NextMeetingCard';
import CategoryChart from '../../components/dashboard/CategoryChart';
import ProgressChart from '../../components/dashboard/ProgressChart';
import ActivityFeed from '../../components/dashboard/ActivityFeed';
import DashboardSkeleton from '../../components/dashboard/DashboardSkeleton';
import { useDashboardData } from '../../hooks/useDashboardData';

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const { stats, alerts, nextMeeting, categoryData, progressData, activities, loading, error } = useDashboardData();

    if (loading) {
        return <DashboardSkeleton />;
    }

    if (error) {
        return (
            <Box p={3}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );
    }

    return (
        <Box>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'text.primary', mb: 4 }}>
                Tableau de bord
            </Typography>

            <Grid container spacing={3}>
                {/* Stats Cards */}
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box onClick={() => navigate('/projects?status=completed')} sx={{ cursor: 'pointer', height: '100%' }}>
                        <StatsCard title="Projets réalisés" value={stats.projectsCompleted} icon={CheckCircle} color="primary" />
                    </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box onClick={() => navigate('/projects?status=in_progress')} sx={{ cursor: 'pointer', height: '100%' }}>
                        <StatsCard title="En cours" value={stats.projectsInProgress} icon={Autorenew} color="secondary" />
                    </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box onClick={() => navigate('/projects?status=pending')} sx={{ cursor: 'pointer', height: '100%' }}>
                        <StatsCard title="Nouveaux" value={stats.projectsNew} icon={NewReleases} color="warning" />
                    </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box onClick={() => navigate('/projects?priority=urgent')} sx={{ cursor: 'pointer', height: '100%' }}>
                        <StatsCard title="Urgents" value={stats.projectsUrgent} icon={Warning} color="error" />
                    </Box>
                </Grid>

                {/* Alerts & Next Meeting */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <AlertsPanel alerts={alerts} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <NextMeetingCard meeting={nextMeeting} />
                </Grid>

                {/* Charts */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <CategoryChart data={categoryData} />
                </Grid>
                <Grid size={{ xs: 12, md: 8 }}>
                    <ProgressChart data={progressData} />
                </Grid>

                {/* Activity Feed */}
                <Grid size={{ xs: 12 }}>
                    <ActivityFeed activities={activities} />
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;
