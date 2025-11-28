import React, { useEffect } from 'react';
import { Box, Typography, Paper, Grid } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchDocuments, deleteDocument } from '../../features/documents/documentsSlice';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';

const DocumentsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: documents } = useSelector((state: RootState) => state.documents);

    useEffect(() => {
        dispatch(fetchDocuments());
    }, [dispatch]);

    const handleDelete = async (id: string, storagePath: string) => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer ce document ?')) {
            await dispatch(deleteDocument({ id, storagePath }));
        }
    };

    return (
        <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
                Documents
            </Typography>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 8 }}>
                    <Paper sx={{ p: 3, mb: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            Répertoire
                        </Typography>
                        <DocumentList documents={documents} onDelete={handleDelete} />
                    </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            Ajouter un document
                        </Typography>
                        <DocumentUpload onUploadComplete={() => dispatch(fetchDocuments())} />
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DocumentsPage;
