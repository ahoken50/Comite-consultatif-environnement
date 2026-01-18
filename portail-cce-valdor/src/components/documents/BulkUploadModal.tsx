import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, List, ListItem, ListItemText,
    ListItemSecondaryAction, IconButton, LinearProgress,
    Select, MenuItem, FormControl, InputLabel, Chip
} from '@mui/material';
import { CloudUpload, Delete, AutoFixHigh } from '@mui/icons-material';
import { aiService } from '../../services/ai/UnifiedAIService';
import type { Meeting } from '../../types/meeting.types';

interface BulkUploadModalProps {
    open: boolean;
    onClose: () => void;
    meeting: Meeting;
    onUploadComplete: (files: File[], assignments: Record<string, string>) => void;
}

interface FileWithMatch {
    file: File;
    match?: string; // Agenda Item Title
    confidence?: number;
}

const BulkUploadModal: React.FC<BulkUploadModalProps> = ({ open, onClose, meeting, onUploadComplete }) => {
    const [files, setFiles] = useState<FileWithMatch[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setFiles(prev => [
            ...prev,
            ...acceptedFiles.map(f => ({ file: f }))
        ]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] } });

    const handleAutoMatch = async () => {
        setIsAnalyzing(true);
        const fileNames = files.map(f => f.file.name);
        const agendaTitles = meeting.agendaItems?.map(a => a.title) || [];

        try {
            const matches = await aiService.suggestFileMatches(fileNames, agendaTitles);

            setFiles(prev => prev.map(f => {
                const match = matches.find(m => m.fileName === f.file.name);
                if (match && match.confidence > 0.4) {
                    return { ...f, match: match.agendaItemTitle, confidence: match.confidence };
                }
                return f;
            }));
        } catch (e) {
            console.error(e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleRemove = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleMatchChange = (index: number, title: string) => {
        setFiles(prev => {
            const newFiles = [...prev];
            newFiles[index] = { ...newFiles[index], match: title, confidence: 1 };
            return newFiles;
        });
    };

    const handleSubmit = () => {
        const assignments: Record<string, string> = {};
        files.forEach(f => {
            if (f.match) assignments[f.file.name] = f.match;
        });
        onUploadComplete(files.map(f => f.file), assignments);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CloudUpload color="primary" />
                Ajout d'Annexes en Lot
            </DialogTitle>
            <DialogContent>
                <Box {...getRootProps()} sx={{
                    border: '2px dashed #ccc', borderRadius: 2, p: 4, textAlign: 'center',
                    bgcolor: isDragActive ? '#f0f9ff' : 'transparent',
                    cursor: 'pointer', mb: 2
                }}>
                    <input {...getInputProps()} />
                    <Typography color="textSecondary">
                        Glissez vos fichiers PDF ici, ou cliquez pour sélectionner.
                    </Typography>
                </Box>

                {files.length > 0 && (
                    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            startIcon={isAnalyzing ? <LinearProgress sx={{ width: 20 }} /> : <AutoFixHigh />}
                            onClick={handleAutoMatch}
                            disabled={isAnalyzing}
                            variant="outlined"
                            size="small"
                        >
                            {isAnalyzing ? 'Analyse IA en cours...' : 'Suggérer les correspondances'}
                        </Button>
                    </Box>
                )}

                <List>
                    {files.map((f, index) => (
                        <ListItem key={index} divider>
                            <ListItemText
                                primary={f.file.name}
                                secondary={f.file.size / 1024 > 1024 ? `${(f.file.size / 1024 / 1024).toFixed(1)} MB` : `${(f.file.size / 1024).toFixed(0)} KB`}
                            />

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: '40%' }}>
                                <FormControl size="small" fullWidth>
                                    <InputLabel>Point d'ordre du jour</InputLabel>
                                    <Select
                                        value={f.match || ''}
                                        label="Point d'ordre du jour"
                                        onChange={(e) => handleMatchChange(index, e.target.value)}
                                    >
                                        <MenuItem value=""><em>Aucun</em></MenuItem>
                                        {meeting.agendaItems?.map(item => (
                                            <MenuItem key={item.id} value={item.title}>
                                                {item.title}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                {f.confidence && f.confidence > 0.8 && (
                                    <Chip icon={<AutoFixHigh />} size="small" color="success" variant="outlined" />
                                )}
                            </Box>

                            <ListItemSecondaryAction>
                                <IconButton edge="end" onClick={() => handleRemove(index)}>
                                    <Delete />
                                </IconButton>
                            </ListItemSecondaryAction>
                        </ListItem>
                    ))}
                </List>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Annuler</Button>
                <Button onClick={handleSubmit} variant="contained" disabled={files.length === 0}>
                    Importer {files.length} fichier(s)
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BulkUploadModal;
