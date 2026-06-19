import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Alert,
    CircularProgress,
    Card,
    CardContent,
    Grid,
    LinearProgress,
    Chip
} from '@mui/material';
import { CompareArrows, Merge } from '@mui/icons-material';
import type { Project } from '../../types/project.types';
import { useDispatch, useSelector } from 'react-redux';
import { mergeProjects } from '../../features/projects/projectsSlice';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';

interface ProjectSimilarityDialogProps {
    open: boolean;
    onClose: () => void;
    allProjects: Project[];
}

interface SimilarityPair {
    projectA: Project;
    projectB: Project;
    score: number;
}

// Helper to normalize and tokenize string
function tokenize(str: string): Set<string> {
    const normalized = str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ") // Remove punctuation
        .trim();
    
    return new Set(normalized.split(/\s+/).filter(w => w.length > 2));
}

// Jaccard similarity coefficient
function calculateJaccard(str1: string, str2: string): number {
    const set1 = tokenize(str1);
    const set2 = tokenize(str2);
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    let intersection = 0;
    set1.forEach(val => {
        if (set2.has(val)) intersection++;
    });
    
    const union = set1.size + set2.size - intersection;
    return intersection / union;
}

const ProjectSimilarityDialog: React.FC<ProjectSimilarityDialogProps> = ({
    open,
    onClose,
    allProjects
}) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const [loadingPairId, setLoadingPairId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Compute similarity pairs
    const similarityPairs = useMemo(() => {
        const pairs: SimilarityPair[] = [];
        
        for (let i = 0; i < allProjects.length; i++) {
            for (let j = i + 1; j < allProjects.length; j++) {
                const pA = allProjects[i];
                const pB = allProjects[j];
                
                const titleSim = calculateJaccard(pA.name, pB.name);
                const descSim = calculateJaccard(pA.description || '', pB.description || '');
                
                // Weight title similarity higher than description similarity
                const hasDesc = pA.description && pB.description;
                const score = hasDesc ? (titleSim * 0.7 + descSim * 0.3) : titleSim;
                
                // Only suggest if similarity score is over 30%
                if (score > 0.3) {
                    pairs.push({
                        projectA: pA,
                        projectB: pB,
                        score: Math.round(score * 100)
                    });
                }
            }
        }
        
        // Sort by score descending
        return pairs.sort((a, b) => b.score - a.score);
    }, [allProjects]);

    const handleMerge = async (source: Project, target: Project, pairKey: string) => {
        if (!user) return;

        if (!window.confirm(`Voulez-vous fusionner "${source.name}" DANS "${target.name}" ?\n\n"${source.name}" sera SUPPRIMÉ définitivement et ses données seront transférées dans "${target.name}".`)) {
            return;
        }

        setLoadingPairId(pairKey);
        setError(null);
        setSuccessMessage(null);

        try {
            await dispatch(mergeProjects({
                sourceProjectId: source.id,
                targetProjectId: target.id,
                user,
                sourceProjectName: source.name,
                targetProjectName: target.name
            })).unwrap();

            setSuccessMessage(`Fusion réussie : "${source.name}" a été fusionné dans "${target.name}".`);
        } catch (err: any) {
            console.error("Similarity merge failed", err);
            setError(typeof err === 'string' ? err : "Une erreur est survenue lors de la fusion.");
        } finally {
            setLoadingPairId(null);
        }
    };

    return (
        <Dialog open={open} onClose={loadingPairId ? undefined : onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ fontWeight: 700 }}>
                Détection de projets similaires & doublons
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="textSecondary" paragraph sx={{ mb: 3 }}>
                    Cette boîte de dialogue compare automatiquement tous vos projets pour identifier les doublons potentiels. 
                    Vous pouvez fusionner un projet doublon dans son projet principal en cliquant sur le bouton de fusion correspondant.
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                {successMessage && <Alert severity="success" sx={{ mb: 2 }}>{successMessage}</Alert>}

                {similarityPairs.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography variant="h6" color="textSecondary" gutterBottom>
                            Aucun projet similaire détecté 🎉
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                            Tous vos projets actifs semblent bien distincts et structurés.
                        </Typography>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {similarityPairs.map((pair) => {
                            const pairKey = `${pair.projectA.id}-${pair.projectB.id}`;
                            const isPairLoading = loadingPairId === pairKey;

                            return (
                                <Card key={pairKey} variant="outlined" sx={{ position: 'relative', overflow: 'visible' }}>
                                    <CardContent sx={{ p: 3 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Chip label={`${pair.score}% de similitude`} color={pair.score > 60 ? "error" : "warning"} size="small" sx={{ fontWeight: 600 }} />
                                            </Box>
                                            <Box sx={{ width: '40%', mr: 1 }}>
                                                <LinearProgress variant="determinate" value={pair.score} color={pair.score > 60 ? "error" : "warning"} sx={{ height: 6, borderRadius: 3 }} />
                                            </Box>
                                        </Box>

                                        <Grid container spacing={2} alignItems="stretch">
                                            <Grid size={{ xs: 5.5 }}>
                                                <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, height: '100%' }}>
                                                    <Typography variant="caption" color="textSecondary" fontWeight="bold">Projet A</Typography>
                                                    <Typography variant="subtitle2" sx={{ mt: 0.5, fontWeight: 700 }}>
                                                        {pair.projectA.code} - {pair.projectA.name}
                                                    </Typography>
                                                    <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1, maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {pair.projectA.description || "Aucune description"}
                                                    </Typography>
                                                </Box>
                                            </Grid>

                                            <Grid size={{ xs: 1 }} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <CompareArrows color="action" />
                                            </Grid>

                                            <Grid size={{ xs: 5.5 }}>
                                                <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, height: '100%' }}>
                                                    <Typography variant="caption" color="textSecondary" fontWeight="bold">Projet B</Typography>
                                                    <Typography variant="subtitle2" sx={{ mt: 0.5, fontWeight: 700 }}>
                                                        {pair.projectB.code} - {pair.projectB.name}
                                                    </Typography>
                                                    <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1, maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {pair.projectB.description || "Aucune description"}
                                                    </Typography>
                                                </Box>
                                            </Grid>
                                        </Grid>

                                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3, pt: 2, borderTop: '1px dashed', borderColor: 'divider' }}>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="primary"
                                                startIcon={isPairLoading ? <CircularProgress size={16} /> : <Merge />}
                                                onClick={() => handleMerge(pair.projectA, pair.projectB, pairKey)}
                                                disabled={!!loadingPairId}
                                            >
                                                Fusionner A dans B
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="primary"
                                                startIcon={isPairLoading ? <CircularProgress size={16} /> : <Merge />}
                                                onClick={() => handleMerge(pair.projectB, pair.projectA, pairKey)}
                                                disabled={!!loadingPairId}
                                            >
                                                Fusionner B dans A
                                            </Button>
                                        </Box>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={!!loadingPairId}>
                    Fermer
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ProjectSimilarityDialog;
