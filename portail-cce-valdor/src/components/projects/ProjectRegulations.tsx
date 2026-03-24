import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Grid,
    List, ListItem, ListItemText, ListItemSecondaryAction,
    IconButton, Alert, CircularProgress
} from '@mui/material';
import {
    Search, Delete, Add, AutoAwesome, CheckCircle
} from '@mui/icons-material';
import { useDispatch } from 'react-redux';
import type { Project } from '../../types/project.types';
import { searchRegulations, getRegulationsByIds, type SearchableRegulation } from '../../services/supabaseSearchService';
import { aiService } from '../../services/ai/UnifiedAIService';
import { updateProject } from '../../features/projects/projectsSlice';
import type { AppDispatch } from '../../store/store';

interface ProjectRegulationsProps {
    project: Project;
}

const ProjectRegulations: React.FC<ProjectRegulationsProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();

    // State
    const [linkedRegulations, setLinkedRegulations] = useState<SearchableRegulation[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchableRegulation[]>([]);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [aiReasoning, setAiReasoning] = useState<string | null>(null);

    const [loadingLinked, setLoadingLinked] = useState(false);

    // Initial load of linked regulations
    useEffect(() => {
        if (!project.linkedRegulationIds || project.linkedRegulationIds.length === 0) {
            setLinkedRegulations([]);
            return;
        }

        const fetchLinked = async () => {
            setLoadingLinked(true);
            try {
                const docs = await getRegulationsByIds(project.linkedRegulationIds!);
                setLinkedRegulations(docs);
            } catch (error) {
                console.error("Failed to load linked regulations", error);
            } finally {
                setLoadingLinked(false);
            }
        };

        fetchLinked();
    }, [project.linkedRegulationIds]);

    // Handle Search
    const handleSearch = async (queryToSearch: string = searchQuery) => {
        setLoading(true);
        try {
            const results = await searchRegulations(queryToSearch, { matchCount: 50 });
            setSearchResults(results.hits.map(h => h.document));
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setLoading(false);
        }
    };

    // Initial load of regulations list
    useEffect(() => {
        handleSearch('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Handle AI Analysis
    const handleAiAnalysis = async () => {
        setAnalyzing(true);
        setAiReasoning(null);
        try {
            const result = await aiService.analyzeProjectRegulations(
                `TITRE: ${project.name}\nDESCRIPTION: ${project.description}\nDÉTAILS: ${project.currentDetails}`
            );

            setAiReasoning(result.reasoning);

            if (result.relevantRegulationIds.length > 0) {
                // Fetch recommended regulations details to display them
                const docs = await getRegulationsByIds(result.relevantRegulationIds);
                setSearchResults(docs);
            } else {
                setSearchResults([]);
            }

        } catch (error) {
            console.error("AI Analysis failed", error);
        } finally {
            setAnalyzing(false);
        }
    };

    // Link a regulation
    const handleLink = async (reg: SearchableRegulation) => {
        const currentIds = project.linkedRegulationIds || [];
        if (currentIds.includes(reg.id)) return;

        const newIds = [...currentIds, reg.id];

        // Optimistic update
        setLinkedRegulations(prev => [...prev, reg]);

        try {
            await dispatch(updateProject({
                id: project.id,
                updates: { linkedRegulationIds: newIds },
                userId: 'system', // Should be current user
                userName: 'System',
                projectName: project.name
            })).unwrap();
        } catch (error) {
            console.error("Failed to link regulation", error);
            // Revert optimistic update
            setLinkedRegulations(prev => prev.filter(r => r.id !== reg.id));
        }
    };

    // Unlink
    const handleUnlink = async (regId: string) => {
        if (!confirm('Délier ce règlement ?')) return;

        const currentIds = project.linkedRegulationIds || [];
        const newIds = currentIds.filter(id => id !== regId);

        setLinkedRegulations(prev => prev.filter(r => r.id !== regId));

        try {
            await dispatch(updateProject({
                id: project.id,
                updates: { linkedRegulationIds: newIds },
                userId: 'system',
                userName: 'System',
                projectName: project.name
            })).unwrap();
        } catch (error) {
            console.error("Failed to unlink regulation", error);
        }
    };

    return (
        <Box>
            <Grid container spacing={3}>
                {/* LEFT: Linked Regulations */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="h6" gutterBottom>Règlements liés</Typography>
                    {linkedRegulations.length === 0 && !loadingLinked && (
                        <Alert severity="info" sx={{ mb: 2 }}>Aucun règlement lié à ce projet.</Alert>
                    )}

                    <List>
                        {linkedRegulations.map(reg => (
                            <Paper key={reg.id} elevation={1} sx={{ mb: 1 }}>
                                <ListItem>
                                    <ListItemText
                                        primary={reg.title}
                                        secondary={`${reg.category} • ${reg.status} • ${reg.year}`}
                                    />
                                    <ListItemSecondaryAction>
                                        <IconButton edge="end" color="error" onClick={() => handleUnlink(reg.id)}>
                                            <Delete />
                                        </IconButton>
                                    </ListItemSecondaryAction>
                                </ListItem>
                            </Paper>
                        ))}
                    </List>
                </Grid>

                {/* RIGHT: Search & AI */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="h6" gutterBottom>Ajouter des règlements</Typography>

                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="Rechercher..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyPress={e => e.key === 'Enter' && handleSearch(searchQuery)}
                            />
                            <Button variant="contained" onClick={() => handleSearch(searchQuery)} disabled={loading}>
                                <Search />
                            </Button>
                        </Box>

                        <Button
                            fullWidth
                            variant="outlined"
                            color="secondary"
                            startIcon={analyzing ? <CircularProgress size={20} /> : <AutoAwesome />}
                            onClick={handleAiAnalysis}
                            disabled={analyzing}
                            sx={{ mb: 2 }}
                        >
                            {analyzing ? 'Analyse en cours...' : 'Suggérer avec IA'}
                        </Button>

                        {aiReasoning && (
                            <Alert severity="success" sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" fontWeight="bold">Analyse IA :</Typography>
                                <Typography variant="body2">{aiReasoning}</Typography>
                            </Alert>
                        )}

                        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                            Résultats
                        </Typography>

                        <List dense>
                            {searchResults.map(reg => {
                                const isLinked = (project.linkedRegulationIds || []).includes(reg.id);
                                return (
                                    <ListItem key={reg.id} divider>
                                        <ListItemText
                                            primary={reg.title}
                                            secondary={reg.content.substring(0, 80) + "..."}
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                edge="end"
                                                color={isLinked ? "success" : "primary"}
                                                onClick={() => !isLinked && handleLink(reg)}
                                                disabled={isLinked}
                                            >
                                                {isLinked ? <CheckCircle /> : <Add />}
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                );
                            })}
                            {searchResults.length === 0 && !loading && searchQuery && (
                                <Typography variant="body2" color="textSecondary" align="center">
                                    Aucun résultat.
                                </Typography>
                            )}
                        </List>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default ProjectRegulations;
