import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { CouncilRecommendation } from '../../types/recommendation.types';
import { governanceAPI } from './governanceAPI';
import type { RootState } from '../../store/rootReducer';

interface GovernanceState {
    recommendations: CouncilRecommendation[];
    loading: boolean;
    error: string | null;
}

const initialState: GovernanceState = {
    recommendations: [],
    loading: false,
    error: null,
};

// Async Thunks
export const fetchRecommendations = createAsyncThunk(
    'governance/fetchRecommendations',
    async () => {
        return await governanceAPI.fetchAllRecommendations();
    }
);

export const addRecommendation = createAsyncThunk(
    'governance/addRecommendation',
    async (recommendation: Omit<CouncilRecommendation, 'id'>) => {
        return await governanceAPI.addRecommendation(recommendation);
    }
);

export const updateRecommendation = createAsyncThunk(
    'governance/updateRecommendation',
    async ({ id, updates }: { id: string; updates: Partial<CouncilRecommendation> }) => {
        await governanceAPI.updateRecommendation(id, updates);
        return { id, updates };
    }
);

export const deleteRecommendation = createAsyncThunk(
    'governance/deleteRecommendation',
    async (id: string) => {
        await governanceAPI.deleteRecommendation(id);
        return id;
    }
);

const governanceSlice = createSlice({
    name: 'governance',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        // Fetch
        builder
            .addCase(fetchRecommendations.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchRecommendations.fulfilled, (state, action) => {
                state.loading = false;
                state.recommendations = action.payload;
            })
            .addCase(fetchRecommendations.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch recommendations';
            });

        // Add
        builder.addCase(addRecommendation.fulfilled, (state, action) => {
            state.recommendations.unshift(action.payload);
        });

        // Update
        builder.addCase(updateRecommendation.fulfilled, (state, action) => {
            const index = state.recommendations.findIndex(r => r.id === action.payload.id);
            if (index !== -1) {
                state.recommendations[index] = { ...state.recommendations[index], ...action.payload.updates };
            }
        });

        // Delete
        builder.addCase(deleteRecommendation.fulfilled, (state, action) => {
            state.recommendations = state.recommendations.filter(r => r.id !== action.payload);
        });
    },
});

export default governanceSlice.reducer;
export const selectRecommendations = (state: RootState) => state.governance.recommendations;
export const selectGovernanceLoading = (state: RootState) => state.governance.loading;
