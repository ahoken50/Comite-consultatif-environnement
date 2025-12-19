import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Meeting } from '../../types/meeting.types';
import { meetingsAPI } from './meetingsAPI';

interface MeetingsState {
    items: Meeting[];
    loading: boolean;
    error: string | null;
}

const initialState: MeetingsState = {
    items: [],
    loading: false,
    error: null,
};

export const fetchMeetings = createAsyncThunk(
    'meetings/fetchAll',
    async () => {
        return await meetingsAPI.fetchAll();
    }
);

export const createMeeting = createAsyncThunk(
    'meetings/create',
    async (meeting: Omit<Meeting, 'id'>) => {
        return await meetingsAPI.create(meeting);
    }
);

export const updateMeeting = createAsyncThunk(
    'meetings/update',
    async ({ id, updates }: { id: string; updates: Partial<Meeting> }) => {
        await meetingsAPI.update(id, updates);
        return { id, updates };
    }
);

export const deleteMeeting = createAsyncThunk(
    'meetings/delete',
    async (id: string) => {
        await meetingsAPI.delete(id);
        return id;
    }
);

const meetingsSlice = createSlice({
    name: 'meetings',
    initialState,
    reducers: {
        upsertMeeting: (state, action) => {
            const index = state.items.findIndex(m => m.id === action.payload.id);
            if (index !== -1) {
                state.items[index] = action.payload;
            } else {
                state.items.push(action.payload);
            }
        }
    },
    extraReducers: (builder) => {
        builder
            // Fetch
            .addCase(fetchMeetings.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchMeetings.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            .addCase(fetchMeetings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch meetings';
            })
            // Create
            .addCase(createMeeting.fulfilled, (state, action) => {
                state.items.unshift(action.payload);
            })
            // Update
            .addCase(updateMeeting.fulfilled, (state, action) => {
                const index = state.items.findIndex(m => m.id === action.payload.id);
                if (index !== -1) {
                    state.items[index] = { ...state.items[index], ...action.payload.updates };
                }
            })
            // Delete
            .addCase(deleteMeeting.fulfilled, (state, action) => {
                state.items = state.items.filter(m => m.id !== action.payload);
            });
    },
});

export const { upsertMeeting } = meetingsSlice.actions;
export default meetingsSlice.reducer;
