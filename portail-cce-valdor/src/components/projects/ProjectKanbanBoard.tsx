import React, { useMemo } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    useDroppable,
    useDraggable
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { Box, Paper, Typography, Chip } from '@mui/material';
import type { Project } from '../../types/project.types';
import { ProjectStatus } from '../../types/project.types';
import { useNavigate } from 'react-router-dom';

const KanbanColumn = ({ id, title, projects, color }: { id: string, title: string, projects: Project[], color: string }) => {
    const { setNodeRef } = useDroppable({ id });

    return (
        <Paper
            ref={setNodeRef}
            sx={{
                flex: 1,
                p: 2,
                bgcolor: '#f4f5f7',
                minHeight: 500,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.875rem' }}>
                    {title}
                </Typography>
                <Chip label={projects.length} size="small" sx={{ bgcolor: 'white', fontWeight: 'bold' }} />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {projects.map((project) => (
                    <DraggableProjectCard key={project.id} project={project} color={color} />
                ))}
            </Box>
        </Paper>
    );
};

const DraggableProjectCard = ({ project, color }: { project: Project, color: string }) => {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: project.id,
        data: { project }
    });

    const navigate = useNavigate();

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    return (
        <Paper
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={() => navigate(`/projects/${project.id}`)}
            sx={{
                p: 2,
                cursor: 'grab',
                borderLeft: `4px solid ${color}`,
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 3 }
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                    {project.code}
                </Typography>
                {project.isUrgent && (
                    <Chip label="Urgent" color="error" size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                )}
            </Box>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ lineHeight: 1.3 }}>
                {project.name}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
                <Chip label={project.category} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            </Box>
        </Paper>
    );
};


interface ProjectKanbanBoardProps {
    projects: Project[];
    onStatusChange: (projectId: string, newStatus: ProjectStatus) => void;
}

const ProjectKanbanBoard: React.FC<ProjectKanbanBoardProps> = ({ projects, onStatusChange }) => {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const columns = useMemo(() => {
        return {
            [ProjectStatus.PENDING]: projects.filter(p => p.status === ProjectStatus.PENDING),
            [ProjectStatus.IN_PROGRESS]: projects.filter(p => p.status === ProjectStatus.IN_PROGRESS),
            [ProjectStatus.TO_CLARIFY]: projects.filter(p => p.status === ProjectStatus.TO_CLARIFY),
            [ProjectStatus.COMPLETED]: projects.filter(p => p.status === ProjectStatus.COMPLETED),
            [ProjectStatus.BLOCKED]: projects.filter(p => p.status === ProjectStatus.BLOCKED),
            [ProjectStatus.FINANCING_RECEIVED]: projects.filter(p => p.status === ProjectStatus.FINANCING_RECEIVED),
        };
    }, [projects]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // Determine new status based on dropped column ID
            const newStatus = over.id as ProjectStatus;

            // Check if valid status
            if (Object.values(ProjectStatus).includes(newStatus)) {
                onStatusChange(active.id as string, newStatus);
            }
        }
    };

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Box sx={{ display: 'flex', gap: 3, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
                <KanbanColumn
                    id={ProjectStatus.PENDING}
                    title="En attente"
                    projects={columns[ProjectStatus.PENDING]}
                    color="#ed6c02" // Orange
                />
                <KanbanColumn
                    id={ProjectStatus.TO_CLARIFY}
                    title="À clarifier"
                    projects={columns[ProjectStatus.TO_CLARIFY]}
                    color="#9c27b0" // Purple
                />
                <KanbanColumn
                    id={ProjectStatus.BLOCKED}
                    title="Bloqué"
                    projects={columns[ProjectStatus.BLOCKED]}
                    color="#d32f2f" // Red
                />
                <KanbanColumn
                    id={ProjectStatus.FINANCING_RECEIVED}
                    title="Financement reçu"
                    projects={columns[ProjectStatus.FINANCING_RECEIVED]}
                    color="#0288d1" // Light Blue
                />
                <KanbanColumn
                    id={ProjectStatus.IN_PROGRESS}
                    title="En cours"
                    projects={columns[ProjectStatus.IN_PROGRESS]}
                    color="#1976d2" // Blue
                />
                <KanbanColumn
                    id={ProjectStatus.COMPLETED}
                    title="Terminé"
                    projects={columns[ProjectStatus.COMPLETED]}
                    color="#2e7d32" // Green
                />
            </Box>
        </DndContext>
    );
};

export default ProjectKanbanBoard;
