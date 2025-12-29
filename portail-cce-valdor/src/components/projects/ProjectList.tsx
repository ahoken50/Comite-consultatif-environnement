import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    IconButton,
    Typography,
    Box
} from '@mui/material';
import { Edit, Delete, Visibility } from '@mui/icons-material';
import type { Project } from '../../types/project.types';
import { ProjectStatus, Priority } from '../../types/project.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectListProps {
    projects: Project[];
    onView: (id: string) => void;
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
}

const ProjectList: React.FC<ProjectListProps> = ({ projects, onView, onEdit, onDelete }) => {
    const getStatusColor = (status: ProjectStatus) => {
        switch (status) {
            case ProjectStatus.COMPLETED: return 'success';
            case ProjectStatus.IN_PROGRESS: return 'primary';
            case ProjectStatus.BLOCKED: return 'error';
            case ProjectStatus.PENDING: return 'warning';
            default: return 'default';
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

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: 1 }}>
            <Table sx={{ minWidth: 650 }} aria-label="projects table">
                <TableHead sx={{ bgcolor: 'background.default' }}>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Projet</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Catégorie</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Statut</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Priorité</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Mise à jour</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {projects.map((project) => (
                        <TableRow
                            key={project.id}
                            sx={{ '&:last-child td, &:last-child th': { border: 0 }, hover: { bgcolor: 'action.hover' } }}
                        >
                            <TableCell component="th" scope="row">
                                <Typography variant="body2" fontWeight={600}>{project.code}</Typography>
                            </TableCell>
                            <TableCell>
                                <Typography variant="body2" fontWeight={500}>{project.name}</Typography>
                                {project.isUrgent && (
                                    <Chip label="URGENT" size="small" color="error" sx={{ height: 16, fontSize: '0.6rem', ml: 1 }} />
                                )}
                            </TableCell>
                            <TableCell>
                                <Chip label={project.category} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>
                                <Chip
                                    label={project.status}
                                    size="small"
                                    color={getStatusColor(project.status) as any}
                                    sx={{ textTransform: 'capitalize' }}
                                />
                            </TableCell>
                            <TableCell>
                                {getPriorityLabel(project.priority)}
                            </TableCell>
                            <TableCell>
                                {project.dateUpdated ? format(new Date(project.dateUpdated), 'd MMM yyyy', { locale: fr }) : '-'}
                            </TableCell>
                            <TableCell align="right">
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <IconButton
                                        size="small"
                                        onClick={() => onView(project.id)}
                                        color="info"
                                        aria-label={`Voir le projet ${project.name}`}
                                    >
                                        <Visibility fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                        size="small"
                                        onClick={() => onEdit(project.id)}
                                        color="primary"
                                        aria-label={`Modifier le projet ${project.name}`}
                                    >
                                        <Edit fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                        size="small"
                                        onClick={() => onDelete(project.id)}
                                        color="error"
                                        aria-label={`Supprimer le projet ${project.name}`}
                                    >
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </Box>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default ProjectList;
