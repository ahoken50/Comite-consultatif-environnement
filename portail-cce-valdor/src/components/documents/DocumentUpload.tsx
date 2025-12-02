import React, { useCallback, useState } from 'react';
import { Box, Typography, Button, LinearProgress, Paper } from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { uploadDocument } from '../../features/documents/documentsSlice';

interface DocumentUploadProps {
    linkedEntityId?: string;
    linkedEntityType?: 'project' | 'meeting';
    agendaItemId?: string;
    onUploadComplete?: () => void;
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({
    linkedEntityId,
    linkedEntityType,
    agendaItemId,
    onUploadComplete
}) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (!user) {
            setError('Vous devez être connecté pour télécharger des fichiers.');
            return;
        }

        setUploading(true);
        setError(null);

        try {
            for (const file of acceptedFiles) {
                await dispatch(uploadDocument({
                    file,
                    linkedEntityId,
                    linkedEntityType,
                    uploadedBy: user.uid,
                    agendaItemId
                })).unwrap();
            }
            if (onUploadComplete) {
                onUploadComplete();
            }
        } catch (err: any) {
            setError(err.message || 'Échec du téléchargement');
        } finally {
            setUploading(false);
        }
    }, [dispatch, linkedEntityId, linkedEntityType, agendaItemId, onUploadComplete]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 3,
                textAlign: 'center',
                cursor: 'pointer',
                bgcolor: isDragActive ? 'action.hover' : 'background.paper',
                borderStyle: 'dashed'
            }}
            {...getRootProps()}
        >
            <input {...getInputProps()} />
            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6" gutterBottom>
                {isDragActive ? 'Déposez les fichiers ici...' : 'Glissez-déposez des fichiers ici'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                ou cliquez pour sélectionner
            </Typography>
            <Button variant="contained" disabled={uploading}>
                Sélectionner des fichiers
            </Button>

            {uploading && (
                <Box sx={{ mt: 2, width: '100%' }}>
                    <LinearProgress />
                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                        Téléchargement en cours...
                    </Typography>
                </Box>
            )}

            {error && (
                <Typography color="error" variant="body2" sx={{ mt: 2 }}>
                    {error}
                </Typography>
            )}
        </Paper>
    );
};

export default DocumentUpload;
