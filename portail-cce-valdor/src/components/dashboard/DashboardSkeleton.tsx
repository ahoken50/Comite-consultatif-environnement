import React from 'react';
import { Box, Grid, Skeleton, Paper } from '@mui/material';

/**
 * Skeleton loading state for the Dashboard
 * Shows placeholder UI while data loads
 */
const DashboardSkeleton: React.FC = () => {
    return (
        <Box>
            {/* Title */}
            <Skeleton variant="text" width={200} height={40} sx={{ mb: 4 }} />

            <Grid container spacing={3}>
                {/* Stats Cards - 4 cards */}
                {[1, 2, 3, 4].map((i) => (
                    <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                        <Paper sx={{ p: 2 }}>
                            <Skeleton variant="circular" width={40} height={40} />
                            <Skeleton variant="text" width="60%" sx={{ mt: 1 }} />
                            <Skeleton variant="text" width="40%" height={32} />
                        </Paper>
                    </Grid>
                ))}

                {/* Alerts Panel */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <Paper sx={{ p: 2 }}>
                        <Skeleton variant="text" width={150} height={32} sx={{ mb: 2 }} />
                        {[1, 2, 3].map((i) => (
                            <Box key={i} sx={{ display: 'flex', mb: 1, gap: 1 }}>
                                <Skeleton variant="circular" width={24} height={24} />
                                <Skeleton variant="text" width="80%" />
                            </Box>
                        ))}
                    </Paper>
                </Grid>

                {/* Next Meeting Card */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 2 }}>
                        <Skeleton variant="text" width={120} height={28} sx={{ mb: 2 }} />
                        <Skeleton variant="rounded" height={100} />
                    </Paper>
                </Grid>

                {/* Category Chart */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 2 }}>
                        <Skeleton variant="text" width={150} height={28} sx={{ mb: 2 }} />
                        <Skeleton variant="circular" width={200} height={200} sx={{ mx: 'auto' }} />
                    </Paper>
                </Grid>

                {/* Progress Chart */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <Paper sx={{ p: 2 }}>
                        <Skeleton variant="text" width={180} height={28} sx={{ mb: 2 }} />
                        <Skeleton variant="rounded" height={200} />
                    </Paper>
                </Grid>

                {/* Activity Feed */}
                <Grid size={{ xs: 12 }}>
                    <Paper sx={{ p: 2 }}>
                        <Skeleton variant="text" width={150} height={28} sx={{ mb: 2 }} />
                        {[1, 2, 3, 4, 5].map((i) => (
                            <Box key={i} sx={{ display: 'flex', mb: 2, gap: 2 }}>
                                <Skeleton variant="circular" width={40} height={40} />
                                <Box sx={{ flexGrow: 1 }}>
                                    <Skeleton variant="text" width="60%" />
                                    <Skeleton variant="text" width="40%" height={16} />
                                </Box>
                            </Box>
                        ))}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DashboardSkeleton;
