import React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { CheckCircle, Autorenew, NewReleases, Warning } from '@mui/icons-material';
import StatsCard from '../../components/dashboard/StatsCard';
import AlertsPanel from '../../components/dashboard/AlertsPanel';
import NextMeetingCard from '../../components/dashboard/NextMeetingCard';
import CategoryChart from '../../components/dashboard/CategoryChart';
import ProgressChart from '../../components/dashboard/ProgressChart';
import ActivityFeed from '../../components/dashboard/ActivityFeed';

const Dashboard: React.FC = () => {
    return (
        <Box>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'text.primary', mb: 4 }}>
                Tableau de bord
            </Typography>

            <Grid container spacing={3}>
                {/* Stats Cards */}
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="Projets réalisés" value={8} icon={CheckCircle} color="primary" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="En cours" value={9} icon={Autorenew} color="secondary" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="Nouveaux" value={16} icon={NewReleases} color="warning" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="Urgents" value={2} icon={Warning} color="error" />
                </Grid>

                {/* Alerts & Next Meeting */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <AlertsPanel />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <NextMeetingCard />
                </Grid>

                {/* Charts */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <CategoryChart />
                </Grid>
                <Grid size={{ xs: 12, md: 8 }}>
                    <ProgressChart />
                </Grid>

                {/* Activity Feed */}
                <Grid size={{ xs: 12 }}>
                    <ActivityFeed />
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;
