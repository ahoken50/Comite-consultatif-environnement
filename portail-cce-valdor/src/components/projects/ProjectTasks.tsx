import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    TextField,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Checkbox,
    IconButton,
    Paper,
    LinearProgress,
    Chip,
    Divider
} from '@mui/material';
import { Add, Delete, CalendarToday } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import type { Project } from '../../types/project.types';
import type { ProjectTask } from '../../types/task.types';
import { fetchProjectTasks, addTask, updateTask, deleteTask } from '../../features/projects/projectsSlice';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectTasksProps {
    project: Project;
}

const ProjectTasks: React.FC<ProjectTasksProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const tasks = useSelector((state: RootState) => state.projects.tasksByProjectId[project.id] || []);
    const [newTaskDescription, setNewTaskDescription] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    useEffect(() => {
        dispatch(fetchProjectTasks(project.id));
    }, [dispatch, project.id]);

    const handleAddTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskDescription.trim() || !user) return;

        setIsAdding(true);
        try {
            await dispatch(addTask({
                projectId: project.id,
                task: {
                    description: newTaskDescription,
                    status: 'pending',
                    createdBy: user.uid,
                    assigneeId: user.uid // Default to self for now
                },
                userId: user.uid,
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: project.name
            })).unwrap();
            setNewTaskDescription('');
        } catch (error) {
            console.error('Failed to add task:', error);
        } finally {
            setIsAdding(false);
        }
    };

    const handleToggleTask = (task: ProjectTask) => {
        if (!user) return;

        const newStatus = task.status === 'completed' ? 'pending' : 'completed';
        const updates: Partial<ProjectTask> = {
            status: newStatus,
            dateCompleted: newStatus === 'completed' ? new Date().toISOString() : undefined
        };

        dispatch(updateTask({
            projectId: project.id,
            taskId: task.id,
            updates,
            userId: user.uid,
            userName: user.displayName || user.email || 'Utilisateur',
            projectName: project.name
        }));
    };

    const handleDeleteTask = (taskId: string) => {
        if (!user || !window.confirm('Voulez-vous vraiment supprimer cette tâche?')) return;

        dispatch(deleteTask({
            projectId: project.id,
            taskId,
            userId: user.uid,
            userName: user.displayName || user.email || 'Utilisateur',
            projectName: project.name
        }));
    };

    // Derived state
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">
                    Tâches ({tasks.length})
                </Typography>
                <Chip
                    label={`${Math.round(progress)}% complété`}
                    color={progress === 100 ? "success" : "primary"}
                    variant={progress === 100 ? "filled" : "outlined"}
                />
            </Box>

            <LinearProgress
                variant="determinate"
                value={progress}
                sx={{ mb: 3, height: 8, borderRadius: 4 }}
            />

            <Paper component="form" onSubmit={handleAddTask} sx={{ p: 2, mb: 3, display: 'flex', gap: 2 }}>
                <TextField
                    fullWidth
                    size="small"
                    value={newTaskDescription}
                    onChange={(e) => setNewTaskDescription(e.target.value)}
                    placeholder="Nouvelle tâche..."
                    disabled={isAdding}
                />
                <Button
                    type="submit"
                    variant="contained"
                    disabled={!newTaskDescription.trim() || isAdding}
                    startIcon={<Add />}
                >
                    Ajouter
                </Button>
            </Paper>

            <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {tasks.length === 0 ? (
                    <Typography color="text.secondary" align="center" py={4}>
                        Aucune tâche pour le moment.
                    </Typography>
                ) : (
                    tasks.map((task, index) => (
                        <React.Fragment key={task.id}>
                            {index > 0 && <Divider />}
                            <ListItem
                                secondaryAction={
                                    <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteTask(task.id)}>
                                        <Delete color="action" />
                                    </IconButton>
                                }
                                disablePadding
                                sx={{ py: 1, px: 2 }}
                            >
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                    <Checkbox
                                        edge="start"
                                        checked={task.status === 'completed'}
                                        onChange={() => handleToggleTask(task)}
                                        tabIndex={-1}
                                        disableRipple
                                    />
                                </ListItemIcon>
                                <ListItemText
                                    primary={
                                        <Typography
                                            variant="body1"
                                            sx={{
                                                textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                                                color: task.status === 'completed' ? 'text.secondary' : 'text.primary'
                                            }}
                                        >
                                            {task.description}
                                        </Typography>
                                    }
                                    secondary={
                                        task.dateCreated && (
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                                <CalendarToday fontSize="inherit" />
                                                Ajouté le {format(new Date(task.dateCreated), 'd MMM yyyy', { locale: fr })}
                                            </Typography>
                                        )
                                    }
                                />
                            </ListItem>
                        </React.Fragment>
                    ))
                )}
            </List>
        </Box>
    );
};

export default ProjectTasks;
