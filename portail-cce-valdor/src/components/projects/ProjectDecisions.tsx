import React, { useState } from 'react';
import {
    Box,
    Typography,
    TextField,
    Button,
    List,
    ListItem,
    ListItemText,
    Paper,
    Divider
} from '@mui/material';
import { Add, Description, AttachFile } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import type { Project, CaucusDecision } from '../../types/project.types';
import { addCaucusDecision } from '../../features/projects/projectsSlice';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectDecisionsProps {
    project: Project;
}

const ProjectDecisions: React.FC<ProjectDecisionsProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const [description, setDescription] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleAddDecision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !user) return;

        setIsAdding(true);
        try {
            let fileUrl = undefined;
            let fileName = undefined;

            if (selectedFile) {
                // Dynamic import for storage to avoid issues if not initialized
                const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                const { storage } = await import('../../services/firebase');

                const storageRef = ref(storage, `projects/${project.id}/decisions/${Date.now()}_${selectedFile.name}`);
                const snapshot = await uploadBytes(storageRef, selectedFile);
                fileUrl = await getDownloadURL(snapshot.ref);
                fileName = selectedFile.name;
            }

            const decision: CaucusDecision = {
                id: Date.now().toString(),
                date: new Date(date).toISOString(),
                description: description,
                createdBy: user.id,
                fileUrl,
                fileName
            };

            await dispatch(addCaucusDecision({
                projectId: project.id,
                decision,
                projectName: project.name,
                userId: user.id,
                userName: user.displayName || user.email || 'Utilisateur'
            })).unwrap();

            setDescription('');
            setDate(new Date().toISOString().split('T')[0]);
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (error) {
            console.error('Failed to add decision:', error);
        } finally {
            setIsAdding(false);
        }
    };

    const sortedDecisions = [...(project.caucusDecisions || [])].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return (
        <Box>
            <Paper component="form" onSubmit={handleAddDecision} sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom>Nouvelle décision / suivi</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: 'column' }}>
                    <TextField
                        type="date"
                        size="small"
                        label="Date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ width: 200 }}
                    />
                    <TextField
                        fullWidth
                        multiline
                        rows={2}
                        size="small"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Contenu de la décision ou du suivi..."
                        disabled={isAdding}
                    />

                    {selectedFile && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                            <AttachFile fontSize="small" color="primary" />
                            <Typography variant="caption" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {selectedFile.name}
                            </Typography>
                            <Button size="small" color="error" onClick={() => {
                                setSelectedFile(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}>
                                Supprimer
                            </Button>
                        </Box>
                    )}

                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleFileSelect}
                        />
                        {user?.role === 'coordinator' && (
                            <Button
                                variant="outlined"
                                startIcon={<AttachFile />}
                                size="small"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isAdding}
                            >
                                Joindre fichier
                            </Button>
                        )}
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={!description.trim() || isAdding}
                            startIcon={<Add />}
                            size="small"
                        >
                            {isAdding ? 'Envoi...' : 'Ajouter'}
                        </Button>
                    </Box>
                </Box>
            </Paper>

            <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {sortedDecisions.length === 0 ? (
                    <Typography color="text.secondary" align="center" py={4}>
                        Aucune décision enregistrée pour ce projet.
                    </Typography>
                ) : (
                    sortedDecisions.map((decision, index) => (
                        <React.Fragment key={decision.id}>
                            {index > 0 && <Divider />}
                            <ListItem alignItems="flex-start" sx={{ py: 2 }}>
                                <Box sx={{ mr: 2, mt: 0.5, color: 'primary.main' }}>
                                    <Description />
                                </Box>
                                <ListItemText
                                    primary={
                                        <Typography variant="subtitle1" component="div">
                                            {format(new Date(decision.date), 'd MMMM yyyy', { locale: fr })}
                                        </Typography>
                                    }
                                    secondary={
                                        <Box sx={{ mt: 1 }}>
                                            <Typography variant="body1" color="text.primary" sx={{ whiteSpace: 'pre-wrap' }}>
                                                {decision.description}
                                            </Typography>
                                            {decision.fileName && decision.fileUrl && (
                                                <Box
                                                    component="a"
                                                    href={decision.fileUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                        mt: 1,
                                                        color: 'primary.main',
                                                        cursor: 'pointer',
                                                        textDecoration: 'none',
                                                        '&:hover': { textDecoration: 'underline' }
                                                    }}
                                                >
                                                    <AttachFile fontSize="small" />
                                                    <Typography variant="caption">
                                                        {decision.fileName}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    }
                                />
                            </ListItem>
                        </React.Fragment>
                    ))
                )}
            </List>
        </Box>
    );
};

export default ProjectDecisions;
