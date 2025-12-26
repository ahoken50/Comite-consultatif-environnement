import React, { useMemo } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { DndContext, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import type { Project } from '../../types/project.types';
import { ProjectStatus } from '../../types/project.types';
import ProjectCard from './ProjectCard';
import { useDroppable } from '@dnd-kit/core';

interface ProjectKanbanProps {
    projects: Project[];
    onProjectClick: (id: string) => void;
    onStatusChange: (projectId: string, newStatus: ProjectStatus) => void;
}

const columns = [
    { id: ProjectStatus.IN_PROGRESS, title: 'En cours', color: '#3b82f6' },
    { id: ProjectStatus.PENDING, title: 'En attente', color: '#f59e0b' },
    { id: ProjectStatus.BLOCKED, title: 'Bloqué', color: '#ef4444' },
    { id: ProjectStatus.COMPLETED, title: 'Réalisé', color: '#10b981' },
];

const KanbanColumn = React.memo(({ id, title, color, projects, onProjectClick }: any) => {
    const { setNodeRef } = useDroppable({ id });

    return (
        <Paper
            ref={setNodeRef}
            sx={{
                flex: 1,
                minWidth: 280,
                bgcolor: 'background.default',
                p: 2,
                borderRadius: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
            }}
        >
            <Box sx={{ borderTop: 3, borderColor: color, pt: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>
                    {title} <Box component="span" sx={{ ml: 1, px: 1, py: 0.25, bgcolor: 'action.hover', borderRadius: 1 }}>{projects.length}</Box>
                </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
                {projects.map((project: Project) => (
                    <ProjectCard key={project.id} project={project} onClick={onProjectClick} />
                ))}
            </Box>
        </Paper>
    );
});

const ProjectKanban: React.FC<ProjectKanbanProps> = ({ projects, onProjectClick }) => {
    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            // In a real implementation with dnd-kit sortable, we'd handle reordering.
            // For now, we just handle dropping into a column (status change).
            // The 'active.id' would be the project ID, and 'over.id' would be the column ID (status).
            // Note: This is a simplified implementation. Proper dnd-kit setup requires Draggable wrappers.
            // For this step, I'm setting up the structure.

            // Assuming active.id is projectId and over.id is status
            // onStatusChange(active.id as string, over.id as ProjectStatus);
        }
    };

    // Optimization: Group projects by status in one pass (O(N)) instead of filtering for each column (O(N*M))
    const projectsByStatus = useMemo(() => {
        const groups: Record<string, Project[]> = {};
        columns.forEach(col => { groups[col.id] = []; });

        projects.forEach(project => {
            if (groups[project.status]) {
                groups[project.status].push(project);
            }
        });

        return groups;
    }, [projects]);

    return (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <Box sx={{ display: 'flex', gap: 3, overflowX: 'auto', pb: 2, height: 'calc(100vh - 200px)' }}>
                {columns.map((col) => (
                    <KanbanColumn
                        key={col.id}
                        id={col.id}
                        title={col.title}
                        color={col.color}
                        projects={projectsByStatus[col.id] || []}
                        onProjectClick={onProjectClick}
                    />
                ))}
            </Box>
        </DndContext>
    );
};

export default React.memo(ProjectKanban);
