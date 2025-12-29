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
    const [isAdding, setIsAdding] = useState(false);

    const handleAddDecision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !user) return;

        setIsAdding(true);
        try {
            const decision: CaucusDecision = {
                id: Date.now().toString(),
                date: new Date(date).toISOString(),
                description: description,
                createdBy: user.uid
            };

            await dispatch(addCaucusDecision({
                projectId: project.id,
                decision,
                projectName: project.name,
                userId: user.uid,
                userName: user.displayName || user.email || 'Utilisateur'
            })).unwrap();

            setDescription('');
            setDate(new Date().toISOString().split('T')[0]);
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
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                        <Button
                            variant="outlined"
                            startIcon={<AttachFile />}
                            disabled
                            size="small"
                        >
                            Joindre fichier (Bientôt)
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={!description.trim() || isAdding}
                            startIcon={<Add />}
                            size="small"
                        >
                            Ajouter
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
                                            {decision.fileName && (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, color: 'primary.main', cursor: 'pointer' }}>
                                                    <AttachFile fontSize="small" />
                                                    <Typography variant="caption" sx={{ textDecoration: 'underline' }}>
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
