import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../../services/firebase';

interface SettingsState {
    categories: string[];
    loading: boolean;
    error: string | null;
}

const initialState: SettingsState = {
    categories: ['Eau', 'Biodiversité', 'Réglementation', 'Déchets', 'Urgence', 'Innovation', 'Opérations', 'Climat'], // Defaults
    loading: false,
    error: null
};

// Firestore path: settings/general
const SETTINGS_DOC_REF = doc(db, 'settings', 'general');

export const fetchSettings = createAsyncThunk(
    'settings/fetch',
    async () => {
        const docSnap = await getDoc(SETTINGS_DOC_REF);
        if (docSnap.exists()) {
            return docSnap.data() as Partial<SettingsState>;
        }
        return {};
    }
);

export const addCategory = createAsyncThunk(
    'settings/addCategory',
    async (category: string) => {
        // Ensure doc exists
        const docSnap = await getDoc(SETTINGS_DOC_REF);
        if (!docSnap.exists()) {
            await setDoc(SETTINGS_DOC_REF, { categories: [category] });
        } else {
            await updateDoc(SETTINGS_DOC_REF, {
                categories: arrayUnion(category)
            });
        }
        return category;
    }
);

export const deleteCategory = createAsyncThunk(
    'settings/deleteCategory',
    async (category: string) => {
        await updateDoc(SETTINGS_DOC_REF, {
            categories: arrayRemove(category)
        });
        return category;
    }
);

const settingsSlice = createSlice({
    name: 'settings',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchSettings.pending, (state) => {
                state.loading = true;
            })
            .addCase(fetchSettings.fulfilled, (state, action) => {
                state.loading = false;
                if (action.payload.categories) {
                    state.categories = action.payload.categories;
                }
            })
            .addCase(fetchSettings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch settings';
            })
            .addCase(addCategory.fulfilled, (state, action) => {
                if (!state.categories.includes(action.payload)) {
                    state.categories.push(action.payload);
                }
            })
            .addCase(deleteCategory.fulfilled, (state, action) => {
                state.categories = state.categories.filter(c => c !== action.payload);
            });
    }
});

export default settingsSlice.reducer;
