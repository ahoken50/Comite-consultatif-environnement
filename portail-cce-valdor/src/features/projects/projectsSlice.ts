import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Project } from '../../types/project.types';
import { projectsAPI } from './projectsAPI';

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

export const fetchProjects = createAsyncThunk(
    'projects/fetchAll',
    async () => {
        const response = await projectsAPI.fetchAll();
        return response;
    }
);

const projectsSlice = createSlice({
    name: 'projects',
    initialState,
    reducers: {
        // Optimistic updates can be added here
    },
    extraReducers: (builder) => {
        builder
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
            });
    },
});

export default projectsSlice.reducer;
