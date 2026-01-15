import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    CircularProgress
} from '@mui/material';
import type { Project } from '../../types/project.types';
import { useDispatch, useSelector } from 'react-redux';
import { mergeProjects } from '../../features/projects/projectsSlice';
import type { AppDispatch, RootState } from '../../store/store';

interface ProjectMergeDialogProps {
    open: boolean;
    onClose: () => void;
    sourceProject: Project | null;
    allProjects: Project[];
}

const ProjectMergeDialog: React.FC<ProjectMergeDialogProps> = ({
    open,
    onClose,
    sourceProject,
    allProjects
}) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const [targetProjectId, setTargetProjectId] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleMerge = async () => {
        if (!sourceProject || !targetProjectId || !user) return;

        const targetProject = allProjects.find(p => p.id === targetProjectId);
        if (!targetProject) return;

        if (!window.confirm(`Êtes-vous sûr de vouloir fusionner "${sourceProject.name}" DANS "${targetProject.name}" ?\n\nLe projet source sera SUPPRIMÉ définitivement.`)) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await dispatch(mergeProjects({
                sourceProjectId: sourceProject.id,
                targetProjectId,
                user,
                sourceProjectName: sourceProject.name,
                targetProjectName: targetProject.name
            })).unwrap();

            setTargetProjectId('');
            onClose();
        } catch (err: any) {
            console.error("Merge failed", err);
            setError(typeof err === 'string' ? err : "Une erreur est survenue lors de la fusion.");
        } finally {
            setLoading(false);
        }
    };

    if (!sourceProject) return null;

    // Filter available targets: exclude source project itself
    const availableTargets = allProjects.filter(p => p.id !== sourceProject.id);

    return (
        <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                Fusionner le projet "{sourceProject.name}"
            </DialogTitle>
            <DialogContent>
                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Alert severity="warning">
                        <strong>Attention :</strong> Cette action est irréversible.
                        Le projet source sera <strong>supprimé</strong> et tout son contenu (tâches, commentaires, résolutions liées) sera transféré vers le projet principal choisi ci-dessous.
                    </Alert>

                    <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                        <Typography variant="subtitle2" gutterBottom>Projet Source (sera supprimé) :</Typography>
                        <Typography variant="body1"><strong>{sourceProject.code}</strong> - {sourceProject.name}</Typography>
                    </Box>

                    <FormControl fullWidth>
                        <InputLabel id="target-project-label">Projet Principal (Destination)</InputLabel>
                        <Select
                            labelId="target-project-label"
                            value={targetProjectId}
                            label="Projet Principal (Destination)"
                            onChange={(e) => setTargetProjectId(e.target.value)}
                        >
                            {availableTargets.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.code} - {p.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {error && (
                        <Alert severity="error">{error}</Alert>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading}>
                    Annuler
                </Button>
                <Button
                    variant="contained"
                    color="primary" // Keeping it primary but warning text makes it clear
                    onClick={handleMerge}
                    disabled={!targetProjectId || loading}
                    startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
                >
                    {loading ? 'Fusion en cours...' : 'Fusionner'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ProjectMergeDialog;
