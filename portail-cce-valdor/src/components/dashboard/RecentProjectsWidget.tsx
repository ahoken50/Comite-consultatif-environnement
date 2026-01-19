import React from 'react';
import { Card, CardContent, Typography, Box, List, ListItem, ListItemButton, ListItemText, Chip, Avatar } from '@mui/material';
import { History, FolderOpen } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Project } from '../../types/project.types';
import { CategoryLabels, ProjectStatusLabels } from '../../constants';

interface RecentProjectsWidgetProps {
    projects: Project[];
    loading?: boolean;
}

/**
 * Widget displaying recently modified projects (#1.2)
 * Shows the last 5 projects the user has touched
 */
const RecentProjectsWidget: React.FC<RecentProjectsWidgetProps> = ({ projects, loading }) => {
    const navigate = useNavigate();

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'success';
            case 'in_progress': return 'info';
            case 'blocked': return 'error';
            case 'pending': return 'warning';
            default: return 'default';
        }
    };

    if (loading) {
        return (
            <Card sx={{ height: '100%' }}>
                <CardContent>
                    <Typography variant="overline" color="textSecondary" sx={{ fontWeight: 600, letterSpacing: 1 }}>
                        PROJETS RÉCENTS
                    </Typography>
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                        <Typography color="text.secondary">Chargement...</Typography>
                    </Box>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 0 }}>
                <Box sx={{ p: 2, pb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <History color="primary" fontSize="small" />
                        <Typography variant="overline" color="textSecondary" sx={{ fontWeight: 600, letterSpacing: 1 }}>
                            PROJETS RÉCEMMENT MODIFIÉS
                        </Typography>
                    </Box>
                </Box>

                {projects.length === 0 ? (
                    <Box sx={{ p: 2, textAlign: 'center' }}>
                        <FolderOpen color="disabled" sx={{ fontSize: 48, mb: 1 }} />
                        <Typography color="text.secondary" variant="body2">
                            Aucun projet modifié récemment
                        </Typography>
                    </Box>
                ) : (
                    <List sx={{ pt: 0 }}>
                        {projects.slice(0, 5).map((project, index) => (
                            <ListItem
                                key={project.id}
                                disablePadding
                                divider={index < projects.length - 1}
                            >
                                <ListItemButton
                                    onClick={() => navigate(`/projects/${project.id}`)}
                                    sx={{ py: 1.5 }}
                                >
                                    <Avatar
                                        sx={{
                                            bgcolor: 'primary.light',
                                            width: 36,
                                            height: 36,
                                            mr: 2,
                                            fontSize: '0.75rem',
                                            fontWeight: 600
                                        }}
                                    >
                                        {project.code}
                                    </Avatar>
                                    <ListItemText
                                        primary={
                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                {project.name}
                                            </Typography>
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                <Chip
                                                    label={ProjectStatusLabels[project.status] || project.status}
                                                    size="small"
                                                    color={getStatusColor(project.status) as any}
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                                <Typography variant="caption" color="text.secondary">
                                                    {CategoryLabels[project.category] || project.category}
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, whiteSpace: 'nowrap' }}>
                                        {formatDistanceToNow(new Date(project.dateUpdated), { addSuffix: true, locale: fr })}
                                    </Typography>
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                )}
            </CardContent>
        </Card>
    );
};

export default RecentProjectsWidget;
