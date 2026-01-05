import React from 'react';
import { Card, CardContent, Typography, Box, Chip, Avatar, AvatarGroup, LinearProgress } from '@mui/material';
import { AccessTime, Category } from '@mui/icons-material';
import type { Project } from '../../types/project.types';
import { ProjectStatus, Priority } from '../../types/project.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import QuickViewPopover from '../common/QuickViewPopover';

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

    const getStatusLabel = (status: ProjectStatus) => {
        switch (status) {
            case ProjectStatus.COMPLETED: return 'Terminé';
            case ProjectStatus.IN_PROGRESS: return 'En cours';
            case ProjectStatus.BLOCKED: return 'Bloqué';
            case ProjectStatus.PENDING: return 'En attente';
            default: return status;
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

    const getPriorityLabel = (priority: Priority) => {
        switch (priority) {
            case Priority.CRITICAL: return 'Critique';
            case Priority.HIGH: return 'Haute';
            case Priority.MEDIUM: return 'Moyenne';
            case Priority.LOW: return 'Basse';
            default: return priority;
        }
    };

    // Prepare QuickView details
    const quickViewDetails = [
        {
            icon: <Category fontSize="small" />,
            label: 'Catégorie',
            value: project.category || 'Non définie'
        },
        {
            icon: <AccessTime fontSize="small" />,
            label: 'Mis à jour',
            value: project.dateUpdated ? format(new Date(project.dateUpdated), 'd MMM yyyy', { locale: fr }) : 'N/A'
        }
    ];

    const quickViewChips = [
        { label: getStatusLabel(project.status), color: getStatusColor(project.status) as any },
        { label: getPriorityLabel(project.priority), color: 'default' as const }
    ];

    return (
        <QuickViewPopover
            title={project.name}
            subtitle={`Code: ${project.code}`}
            description={project.description}
            details={quickViewDetails}
            chips={quickViewChips}
        >
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
                            <Avatar
                                alt="Coordinateur"
                                sx={{ bgcolor: getPriorityColor(project.priority) }}
                            >
                                {project.code.charAt(0).toUpperCase()}
                            </Avatar>
                        </AvatarGroup>
                    </Box>
                </CardContent>
            </Card>
        </QuickViewPopover>
    );
};

export default ProjectCard;

