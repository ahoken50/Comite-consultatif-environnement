import React from 'react';
import {
    Card, CardHeader, CardContent, List, ListItem, ListItemButton,
    ListItemIcon, ListItemText, Typography, Chip, Box, Skeleton, Grow
} from '@mui/material';
import {
    PendingActions, Description, RecordVoiceOver, Warning,
    CheckCircle, ArrowForward
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface PendingActionsWidgetProps {
    pendingPVs: number;
    verificationCount: number;
    urgentProjects: number;
    loading: boolean;
}

interface ActionItem {
    icon: React.ReactNode;
    label: string;
    count: number;
    color: string;
    path: string;
}

const PendingActionsWidget: React.FC<PendingActionsWidgetProps> = ({
    pendingPVs,
    verificationCount,
    urgentProjects,
    loading,
}) => {
    const navigate = useNavigate();

    if (loading) {
        return (
            <Card sx={{ height: '100%' }}>
                <CardHeader title={<Skeleton width={200} />} />
                <CardContent>
                    {[1, 2, 3].map(i => (
                        <Skeleton key={i} variant="rectangular" height={48} sx={{ mb: 1, borderRadius: 1 }} />
                    ))}
                </CardContent>
            </Card>
        );
    }

    const actions: ActionItem[] = [
        {
            icon: <Description fontSize="small" />,
            label: 'PV à finaliser',
            count: pendingPVs,
            color: '#8b5cf6',
            path: '/meetings',
        },
        {
            icon: <RecordVoiceOver fontSize="small" />,
            label: 'Vérifications vocales',
            count: verificationCount,
            color: '#f97316',
            path: '/settings',
        },
        {
            icon: <Warning fontSize="small" />,
            label: 'Projets urgents / bloqués',
            count: urgentProjects,
            color: '#ef4444',
            path: '/projects?priority=urgent',
        },
    ].filter(a => a.count > 0);

    const totalActions = actions.reduce((sum, a) => sum + a.count, 0);

    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader
                avatar={<PendingActions color="primary" />}
                title={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>Actions en attente</Typography>
                        {totalActions > 0 && (
                            <Chip
                                label={totalActions}
                                size="small"
                                color="error"
                                sx={{ fontWeight: 600 }}
                            />
                        )}
                    </Box>
                }
                sx={{ pb: 0 }}
            />
            <CardContent sx={{ pt: 1 }}>
                {actions.length === 0 ? (
                    <Grow in timeout={500}>
                        <Box sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                            <CheckCircle sx={{ fontSize: 40, color: '#22c55e', mb: 1 }} />
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                Tout est à jour !
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Aucune action en attente.
                            </Typography>
                        </Box>
                    </Grow>
                ) : (
                    <List disablePadding>
                        {actions.map((action, index) => (
                            <Grow in key={action.label} timeout={300 + index * 150}>
                                <ListItem disablePadding sx={{ mb: 0.5 }}>
                                    <ListItemButton
                                        onClick={() => navigate(action.path)}
                                        sx={{
                                            borderRadius: 2,
                                            border: 1,
                                            borderColor: 'divider',
                                            '&:hover': {
                                                bgcolor: action.color + '08',
                                                borderColor: action.color + '40',
                                            },
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 36, color: action.color }}>
                                            {action.icon}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={
                                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                    {action.label}
                                                </Typography>
                                            }
                                        />
                                        <Chip
                                            label={action.count}
                                            size="small"
                                            sx={{
                                                bgcolor: action.color + '15',
                                                color: action.color,
                                                fontWeight: 700,
                                                mr: 1,
                                            }}
                                        />
                                        <ArrowForward sx={{ fontSize: 16, color: 'text.secondary' }} />
                                    </ListItemButton>
                                </ListItem>
                            </Grow>
                        ))}
                    </List>
                )}
            </CardContent>
        </Card>
    );
};

export default PendingActionsWidget;
