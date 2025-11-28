import React from 'react';
import { Card, CardContent, Typography, Box, Chip, Avatar, AvatarGroup, LinearProgress } from '@mui/material';
import { Project, ProjectStatus, Priority } from '../../types/project.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectCardProps {
    project: Project;
    onClick: (id: string) => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onClick }) => {
    const getStatusColor = (status: ProjectStatus) => {
        switch (status) {
            case ProjectStatus.COMPLETED: return 'success';
            case ProjectStatus.IN_PROGRESS: return 'primary';
            case ProjectStatus.BLOCKED: return 'error';
            case ProjectStatus.PENDING: return 'warning';
            default: return 'default';
        }
    };

    const getPriorityColor = (priority: Priority) => {
        switch (priority) {
            case Priority.CRITICAL: return '#ef4444'; // Red 500
            case Priority.HIGH: return '#f97316'; // Orange 500
            case Priority.MEDIUM: return '#eab308'; // Yellow 500
            case Priority.LOW: return '#22c55e'; // Green 500
            default: return '#9ca3af';
        }
    };

    return (
        <Card
            onClick={() => onClick(project.id)}
            sx={{
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 4
                },
                position: 'relative',
                overflow: 'visible'
            }}
        >
            {/* Priority Indicator Strip */}
            <Box sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                bgcolor: getPriorityColor(project.priority),
                borderTopLeftRadius: 12,
                borderBottomLeftRadius: 12
            }} />

            <CardContent sx={{ pl: 3 }}> {/* Extra padding for strip */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Chip
                        label={project.code}
                        size="small"
                        variant="outlined"
                        sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                    />
                    {project.isUrgent && (
                        <Chip label="URGENT" size="small" color="error" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }} />
                    )}
                </Box>

                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, mb: 1 }}>
                    {project.name}
                </Typography>

                <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" color="textSecondary">Progression</Typography>
                        <Typography variant="caption" color="textPrimary" fontWeight={600}>{project.completionPercentage}%</Typography>
                    </Box>
                    <LinearProgress
                        variant="determinate"
                        value={project.completionPercentage}
                        color={getStatusColor(project.status) as any}
                        sx={{ height: 6, borderRadius: 3 }}
                    />
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="textSecondary">
                        {project.estimatedCompletionDate ? format(new Date(project.estimatedCompletionDate), 'd MMM', { locale: fr }) : 'Aucune date'}
                    </Typography>

                    <AvatarGroup max={3} sx={{ '& .MuiAvatar-root': { width: 24, height: 24, fontSize: '0.75rem' } }}>
                        {/* Placeholder for coordinator/members */}
                        <Avatar alt="Coordinator" src="/static/images/avatar/1.jpg" />
                    </AvatarGroup>
                </Box>
            </CardContent>
        </Card>
    );
};

export default ProjectCard;
