import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Project } from '../../types/project.types';
import { projectsAPI } from './projectsAPI';
import { logProjectActivity } from '../../services/activityLogService';

interface ProjectsState {
    items: Project[];
    loading: boolean;
    error: string | null;
}

const initialState: ProjectsState = {
    items: [],
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

const projectsSlice = createSlice({
    name: 'projects',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            // Fetch
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
            // Create
            .addCase(createProject.pending, (state) => {
                state.loading = true;
            })
            .addCase(createProject.fulfilled, (state, action) => {
                state.loading = false;
                state.items.unshift(action.payload); // Add to beginning
            })
            .addCase(createProject.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to create project';
            })
            // Update
            .addCase(updateProject.fulfilled, (state, action) => {
                const { id, updates } = action.payload;
                const index = state.items.findIndex(p => p.id === id);
                if (index !== -1) {
                    state.items[index] = { ...state.items[index], ...updates };
                }
            })
            // Delete
            .addCase(deleteProject.fulfilled, (state, action) => {
                state.items = state.items.filter(p => p.id !== action.payload);
            });
    },
});

export default projectsSlice.reducer;
