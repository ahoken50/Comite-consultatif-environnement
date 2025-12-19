import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Document } from '../../types/document.types';
import { documentsAPI } from './documentsAPI';

interface DocumentsState {
    items: Document[];
    loading: boolean;
    error: string | null;
    uploading: boolean;
}

const initialState: DocumentsState = {
    items: [],
    loading: false,
    error: null,
    uploading: false,
};

export const fetchDocuments = createAsyncThunk(
    'documents/fetchAll',
    async () => {
        return await documentsAPI.fetchAll();
    }
);

export const fetchDocumentsByEntity = createAsyncThunk(
    'documents/fetchByEntity',
    async ({ entityId, entityType }: { entityId: string; entityType: 'project' | 'meeting' }) => {
        return await documentsAPI.fetchByEntity(entityId, entityType);
    }
);

export const uploadDocument = createAsyncThunk(
    'documents/upload',
    async ({ file, linkedEntityId, linkedEntityType, uploadedBy, agendaItemId }: {
        file: File;
        linkedEntityId?: string;
        linkedEntityType?: 'project' | 'meeting';
        uploadedBy?: string;
        agendaItemId?: string;
    }) => {
        return await documentsAPI.upload(file, linkedEntityId, linkedEntityType, uploadedBy, agendaItemId);
    }
);

export const updateDocument = createAsyncThunk(
    'documents/update',
    async ({ id, updates }: { id: string; updates: Partial<Document> }) => {
        await documentsAPI.update(id, updates);
        return { id, updates };
    }
);

export const deleteDocument = createAsyncThunk(
    'documents/delete',
    async ({ id, storagePath }: { id: string; storagePath: string }) => {
        await documentsAPI.delete(id, storagePath);
        return id;
    }
);

const documentsSlice = createSlice({
    name: 'documents',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            // Fetch All
            .addCase(fetchDocuments.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDocuments.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            .addCase(fetchDocuments.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch documents';
            })
            // Fetch By Entity (Appends or replaces? For now, let's just update items to show only relevant ones if we are in a detail view context, OR we could have a separate list. 
            // To keep it simple, we'll just update 'items' but this might affect the global list. 
            // A better approach for a global store is to add them to the list if not present, but for now let's just set items.
            // Actually, if we use this on a detail page, we might want a separate selector or state. 
            // Let's stick to updating 'items' for now, assuming the user views one context at a time or we filter on the client side.)
            .addCase(fetchDocumentsByEntity.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDocumentsByEntity.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            // Upload
            .addCase(uploadDocument.pending, (state) => {
                state.uploading = true;
                state.error = null;
            })
            .addCase(uploadDocument.fulfilled, (state, action) => {
                state.uploading = false;
                state.items.unshift(action.payload);
            })
            .addCase(uploadDocument.rejected, (state, action) => {
                state.uploading = false;
                state.error = action.error.message || 'Upload failed';
            })
            // Update
            .addCase(updateDocument.fulfilled, (state, action) => {
                const index = state.items.findIndex(d => d.id === action.payload.id);
                if (index !== -1) {
                    state.items[index] = { ...state.items[index], ...action.payload.updates };
                }
            })
            // Delete
            .addCase(deleteDocument.fulfilled, (state, action) => {
                state.items = state.items.filter(d => d.id !== action.payload);
            });
    },
});

export default documentsSlice.reducer;
