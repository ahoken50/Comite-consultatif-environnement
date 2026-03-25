import React, { useState } from 'react';
import {
    Box,
    Typography,
    TextField,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Paper,
    Divider,
    Tooltip,
    Chip
} from '@mui/material';
import { Add, Description, AttachFile, Edit, Delete, Save, Cancel } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import type { Project, CaucusDecision } from '../../types/project.types';
import { addCaucusDecision, updateCaucusDecision, deleteCaucusDecision } from '../../features/projects/projectsSlice';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectDecisionsProps {
    project: Project;
}

const ProjectDecisions: React.FC<ProjectDecisionsProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    
    // Form state
    const [description, setDescription] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
    
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleEditClick = (decision: CaucusDecision) => {
        setEditingDecisionId(decision.id);
        setDescription(decision.description);
        setDate(decision.date.split('T')[0]);
        // Note: we don't easily allow replacing existing file here for simplicity 
        // but user can re-add or we could extend this.
    };

    const handleCancelEdit = () => {
        setEditingDecisionId(null);
        setDescription('');
        setDate(new Date().toISOString().split('T')[0]);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSubmitDecision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !user) return;

        setIsSaving(true);
        try {
            let fileUrl = undefined;
            let fileName = undefined;

            if (selectedFile) {
                const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
                const { storage } = await import('../../services/firebase');

                const storageRef = ref(storage, `projects/${project.id}/decisions/${Date.now()}_${selectedFile.name}`);
                const snapshot = await uploadBytes(storageRef, selectedFile);
                fileUrl = await getDownloadURL(snapshot.ref);
                fileName = selectedFile.name;
            }

            if (editingDecisionId) {
                // Update existing
                const updates: Partial<CaucusDecision> = {
                    date: new Date(date).toISOString(),
                    description: description,
                };
                if (fileUrl) {
                    updates.fileUrl = fileUrl;
                    updates.fileName = fileName;
                }

                await dispatch(updateCaucusDecision({
                    projectId: project.id,
                    decisionId: editingDecisionId,
                    updates,
                    projectName: project.name,
                    userId: user.id,
                    userName: user.displayName || user.email || 'Utilisateur'
                })).unwrap();
            } else {
                // Create new
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
            }

            handleCancelEdit();
        } catch (error) {
            console.error('Failed to save decision:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (decisionId: string) => {
        if (!user || !window.confirm('Voulez-vous vraiment supprimer cette décision ?')) return;

        try {
            await dispatch(deleteCaucusDecision({
                projectId: project.id,
                decisionId,
                projectName: project.name,
                userId: user.id,
                userName: user.displayName || user.email || 'Utilisateur'
            })).unwrap();
        } catch (error) {
            console.error('Failed to delete decision:', error);
        }
    };

    const sortedDecisions = [...(project.caucusDecisions || [])].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return (
        <Box>
            <Paper component="form" onSubmit={handleSubmitDecision} sx={{ p: 2, mb: 3, borderLeft: editingDecisionId ? '4px solid #1976d2' : 'none' }}>
                <Typography variant="subtitle2" gutterBottom color={editingDecisionId ? 'primary' : 'initial'}>
                    {editingDecisionId ? 'Modifier la décision' : 'Nouvelle décision / suivi'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <TextField
                            type="date"
                            size="small"
                            label="Date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                            sx={{ width: 200 }}
                        />
                        {editingDecisionId && (
                            <Chip 
                                label="Mode édition" 
                                color="primary" 
                                size="small" 
                                variant="outlined" 
                                onDelete={handleCancelEdit}
                                deleteIcon={<Cancel />}
                            />
                        )}
                    </Box>
                    <TextField
                        fullWidth
                        multiline
                        rows={2}
                        size="small"
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Contenu de la décision ou du suivi..."
                        disabled={isSaving}
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
                        <Button
                            variant="outlined"
                            startIcon={<AttachFile />}
                            size="small"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isSaving}
                        >
                            {editingDecisionId ? 'Remplacer fichier' : 'Joindre fichier'}
                        </Button>
                        {editingDecisionId && (
                            <Button
                                variant="text"
                                onClick={handleCancelEdit}
                                disabled={isSaving}
                                size="small"
                            >
                                Annuler
                            </Button>
                        )}
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={!description.trim() || isSaving}
                            startIcon={editingDecisionId ? <Save /> : <Add />}
                            size="small"
                        >
                            {isSaving ? 'Enregistrement...' : (editingDecisionId ? 'Enregistrer' : 'Ajouter')}
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
                                        <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
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
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                        mt: 1.5,
                                                        bgcolor: 'primary.50',
                                                        color: 'primary.main',
                                                        px: 1.5,
                                                        py: 0.5,
                                                        borderRadius: 1,
                                                        cursor: 'pointer',
                                                        textDecoration: 'none',
                                                        '&:hover': { bgcolor: 'primary.100' }
                                                    }}
                                                >
                                                    <AttachFile fontSize="small" />
                                                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                                        {decision.fileName}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    }
                                />
                                {user?.role === 'coordinator' && (
                                    <ListItemSecondaryAction>
                                        <Tooltip title="Modifier">
                                            <IconButton 
                                                edge="end" 
                                                onClick={() => handleEditClick(decision)}
                                                sx={{ mr: 1, color: 'primary.main' }}
                                                size="small"
                                            >
                                                <Edit fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Supprimer">
                                            <IconButton 
                                                edge="end" 
                                                color="error"
                                                onClick={() => handleDelete(decision.id)}
                                                size="small"
                                            >
                                                <Delete fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </ListItemSecondaryAction>
                                )}
                            </ListItem>
                        </React.Fragment>
                    ))
                )}
            </List>
        </Box>
    );
};

export default ProjectDecisions;
