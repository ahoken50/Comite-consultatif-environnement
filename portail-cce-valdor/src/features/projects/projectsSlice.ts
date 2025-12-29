import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Project } from '../../types/project.types';
import type { ProjectTask } from '../../types/task.types';
import { projectsAPI } from './projectsAPI';
import { logProjectActivity } from '../../services/activityLogService';

interface ProjectsState {
    items: Project[];
    tasksByProjectId: Record<string, ProjectTask[]>;
    loading: boolean;
    error: string | null;
}

const initialState: ProjectsState = {
    items: [],
    tasksByProjectId: {},
    loading: false,
    error: null,
};

// Fetch all projects
export const fetchProjects = createAsyncThunk(
    'projects/fetchAll',
    async () => {
        return await projectsAPI.fetchAll();
    }
);

// Create a new project
export const createProject = createAsyncThunk(
    'projects/create',
    async ({ project, userId, userName }: {
        project: Omit<Project, 'id'>;
        userId: string;
        userName: string;
    }) => {
        const created = await projectsAPI.create(project);
        // Log activity
        await logProjectActivity('project_created', userId, userName, created.id, created.name);
        return created;
    }
);

// Update a project
export const updateProject = createAsyncThunk(
    'projects/update',
    async ({ id, updates, userId, userName, projectName }: {
        id: string;
        updates: Partial<Project>;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.update(id, updates);
        // Log activity (check if completed)
        const activityType = updates.status === 'completed' ? 'project_completed' : 'project_updated';
        await logProjectActivity(activityType, userId, userName, id, projectName);
        return { id, updates };
    }
);

// Delete a project
export const deleteProject = createAsyncThunk(
    'projects/delete',
    async ({ id, userId, userName, projectName }: {
        id: string;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.delete(id);
        // Log activity
        await logProjectActivity('project_deleted', userId, userName, id, projectName);
        return id;
    }
);

// Task Thunks
export const fetchProjectTasks = createAsyncThunk(
    'projects/fetchTasks',
    async (projectId: string) => {
        const tasks = await projectsAPI.fetchTasks(projectId);
        return { projectId, tasks };
    }
);

export const addTask = createAsyncThunk(
    'projects/addTask',
    async ({ projectId, task, userId, userName, projectName }: {
        projectId: string;
        task: Omit<ProjectTask, 'id' | 'projectId' | 'dateCreated'>;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        const created = await projectsAPI.addTask(projectId, task);
        // Log activity
        await logProjectActivity('task_created', userId, userName, projectId, `${projectName}: ${task.description}`);
        return created;
    }
);

export const updateTask = createAsyncThunk(
    'projects/updateTask',
    async ({ projectId, taskId, updates, userId, userName, projectName }: {
        projectId: string;
        taskId: string;
        updates: Partial<ProjectTask>;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.updateTask(projectId, taskId, updates);
        // Log if completed
        if (updates.status === 'completed') {
            await logProjectActivity('task_completed', userId, userName, projectId, `${projectName} (Tâche terminée)`);
        }
        return { projectId, taskId, updates };
    }
);

export const deleteTask = createAsyncThunk(
    'projects/deleteTask',
    async ({ projectId, taskId, userId, userName, projectName }: {
        projectId: string;
        taskId: string;
        userId: string;
        userName: string;
        projectName: string;
    }) => {
        await projectsAPI.deleteTask(projectId, taskId);
        // Log not always needed for delete task to reduce noise, but good for consistency
        return { projectId, taskId };
    }
);

const projectsSlice = createSlice({
    name: 'projects',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            // Fetch Projects
            .addCase(fetchProjects.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchProjects.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            .addCase(fetchProjects.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch projects';
            })
            // Create Project
            .addCase(createProject.pending, (state) => {
                state.loading = true;
            })
            .addCase(createProject.fulfilled, (state, action) => {
                state.loading = false;
                state.items.unshift(action.payload);
            })
            .addCase(createProject.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to create project';
            })
            // Update Project
            .addCase(updateProject.fulfilled, (state, action) => {
                const { id, updates } = action.payload;
                const index = state.items.findIndex(p => p.id === id);
                if (index !== -1) {
                    state.items[index] = { ...state.items[index], ...updates };
                }
            })
            // Delete Project
            .addCase(deleteProject.fulfilled, (state, action) => {
                state.items = state.items.filter(p => p.id !== action.payload);
            })
            // Fetch Tasks
            .addCase(fetchProjectTasks.fulfilled, (state, action) => {
                state.tasksByProjectId[action.payload.projectId] = action.payload.tasks;
            })
            // Add Task
            .addCase(addTask.fulfilled, (state, action) => {
                const { projectId } = action.payload;
                if (!state.tasksByProjectId[projectId]) {
                    state.tasksByProjectId[projectId] = [];
                }
                state.tasksByProjectId[projectId].push(action.payload);
            })
            // Update Task
            .addCase(updateTask.fulfilled, (state, action) => {
                const { projectId, taskId, updates } = action.payload;
                const tasks = state.tasksByProjectId[projectId];
                if (tasks) {
                    const index = tasks.findIndex(t => t.id === taskId);
                    if (index !== -1) {
                        tasks[index] = { ...tasks[index], ...updates };
                    }
                }
            })
            // Delete Task
            .addCase(deleteTask.fulfilled, (state, action) => {
                const { projectId, taskId } = action.payload;
                if (state.tasksByProjectId[projectId]) {
                    state.tasksByProjectId[projectId] = state.tasksByProjectId[projectId].filter(t => t.id !== taskId);
                }
            });
    },
});

export default projectsSlice.reducer;
