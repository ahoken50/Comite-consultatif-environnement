/**
 * Skeleton Loaders
 * Loading state components for better perceived performance
 */

import React from 'react';
import { Box, Skeleton, Card, CardContent, Grid } from '@mui/material';

// ============================================
// CARD SKELETONS
// ============================================

/**
 * Skeleton for a single card (meeting, project, etc.)
 */
export const CardSkeleton: React.FC<{ height?: number }> = ({ height = 180 }) => (
    <Card sx={{ height, mb: 2 }}>
        <CardContent>
            <Skeleton variant="text" width="60%" height={32} sx={{ mb: 1 }} />
            <Skeleton variant="text" width="80%" height={20} />
            <Skeleton variant="text" width="40%" height={20} />
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                <Skeleton variant="circular" width={32} height={32} />
                <Skeleton variant="circular" width={32} height={32} />
            </Box>
        </CardContent>
    </Card>
);

/**
 * Skeleton for a grid of cards
 */
export const CardGridSkeleton: React.FC<{ count?: number; columns?: number }> = ({
    count = 6,
    columns = 3
}) => (
    <Grid container spacing={2}>
        {Array.from({ length: count }).map((_, i) => (
            <Grid size={{ xs: 12, sm: 6, md: 12 / columns }} key={i}>
                <CardSkeleton />
            </Grid>
        ))}
    </Grid>
);

// ============================================
// LIST SKELETONS
// ============================================

/**
 * Skeleton for a list item
 */
export const ListItemSkeleton: React.FC = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', py: 1.5, px: 2 }}>
        <Skeleton variant="circular" width={40} height={40} sx={{ mr: 2 }} />
        <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="50%" height={24} />
            <Skeleton variant="text" width="30%" height={18} />
        </Box>
        <Skeleton variant="rectangular" width={80} height={32} sx={{ borderRadius: 1 }} />
    </Box>
);

/**
 * Skeleton for a list of items
 */
export const ListSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
    <Box>
        {Array.from({ length: count }).map((_, i) => (
            <React.Fragment key={i}>
                <ListItemSkeleton />
                {i < count - 1 && (
                    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />
                )}
            </React.Fragment>
        ))}
    </Box>
);

// ============================================
// TABLE SKELETONS
// ============================================

/**
 * Skeleton for a table row
 */
export const TableRowSkeleton: React.FC<{ columns?: number }> = ({ columns = 5 }) => (
    <Box sx={{ display: 'flex', py: 1.5, px: 2, gap: 2 }}>
        {Array.from({ length: columns }).map((_, i) => (
            <Skeleton
                key={i}
                variant="text"
                sx={{ flex: i === 0 ? 2 : 1 }}
                height={24}
            />
        ))}
    </Box>
);

/**
 * Skeleton for a table
 */
export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({
    rows = 5,
    columns = 5
}) => (
    <Box>
        {/* Header */}
        <Box sx={{
            display: 'flex',
            py: 1.5,
            px: 2,
            gap: 2,
            bgcolor: 'action.hover',
            borderRadius: '8px 8px 0 0'
        }}>
            {Array.from({ length: columns }).map((_, i) => (
                <Skeleton
                    key={i}
                    variant="text"
                    sx={{ flex: i === 0 ? 2 : 1 }}
                    height={20}
                />
            ))}
        </Box>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} columns={columns} />
        ))}
    </Box>
);

// ============================================
// DASHBOARD SKELETONS
// ============================================

/**
 * Skeleton for a stats card
 */
export const StatCardSkeleton: React.FC = () => (
    <Card sx={{ p: 2 }}>
        <Skeleton variant="text" width="40%" height={20} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="60%" height={40} />
    </Card>
);

/**
 * Skeleton for the dashboard
 */
