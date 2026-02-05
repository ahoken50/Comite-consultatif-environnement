import React, { useState } from 'react';
import {
    Box,
    Button,
    Typography,
    LinearProgress,
    Alert,
    Card,
    CardContent,
    Stack,
    Chip,
    FormControlLabel,
    Checkbox,
    Tooltip
} from '@mui/material';
import { Sync, Search, Info } from '@mui/icons-material';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { checkSupabaseHealth } from '../../services/supabaseSearchService';
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore';

const SearchIndexManager: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [generateEmbeddings, setGenerateEmbeddings] = useState(false);
    const [status, setStatus] = useState<{
        type: 'success' | 'error' | 'info' | 'warning';
        message: string;
    } | null>(null);
    const [stats, setStats] = useState({ meetings: 0, projects: 0 });

    const [isConfigured, setIsConfigured] = useState(true);

    React.useEffect(() => {
        checkSupabaseHealth().then(h => setIsConfigured(h.configured));
    }, []);

    const handleSync = async () => {
        setLoading(true);
        setStatus(null);
        setProgress(0);
        setStats({ meetings: 0, projects: 0 });

        try {
            // 1. Check connection
            const health = await checkSupabaseHealth();
            if (!health.accessible) {
                throw new Error(`Impossible de contacter Supabase: ${health.error || 'Erreur inconnue'}`);
            }

            // 2. Ensure Collections Exist
            setStatus({ type: 'info', message: 'Vérification de la santé...' });

            // 3. Trigger Sync via Firestore Update
            setStatus({ type: 'info', message: 'Déclenchement de la réindexation (mise à jour Firestore)...' });

            const meetingsSnapshot = await getDocs(query(collection(db, 'meetings')));
            const projectsSnapshot = await getDocs(query(collection(db, 'projects')));

            const totalDocs = meetingsSnapshot.size + projectsSnapshot.size;
            let processed = 0;

            if (totalDocs === 0) {
                setStatus({ type: 'warning', message: 'Aucune donnée trouvée à indexer.' });
                setLoading(false);
                return;
            }

            // 3. Index Meetings (Trigger Update)
            for (const docSnap of meetingsSnapshot.docs) {
                // Updating a field triggers the Cloud Function 'syncMeetingToSupabase'
                await updateDoc(doc(db, 'meetings', docSnap.id), {
                    _forceSync: serverTimestamp()
                } as any);

                processed++;
                setProgress((processed / totalDocs) * 100);
            }
            setStats((prev: any) => ({ ...prev, meetings: meetingsSnapshot.size }));

            // 4. Index Projects (Trigger Update)
            for (const docSnap of projectsSnapshot.docs) {
                await updateDoc(doc(db, 'projects', docSnap.id), {
                    _forceSync: serverTimestamp()
                } as any);

                processed++;
                setProgress((processed / totalDocs) * 100);
            }
            setStats((prev: { meetings: number; projects: number }) => ({ ...prev, projects: projectsSnapshot.size }));

            setStatus({
                type: 'success',
                message: `Indexation terminée avec succès ! (${meetingsSnapshot.size} réunions, ${projectsSnapshot.size} projets)`
            });

        } catch (error) {
            console.error('Indexing failed:', error);
            setStatus({
                type: 'error',
                message: error instanceof Error ? error.message : 'Erreur lors de l\'indexation'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleRepairRegulations = async () => {
        if (!confirm("ATTENTION: Cette action va supprimer l'index des Règlements dans Typesense et le recréer à partir de Firebase.\n\nAssurez-vous que vos règlements sont bien sauvegardés dans la base de données Firebase (les uploads récents le sont).\n\nVoulez-vous continuer ?")) return;

        setLoading(true);
        setStatus({ type: 'info', message: 'Réinitialisation de la collection...' });
        setProgress(0);

        try {
            // 1. Reset Collection (Delete & Re-create Schema)
            // await resetCollection('regulations'); // No longer needed for Supabase or handled via SQL
            // For now, we just touch files to re-sync

            // 2. Fetch from Firestore
            setStatus({ type: 'info', message: 'Lecture des règlements dans Firebase...' });
            const snapshot = await getDocs(query(collection(db, 'regulations')));

            if (snapshot.empty) {
                setStatus({ type: 'warning', message: 'Index réinitialisé, mais aucun règlement trouvé dans Firebase à indexer.' });
                setLoading(false);
                return;
            }

            const total = snapshot.size;
            let processed = 0;

            // 3. Re-index (Trigger Update)
            for (const docSnap of snapshot.docs) {
                await updateDoc(doc(db, 'regulations', docSnap.id), {
                    _forceSync: serverTimestamp()
                } as any);

                processed++;
                setProgress((processed / total) * 100);
            }

            setStatus({ type: 'success', message: `Réparation terminée ! ${total} règlements ré-indexés avec succès.` });

        } catch (error) {
            console.error('Repair failed', error);
            setStatus({ type: 'error', message: "Échec de la réparation: " + (error instanceof Error ? error.message : String(error)) });
        } finally {
            setLoading(false);
        }
    };

    // if (!isConfigured) block removed to allow debug info to be seen

    return (
        <Card variant="outlined" sx={{ mt: 3 }}>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Search color="primary" />
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="h6">Indexation de la Recherche</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Synchronisez les données de Firestore vers Supabase pour activer la recherche full-text.
                        </Typography>
                    </Box>
                    <Chip
                        label={isConfigured ? "Configuré" : "Non configuré"}
                        color={isConfigured ? "success" : "error"}
                        size="small"
                        variant="outlined"
                    />
                </Box>

                {!isConfigured && (
                    <Alert severity="warning" sx={{ mb: 3 }}>
                        Supabase n'est pas configuré. Vérifiez (.env.local).
                        Consultez le panneau de diagnostic ci-dessous.
                    </Alert>
                )}

                <Box sx={{ mb: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" display="block" color="text.secondary" gutterBottom>
                        Configuration Debug (Production)
                    </Typography>
                    <Stack spacing={1}>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Typography variant="body2" sx={{ minWidth: 100 }}><strong>Status:</strong></Typography>
                            <Chip
                                label={isConfigured ? "Prêt" : "Manquant"}
                                color={isConfigured ? "success" : "error"}
                                size="small"
                            />
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Typography variant="body2" sx={{ minWidth: 100 }}><strong>Admin Key:</strong></Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                (Managed via Backend)
                            </Typography>
                        </Stack>
                    </Stack>
                </Box>

                {loading && (
                    <Box sx={{ mb: 2 }}>
                        <LinearProgress variant="determinate" value={progress} sx={{ mb: 1, height: 8, borderRadius: 1 }} />
                        <Typography variant="caption" color="text.secondary" align="right" display="block">
                            {Math.round(progress)}%
                        </Typography>
                    </Box>
                )}

                {status && (
                    <Alert
                        severity={status.type}
                        sx={{ mb: 2 }}
                        action={status.type === 'success' && (
                            <Button color="inherit" size="small" onClick={() => setStatus(null)}>
                                OK
                            </Button>
                        )}
                    >
                        {status.message}
                    </Alert>
                )}

                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={generateEmbeddings}
                                onChange={(e) => setGenerateEmbeddings(e.target.checked)}
                            />
                        }
                        label="Générer les embeddings IA"
                    />
                    <Tooltip title="Cochez pour activer la recherche sémantique (Jurisprudence). Attention: Cela utilise des crédits IA (Modèle optimisé).">
                        <Info fontSize="small" color="action" sx={{ ml: 1, cursor: 'pointer' }} />
                    </Tooltip>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        {stats.meetings > 0 && <Chip label={`${stats.meetings} réunions`} size="small" />}
                        {stats.projects > 0 && <Chip label={`${stats.projects} projets`} size="small" />}
                    </Box>
                    <Stack direction="row" spacing={2}>
                        <Button
                            variant="outlined"
                            color="warning"
                            onClick={handleRepairRegulations}
                            disabled={loading}
                        >
                            Réparer Règlements (IA)
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={loading ? <Sync sx={{ animation: 'spin 2s linear infinite' }} /> : <Sync />}
                            onClick={handleSync}
                            disabled={loading}
                        >
                            {loading ? 'Synchronisation...' : 'Lancer la synchronisation'}
                        </Button>
                    </Stack>
                </Box>
            </CardContent>
            <style>
                {`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}
            </style>
        </Card>
    );
};

export default SearchIndexManager;
