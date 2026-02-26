import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Member, MemberUpdateData } from '../../types/member.types';
import * as membersAPI from './membersAPI';

interface MembersState {
    items: Member[];
    loading: boolean;
    error: string | null;
    currentMember: Member | null;
}

const initialState: MembersState = {
    items: [],
    loading: false,
    error: null,
    currentMember: null,
};

export const fetchMembers = createAsyncThunk(
    'members/fetchMembers',
    async () => {
        return await membersAPI.fetchMembers();
    }
);

export const fetchMemberById = createAsyncThunk(
    'members/fetchMemberById',
    async (id: string) => {
        return await membersAPI.fetchMemberById(id);
    }
);

export const createMember = createAsyncThunk(
    'members/createMember',
    async (member: Member) => {
        return await membersAPI.createMember(member);
    }
);

export const updateMember = createAsyncThunk(
    'members/updateMember',
    async ({ id, updates }: { id: string; updates: MemberUpdateData }) => {
        await membersAPI.updateMember(id, updates);
        return { id, updates };
    }
);

export const deleteMember = createAsyncThunk(
    'members/deleteMember',
    async (id: string) => {
        return await membersAPI.deleteMember(id);
    }
);

export const ensureMemberProfile = createAsyncThunk(
    'members/ensureProfile',
    async (user: any) => {
        return await membersAPI.ensureMemberProfile(user);
    }
);

const membersSlice = createSlice({
    name: 'members',
    initialState,
    reducers: {
        clearCurrentMember: (state) => {
            state.currentMember = null;
        }
    },
    extraReducers: (builder) => {
        builder
            // Fetch Members
            .addCase(fetchMembers.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchMembers.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            .addCase(fetchMembers.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch members';
            })
            // Fetch Member By ID
            .addCase(fetchMemberById.fulfilled, (state, action) => {
                if (action.payload) {
                    const index = state.items.findIndex(m => m.id === action.payload!.id);
                    if (index !== -1) {
                        state.items[index] = action.payload;
                    } else {
                        state.items.push(action.payload);
                    }
                }
            })
            // Create Member
            .addCase(createMember.fulfilled, (state, action) => {
                state.items.push(action.payload);
            })
            // Update Member
            .addCase(updateMember.fulfilled, (state, action) => {
                const index = state.items.findIndex(m => m.id === action.payload.id);
                if (index !== -1) {
                    state.items[index] = { ...state.items[index], ...action.payload.updates };
                }
                if (state.currentMember && state.currentMember.id === action.payload.id) {
                    state.currentMember = { ...state.currentMember, ...action.payload.updates };
                }
            })
            // Delete Member
            .addCase(deleteMember.fulfilled, (state, action) => {
                state.items = state.items.filter(m => m.id !== action.payload);
            })
            // Ensure Profile
            .addCase(ensureMemberProfile.fulfilled, (state, action) => {
                state.currentMember = action.payload;
                // Update in list if exists, else add
                const index = state.items.findIndex(m => m.id === action.payload.id);
                if (index !== -1) {
                    state.items[index] = action.payload;
                } else {
                    state.items.push(action.payload);
                }
            });
    },
});

export const { clearCurrentMember } = membersSlice.actions;
export default membersSlice.reducer;
