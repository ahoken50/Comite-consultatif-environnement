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

export const updateMeetingRSVP = createAsyncThunk(
    'meetings/updateRSVP',
    async ({ meetingId, userId, status, reason }: { meetingId: string; userId: string; status: 'present' | 'absent' | 'uncertain'; reason?: string }) => {
        await meetingsAPI.updateRSVP(meetingId, userId, status, reason);
        return { meetingId, userId, status, reason };
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
            })
            // RSVP
            .addCase(updateMeetingRSVP.fulfilled, (state, action) => {
                const index = state.items.findIndex(m => m.id === action.payload.meetingId);
                if (index !== -1) {
                    const meeting = state.items[index];
                    const rsvps = meeting.rsvps || [];
                    const otherRSVPs = rsvps.filter(r => r.userId !== action.payload.userId);
                    const newRSVP = {
                        userId: action.payload.userId,
                        status: action.payload.status,
                        reason: action.payload.reason,
                        updatedAt: new Date().toISOString()
                    };
                    state.items[index] = { ...meeting, rsvps: [...otherRSVPs, newRSVP] };
                }
            });
    },
});

export const { upsertMeeting } = meetingsSlice.actions;

// Selectors
export const selectAllMeetings = (state: { meetings: MeetingsState }) => state.meetings.items;
export const selectMeetingsLoading = (state: { meetings: MeetingsState }) => state.meetings.loading;
export const selectPastMeetings = (state: { meetings: MeetingsState }) => {
    const now = new Date().toISOString();
    return state.meetings.items.filter(m => m.date < now);
};

export default meetingsSlice.reducer;

