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
    Chip
} from '@mui/material';
import { Sync, Search } from '@mui/icons-material';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { indexMeeting, indexProject, getTypesenseStatus, checkTypesenseHealth } from '../../services/typesenseService';
import type { Meeting } from '../../types/meeting.types';
import type { SearchableMeeting, SearchableProject } from '../../services/typesenseService';

const SearchIndexManager: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState<{
        type: 'success' | 'error' | 'info' | 'warning';
        message: string;
    } | null>(null);
    const [stats, setStats] = useState({ meetings: 0, projects: 0 });

    const { isConfigured } = getTypesenseStatus();

    const handleSync = async () => {
        setLoading(true);
        setStatus(null);
        setProgress(0);
        setStats({ meetings: 0, projects: 0 });

        try {
            // 1. Check connection
            const health = await checkTypesenseHealth();
            if (!health.accessible) {
                throw new Error(`Impossible de contacter Typesense: ${health.error || 'Erreur inconnue'}`);
            }

            // 2. Fetch all data
            setStatus({ type: 'info', message: 'Lecture des données Firestore...' });

            const meetingsSnapshot = await getDocs(query(collection(db, 'meetings')));
            const projectsSnapshot = await getDocs(query(collection(db, 'projects')));

            const totalDocs = meetingsSnapshot.size + projectsSnapshot.size;
            let processed = 0;

            if (totalDocs === 0) {
                setStatus({ type: 'warning', message: 'Aucune donnée trouvée à indexer.' });
                setLoading(false);
                return;
            }

            // 3. Index Meetings
            for (const doc of meetingsSnapshot.docs) {
                const data = doc.data() as Meeting;

                // Convert to SearchableMeeting format
                const searchableMeeting: SearchableMeeting = {
                    id: doc.id,
                    title: data.title || 'Sans titre',
                    // Ensure date is a string (handle Firestore Timestamp or Date object)
                    date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
                    dateTimestamp: data.date ? Math.floor(new Date(data.date).getTime() / 1000) : 0,
                    type: data.type,
                    status: data.status,
                    minutes: data.minutes || '',
                    agendaItemTitles: data.agendaItems?.map(i => i.title) || [],
                    resolutions: [], // Extract resolutions if possible
                    attendeeNames: data.attendees?.map(a => a.name) || []
                };

                await indexMeeting(searchableMeeting);

                processed++;
                setProgress((processed / totalDocs) * 100);
            }
            setStats(prev => ({ ...prev, meetings: meetingsSnapshot.size }));

            // 4. Index Projects
            // Note: Assuming 'projects' collection exists and has similar structure
            // Adjust type casting based on your actual Project type
            for (const doc of projectsSnapshot.docs) {
                const data = doc.data();

                const searchableProject: SearchableProject = {
                    id: doc.id,
                    code: data.code || '',
                    name: data.name || data.title || 'Sans nom',
                    description: data.description || '',
                    category: data.category || 'Général',
                    status: data.status || 'Actif',
                    priority: data.priority || 'Moyenne',
                    notes: data.notes || ''
                };

                await indexProject(searchableProject);

                processed++;
                setProgress((processed / totalDocs) * 100);
            }
            setStats(prev => ({ ...prev, projects: projectsSnapshot.size }));

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

    // if (!isConfigured) block removed to allow debug info to be seen

    return (
        <Card variant="outlined" sx={{ mt: 3 }}>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Search color="primary" />
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="h6">Indexation de la Recherche</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Synchronisez les données de Firestore vers Typesense Cloud pour activer la recherche full-text.
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
                        Typesense n'est pas configuré. Vérifiez les secrets GitHub (Production) ou .env.local (Local).
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
                            <Typography variant="body2" sx={{ minWidth: 100 }}><strong>Host:</strong></Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                {import.meta.env.VITE_TYPESENSE_HOST ?
                                    `${import.meta.env.VITE_TYPESENSE_HOST.substring(0, 5)}...` :
                                    '(Non défini)'}
                            </Typography>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Typography variant="body2" sx={{ minWidth: 100 }}><strong>API Key:</strong></Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                {import.meta.env.VITE_TYPESENSE_API_KEY ?
                                    (import.meta.env.VITE_TYPESENSE_API_KEY.length > 5 ? 'Présente (longueur OK)' : 'Trop courte') :
                                    '(Non définie)'}
                            </Typography>
                        </Stack>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Typography variant="body2" sx={{ minWidth: 100 }}><strong>Admin Key:</strong></Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                {import.meta.env.VITE_TYPESENSE_ADMIN_KEY ?
                                    'Présente (Cachée)' :
                                    '(Non définie)'}
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

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        {stats.meetings > 0 && <Chip label={`${stats.meetings} réunions`} size="small" />}
                        {stats.projects > 0 && <Chip label={`${stats.projects} projets`} size="small" />}
                    </Box>
                    <Button
                        variant="contained"
                        startIcon={loading ? <Sync sx={{ animation: 'spin 2s linear infinite' }} /> : <Sync />}
                        onClick={handleSync}
                        disabled={loading}
                    >
                        {loading ? 'Synchronisation...' : 'Lancer la synchronisation'}
                    </Button>
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