export const DashboardSkeleton: React.FC = () => (
    <Box>
        {/* Stats Row */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
            {Array.from({ length: 4 }).map((_, i) => (
                <Grid size={{ xs: 6, md: 3 }} key={i}>
                    <StatCardSkeleton />
                </Grid>
            ))}
        </Grid>

        {/* Charts Row */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, md: 8 }}>
                <Card sx={{ p: 2, height: 300 }}>
                    <Skeleton variant="text" width="30%" height={24} sx={{ mb: 2 }} />
                    <Skeleton variant="rectangular" width="100%" height={240} />
                </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
                <Card sx={{ p: 2, height: 300 }}>
                    <Skeleton variant="text" width="50%" height={24} sx={{ mb: 2 }} />
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Skeleton variant="circular" width={200} height={200} />
                    </Box>
                </Card>
            </Grid>
        </Grid>

        {/* Lists Row */}
        <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
                <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2 }} />
                    <ListSkeleton count={3} />
                </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
                <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2 }} />
                    <ListSkeleton count={3} />
                </Card>
            </Grid>
        </Grid>
    </Box>
);

// ============================================
// FORM SKELETONS
// ============================================

/**
 * Skeleton for a form field
 */
export const FormFieldSkeleton: React.FC = () => (
    <Box sx={{ mb: 2 }}>
        <Skeleton variant="text" width="30%" height={20} sx={{ mb: 0.5 }} />
        <Skeleton variant="rectangular" width="100%" height={56} sx={{ borderRadius: 1 }} />
    </Box>
);

/**
 * Skeleton for a form
 */
export const FormSkeleton: React.FC<{ fields?: number }> = ({ fields = 4 }) => (
    <Box>
        {Array.from({ length: fields }).map((_, i) => (
            <FormFieldSkeleton key={i} />
        ))}
        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            <Skeleton variant="rectangular" width={100} height={40} sx={{ borderRadius: 1 }} />
            <Skeleton variant="rectangular" width={100} height={40} sx={{ borderRadius: 1 }} />
        </Box>
    </Box>
);

// ============================================
// DETAIL VIEW SKELETONS
// ============================================

/**
 * Skeleton for a meeting/project detail view
 */
export const DetailViewSkeleton: React.FC = () => (
    <Box>
        {/* Header */}
        <Box sx={{ mb: 3 }}>
            <Skeleton variant="text" width="60%" height={40} sx={{ mb: 1 }} />
            <Box sx={{ display: 'flex', gap: 1 }}>
                <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 2 }} />
                <Skeleton variant="rectangular" width={100} height={24} sx={{ borderRadius: 2 }} />
            </Box>
        </Box>

        {/* Content sections */}
        <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 8 }}>
                <Card sx={{ p: 2, mb: 2 }}>
                    <Skeleton variant="text" width="30%" height={24} sx={{ mb: 2 }} />
                    <Skeleton variant="text" width="100%" height={20} />
                    <Skeleton variant="text" width="90%" height={20} />
                    <Skeleton variant="text" width="95%" height={20} />
                    <Skeleton variant="text" width="70%" height={20} />
                </Card>
                <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width="25%" height={24} sx={{ mb: 2 }} />
                    <ListSkeleton count={4} />
                </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
                <Card sx={{ p: 2, mb: 2 }}>
                    <Skeleton variant="text" width="50%" height={24} sx={{ mb: 2 }} />
                    <FormFieldSkeleton />
                    <FormFieldSkeleton />
                </Card>
            </Grid>
        </Grid>
    </Box>
);

// ============================================
// AGENDA ITEM SKELETON
// ============================================

/**
 * Skeleton for an agenda item in the editor
 */
export const AgendaItemSkeleton: React.FC = () => (
    <Card sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Skeleton variant="circular" width={32} height={32} sx={{ mr: 1 }} />
            <Skeleton variant="text" width="50%" height={28} />
        </Box>
        <Skeleton variant="rectangular" width="100%" height={100} sx={{ borderRadius: 1, mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 1 }}>
            <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 1 }} />
            <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 1 }} />
        </Box>
    </Card>
);

export default {
    CardSkeleton,
    CardGridSkeleton,
    ListItemSkeleton,
    ListSkeleton,
    TableRowSkeleton,
    TableSkeleton,
    StatCardSkeleton,
    DashboardSkeleton,
    FormFieldSkeleton,
    FormSkeleton,
    DetailViewSkeleton,
    AgendaItemSkeleton
};
