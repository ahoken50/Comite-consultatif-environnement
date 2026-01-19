import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Autocomplete,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    Paper,
    Divider
} from '@mui/material';
import { Add, Delete, LinkOff, AccountTree, ArrowForward } from '@mui/icons-material';
import { collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { Project, ProjectDependency } from '../../types/project.types';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';

interface ProjectDependenciesProps {
    project: Project;
    onUpdate?: () => void;
}

/**
 * Project Dependencies Component (#2.7)
 * Allows linking projects that depend on each other with different relationship types
 */
const ProjectDependencies: React.FC<ProjectDependenciesProps> = ({ project, onUpdate }) => {
    const { user } = useSelector((state: RootState) => state.auth);
    const [allProjects, setAllProjects] = useState<Project[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [dependencyType, setDependencyType] = useState<'blocks' | 'requires' | 'related'>('requires');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dependencies = project.dependencies || [];

    // Fetch all projects for the autocomplete
    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const snapshot = await getDocs(collection(db, 'projects'));
                const projects = snapshot.docs
                    .map(d => ({ id: d.id, ...d.data() } as Project))
                    .filter(p => p.id !== project.id); // Exclude current project
                setAllProjects(projects);
            } catch (err) {
                console.error('Error fetching projects:', err);
            }
        };
        fetchProjects();
    }, [project.id]);

    const handleAddDependency = async () => {
        if (!selectedProject || !user) return;

        setLoading(true);
        setError(null);

        try {
            const newDependency: ProjectDependency = {
                id: `${project.id}-${selectedProject.id}-${Date.now()}`,
                dependsOnProjectId: selectedProject.id,
                dependsOnProjectCode: selectedProject.code,
                dependsOnProjectName: selectedProject.name,
                dependencyType,
                createdAt: new Date().toISOString(),
                createdBy: user.id
            };

            await updateDoc(doc(db, 'projects', project.id), {
                dependencies: arrayUnion(newDependency),
                dateUpdated: new Date().toISOString()
            });

            setDialogOpen(false);
            setSelectedProject(null);
            setDependencyType('requires');
            onUpdate?.();
        } catch (err) {
            console.error('Error adding dependency:', err);
            setError('Erreur lors de l\'ajout de la dépendance');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveDependency = async (dep: ProjectDependency) => {
        if (!user) return;

        setLoading(true);
        try {
            await updateDoc(doc(db, 'projects', project.id), {
                dependencies: arrayRemove(dep),
                dateUpdated: new Date().toISOString()
            });
            onUpdate?.();
        } catch (err) {
            console.error('Error removing dependency:', err);
            setError('Erreur lors de la suppression');
        } finally {
            setLoading(false);
        }
    };

    const getDependencyColor = (type: string) => {
        switch (type) {
            case 'blocks': return 'error';
            case 'requires': return 'warning';
            case 'related': return 'info';
            default: return 'default';
        }
    };

    const getDependencyLabel = (type: string) => {
        switch (type) {
            case 'blocks': return 'Bloqué par';
            case 'requires': return 'Requiert';
            case 'related': return 'Lié à';
            default: return type;
        }
    };

    // Projects already used as dependencies
    const usedProjectIds = new Set(dependencies.map(d => d.dependsOnProjectId));
    const availableProjects = allProjects.filter(p => !usedProjectIds.has(p.id));

    return (
        <Paper sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AccountTree color="primary" />
                    <Typography variant="h6">Dépendances du projet</Typography>
                </Box>
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Add />}
                    onClick={() => setDialogOpen(true)}
                    disabled={availableProjects.length === 0}
                >
                    Ajouter
                </Button>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {dependencies.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                    <LinkOff color="disabled" sx={{ fontSize: 48, mb: 1 }} />
                    <Typography color="text.secondary" variant="body2">
                        Aucune dépendance définie
                    </Typography>
                    <Typography color="text.secondary" variant="caption">
                        Les dépendances permettent de lier des projets qui doivent être complétés dans un ordre spécifique
                    </Typography>
                </Box>
            ) : (
                <List>
                    {dependencies.map((dep, index) => (
                        <React.Fragment key={dep.id}>
                            {index > 0 && <Divider />}
                            <ListItem>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
                                    <Chip
                                        label={getDependencyLabel(dep.dependencyType)}
                                        size="small"
                                        color={getDependencyColor(dep.dependencyType) as any}
                                    />
                                    <ArrowForward fontSize="small" color="action" />
                                </Box>
                                <ListItemText
                                    primary={
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {dep.dependsOnProjectCode} - {dep.dependsOnProjectName}
                                        </Typography>
                                    }
                                />
                                <ListItemSecondaryAction>
                                    <IconButton
                                        edge="end"
                                        size="small"
                                        onClick={() => handleRemoveDependency(dep)}
                                        disabled={loading}
                                    >
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </ListItemSecondaryAction>
                            </ListItem>
                        </React.Fragment>
                    ))}
                </List>
            )}

            {/* Add Dependency Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Ajouter une dépendance</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Type de relation</InputLabel>
                            <Select
                                value={dependencyType}
                                label="Type de relation"
                                onChange={(e) => setDependencyType(e.target.value as any)}
                            >
                                <MenuItem value="blocks">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip size="small" label="Bloqué par" color="error" />
                                        <Typography variant="caption" color="text.secondary">
                                            Ce projet ne peut pas avancer avant que l'autre soit terminé
                                        </Typography>
                                    </Box>
                                </MenuItem>
                                <MenuItem value="requires">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip size="small" label="Requiert" color="warning" />
                                        <Typography variant="caption" color="text.secondary">
                                            Ce projet dépend de l'autre mais peut avancer en parallèle
                                        </Typography>
                                    </Box>
                                </MenuItem>
                                <MenuItem value="related">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip size="small" label="Lié à" color="info" />
                                        <Typography variant="caption" color="text.secondary">
                                            Les projets sont liés mais indépendants
                                        </Typography>
                                    </Box>
                                </MenuItem>
                            </Select>
                        </FormControl>

                        <Autocomplete
                            options={availableProjects}
                            getOptionLabel={(option) => `${option.code} - ${option.name}`}
                            value={selectedProject}
                            onChange={(_, value) => setSelectedProject(value)}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    label="Projet"
                                    placeholder="Rechercher un projet..."
                                    size="small"
                                />
                            )}
                            renderOption={(props, option) => (
                                <li {...props}>
                                    <Box>
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {option.code} - {option.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {option.status === 'completed' ? '✅ Terminé' :
                                                option.status === 'in_progress' ? '🔄 En cours' :
                                                    option.status === 'blocked' ? '🔴 Bloqué' : '🟡 En attente'}
                                        </Typography>
                                    </Box>
                                </li>
                            )}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Annuler</Button>
                    <Button
                        variant="contained"
                        onClick={handleAddDependency}
                        disabled={!selectedProject || loading}
                    >
                        Ajouter
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default ProjectDependencies;
