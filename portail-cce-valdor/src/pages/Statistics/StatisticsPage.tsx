import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import CategoryChart from '../../components/dashboard/CategoryChart';
import ProgressChart from '../../components/dashboard/ProgressChart';
import StatsCard from '../../components/dashboard/StatsCard';
import DashboardSkeleton from '../../components/dashboard/DashboardSkeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import { CheckCircle, Autorenew, NewReleases, TrendingUp } from '@mui/icons-material';

const StatisticsPage: React.FC = () => {
    const { stats, categoryData, progressData, loading } = useDashboardData();

    if (loading) {
        return <DashboardSkeleton />;
    }

    const totalProjects = stats.projectsCompleted + stats.projectsInProgress + stats.projectsNew + stats.projectsUrgent;

    return (
        <Box>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'text.primary', mb: 4 }}>
                📊 Statistiques
            </Typography>

            {/* Summary Stats */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="Total projets" value={totalProjects} icon={TrendingUp} color="primary" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="Projets réalisés" value={stats.projectsCompleted} icon={CheckCircle} color="primary" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="En cours" value={stats.projectsInProgress} icon={Autorenew} color="secondary" />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatsCard title="Nouveaux" value={stats.projectsNew} icon={NewReleases} color="warning" />
                </Grid>
            </Grid>

            {/* Charts */}
            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Box sx={{ height: 420 }}>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                            Répartition par catégorie
                        </Typography>
                        <CategoryChart data={categoryData} />
                    </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Box sx={{ height: 420 }}>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                            Progression mensuelle
                        </Typography>
                        <ProgressChart data={progressData} />
                    </Box>
                </Grid>
            </Grid>
        </Box>
    );
};

export default StatisticsPage;
