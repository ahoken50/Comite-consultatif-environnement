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
import { Add, Delete, CalendarToday, Edit } from '@mui/icons-material';
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

// Optimization: Use a constant empty array to prevent unnecessary re-renders
// when the project has no tasks, keeping the useSelector return value referentially stable.
const EMPTY_TASKS: ProjectTask[] = [];

const ProjectTasks: React.FC<ProjectTasksProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const tasks = useSelector((state: RootState) => state.projects.tasksByProjectId[project.id] || EMPTY_TASKS);
    const members = useSelector((state: RootState) => state.members.items);
    // Add Task State
    const [newTaskDescription, setNewTaskDescription] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [assigneeId, setAssigneeId] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    // Edit State
    const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
    const [editDescription, setEditDescription] = useState('');
    const [editDueDate, setEditDueDate] = useState('');
    const [editAssigneeId, setEditAssigneeId] = useState('');

    useEffect(() => {
        dispatch(fetchProjectTasks(project.id));
    }, [dispatch, project.id]);

    const handleAddTask = async (e: React.FormEvent) => {
        // ... (existing handleAddTask logic) ...
        e.preventDefault();
        if (!newTaskDescription.trim() || !user) return;

        setIsAdding(true);
        try {
            await dispatch(addTask({
                projectId: project.id,
                task: {
                    description: newTaskDescription,
                    status: 'pending',
                    createdBy: user.id,
                    assigneeId: assigneeId || user.id,
                    dueDate: dueDate || undefined
                },
                userId: user.id,
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: project.name
            })).unwrap();
            setNewTaskDescription('');
            setDueDate('');
            setAssigneeId('');
        } catch (error) {
            console.error('Failed to add task:', error);
        } finally {
            setIsAdding(false);
        }
    };

    const handleOpenEdit = (task: ProjectTask) => {
        setEditingTask(task);
        setEditDescription(task.description);
        setEditDueDate(task.dueDate || '');
        setEditAssigneeId(task.assigneeId || '');
    };

    const handleUpdateTaskDetails = async () => {
        if (!editingTask || !user || !editDescription.trim()) return;

        const updates: Partial<ProjectTask> = {
            description: editDescription,
            dueDate: editDueDate || undefined,
            assigneeId: editAssigneeId || undefined
        };

        try {
            await dispatch(updateTask({
                projectId: project.id,
                taskId: editingTask.id,
                updates,
                userId: user.id,
                userName: user.displayName || user.email || 'Utilisateur',
                projectName: project.name
            })).unwrap();
            setEditingTask(null);
        } catch (error) {
            console.error('Failed to update task:', error);
        }
    };

    const handleToggleTask = (task: ProjectTask) => {
        // ... (existing logic)
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
            userId: user.id,
            userName: user.displayName || user.email || 'Utilisateur',
            projectName: project.name
        }));
    };

    const handleDeleteTask = (taskId: string) => {
        // ... (existing logic)
        if (!user || !window.confirm('Voulez-vous vraiment supprimer cette tâche?')) return;

        dispatch(deleteTask({
            projectId: project.id,
            taskId,
            userId: user.id,
            userName: user.displayName || user.email || 'Utilisateur',
            projectName: project.name
        }));
    };

    // Derived state
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

    return (
        <Box>
            {/* Edit Dialog */}
            {editingTask && (
                <Paper sx={{ p: 2, mb: 3, border: '1px solid', borderColor: 'primary.main', bgcolor: 'background.default' }}>
                    <Typography variant="subtitle2" gutterBottom>Modifier la tâche</Typography>
                    <TextField
                        fullWidth
                        size="small"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        sx={{ mb: 2 }}
                    />
                    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <TextField
                            type="date"
                            size="small"
                            label="Échéance"
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            select
                            size="small"
                            label="Assigné à"
                            value={editAssigneeId}
                            onChange={(e) => setEditAssigneeId(e.target.value)}
                            SelectProps={{ native: true }}
                            sx={{ minWidth: 150 }}
                        >
                            <option value="">Non assigné</option>
                            {members.map(m => (
                                <option key={m.id} value={m.id}>
                                    {m.displayName}
                                </option>
                            ))}
                        </TextField>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                        <Button size="small" onClick={() => setEditingTask(null)}>Annuler</Button>
                        <Button size="small" variant="contained" onClick={handleUpdateTaskDetails}>Enregistrer</Button>
                    </Box>
                </Paper>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                {/* ... rest of the component ... */}
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

            <Paper component="form" onSubmit={handleAddTask} sx={{ p: 2, mb: 3 }}>
                {/* ... Add Task Form ... */}
                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        value={newTaskDescription}
                        onChange={(e) => setNewTaskDescription(e.target.value)}
                        placeholder="Nouvelle tâche..."
                        disabled={isAdding}
                    />
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        type="date"
                        size="small"
                        label="Échéance"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ width: 150 }}
                    />
                    <TextField
                        select
                        size="small"
                        label="Assigné à"
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value)}
                        SelectProps={{ native: true }}
                        sx={{ width: 200 }}
                    >
                        <option value="">Moi-même</option>
                        {members.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.displayName}
                            </option>
                        ))}
                    </TextField>
                    <Button
                        type="submit"
                        variant="contained"
                        disabled={!newTaskDescription.trim() || isAdding}
                        startIcon={<Add />}
                        sx={{ ml: 'auto' }}
                    >
                        Ajouter
                    </Button>
                </Box>
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
                                    <Box>
                                        <IconButton edge="end" aria-label="edit" onClick={() => handleOpenEdit(task)} sx={{ mr: 1 }}>
                                            <Edit color="action" fontSize="small" />
                                        </IconButton>
                                        <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteTask(task.id)}>
                                            <Delete color="action" />
                                        </IconButton>
                                    </Box>
                                }
                                disablePadding
                                sx={{ py: 1, px: 2 }}
                            >
                                {/* ... Task Item Content ... */}
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
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <CalendarToday fontSize="inherit" />
                                                    Créé le {format(new Date(task.dateCreated), 'd MMM', { locale: fr })}
                                                </Typography>
                                                {task.dueDate && (
                                                    <Typography variant="caption" color={new Date(task.dueDate) < new Date() && task.status !== 'completed' ? 'error.main' : 'text.secondary'} sx={{ fontWeight: 'bold' }}>
                                                        Échéance : {format(new Date(task.dueDate), 'd MMM', { locale: fr })}
                                                    </Typography>
                                                )}
                                                {task.assigneeId && (
                                                    <Chip label={members.find(m => m.id === task.assigneeId)?.displayName || 'Inconnu'} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                                )}
                                            </Box>
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
