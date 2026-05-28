import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Grid, Typography, Alert } from '@mui/material';
import { CheckCircle, Autorenew, NewReleases, Warning } from '@mui/icons-material';
import StatsCard from '../../components/dashboard/StatsCard';
import AlertsPanel from '../../components/dashboard/AlertsPanel';
import NextMeetingCard from '../../components/dashboard/NextMeetingCard';
import ActivityFeed from '../../components/dashboard/ActivityFeed';
import RecentProjectsWidget from '../../components/dashboard/RecentProjectsWidget';
import ExpiringDocumentsWidget from '../../components/documents/ExpiringDocumentsWidget';
import DashboardSkeleton from '../../components/dashboard/DashboardSkeleton';
import AIHealthWidget from '../../components/dashboard/AIHealthWidget';
import VoiceAlertsWidget from '../../components/dashboard/VoiceAlertsWidget';
import PendingActionsWidget from '../../components/dashboard/PendingActionsWidget';
import AssistantChatWidget from '../../components/dashboard/AssistantChatWidget';
import { useDashboardData } from '../../hooks/useDashboardData';

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const {
        stats, alerts, nextMeeting, activities, recentProjects,
        voiceAlerts, pendingPVs, verificationCount,
        loading, error
    } = useDashboardData();

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
                {/* Row 1: Stats Cards */}
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

                {/* Row 2: Pending Actions & Next Meeting */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <PendingActionsWidget
                        pendingPVs={pendingPVs}
                        verificationCount={verificationCount}
                        urgentProjects={stats.projectsUrgent}
                        loading={false}
                    />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <NextMeetingCard meeting={nextMeeting} />
                </Grid>

                {/* Row 3: AI Health, Voice Alerts & Alerts Panel */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <AIHealthWidget />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <VoiceAlertsWidget alerts={voiceAlerts} loading={false} />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <AlertsPanel alerts={alerts} />
                </Grid>

                {/* Row 4: Assistant Chat & Activity Feed */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <AssistantChatWidget />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <ActivityFeed activities={activities} />
                </Grid>

                {/* Row 5: Recent Projects & Expiring Documents */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <RecentProjectsWidget projects={recentProjects} loading={loading} />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <ExpiringDocumentsWidget daysThreshold={30} />
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;

