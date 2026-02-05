import React, { useState } from 'react';
import {
    Box,
    TextField,
    Typography,
    Card,
    CardContent,
    Stack,
    Chip,
    InputAdornment,
    IconButton,
    CircularProgress,
    Alert,
    Divider,
    Collapse
} from '@mui/material';
import { Search as SearchIcon, Gavel, Scale, History, Tune, AutoAwesome } from '@mui/icons-material';
import { searchMeetings, type SearchableMeeting } from '../../services/supabaseSearchService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import JurisprudenceChatBox from './JurisprudenceChatBox';

const JurisprudenceSearch: React.FC = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchableMeeting[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTime, setSearchTime] = useState(0);
    const [showFilters, setShowFilters] = useState(false);

    // Chat State
    const [mode, setMode] = useState<'search' | 'chat'>('search');

    // Search function
    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        try {
            const response = await searchMeetings(query, {
                matchCount: 15,
                // highlightFields: ['resolutions', 'minutes', 'agendaItemTitles'] // Not supported in first version of Supabase implementation
            });

            // Map results to documents
            setResults(response.hits.map(h => h.document));
            setSearchTime(response.searchTimeMs);
        } catch (error) {
            console.error('Search failed', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>

            {/* Header */}
            <Box sx={{ mb: 4, textAlign: 'center' }}>
                <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <Scale fontSize="large" color="primary" />
                    Jurisprudence & Décisions Antérieures
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    Recherchez dans l'historique des résolutions pour guider les décisions actuelles.
                    {mode === 'search' && 'La recherche sémantique trouve les concepts liés même sans les mots exacts.'}
                </Typography>

                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 2 }}>
                    <Chip
                        icon={<SearchIcon />}
                        label="Recherche Classique"
                        color={mode === 'search' ? 'primary' : 'default'}
                        onClick={() => setMode('search')}
                        clickable
                    />
                    <Chip
                        icon={<AutoAwesome />}
                        label="Assistant IA"
                        color={mode === 'chat' ? 'secondary' : 'default'}
                        onClick={() => setMode('chat')}
                        clickable
                    />
                </Box>
            </Box>

            {mode === 'search' ? (
                <>
                    {/* Search Bar */}
                    <Card elevation={3} sx={{ mb: 4 }}>
                        <CardContent>
                            <form onSubmit={handleSearch}>
                                <Stack spacing={2}>
                                    <TextField
                                        fullWidth
                                        placeholder="Ex: Dérogations pour marges de recul, clôtures en zone humide..."
                                        variant="outlined"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        InputProps={{
                                            startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton onClick={() => setShowFilters(!showFilters)}>
                                                        <Tune color={showFilters ? "primary" : "action"} />
                                                    </IconButton>
                                                </InputAdornment>
                                            )
                                        }}
                                    />

                                    <Collapse in={showFilters}>
                                        <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
                                            <Chip label="Résolutions Seulement" onDelete={() => { }} />
                                            <Chip label="Derniers 12 mois" variant="outlined" onClick={() => { }} />
                                            <Chip label="Environnement" variant="outlined" onClick={() => { }} />
                                        </Stack>
                                    </Collapse>
                                </Stack>
                            </form>
                        </CardContent>
                    </Card>

                    {/* Results Info */}
                    {results.length > 0 && (
                        <Typography variant="caption" display="block" sx={{ mb: 2, color: 'text.secondary' }}>
                            {results.length} résultats trouvés en {searchTime}ms
                        </Typography>
                    )}

                    {/* Empty State */}
                    {!loading && results.length === 0 && query && (
                        <Alert severity="info">Aucun résultat trouvé. Essayez des termes plus généraux.</Alert>
                    )}

                    {/* Results Grid */}
                    <Stack spacing={2}>
                        {loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                                <CircularProgress />
                            </Box>
                        ) : (
                            results.map((meeting) => (
                                <Card key={meeting.id} variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}>
                                    <CardContent>
                                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                                            <Box>
                                                <Typography variant="h6" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Gavel fontSize="small" color="secondary" />
                                                    {meeting.title}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <History fontSize="inherit" />
                                                    {format(new Date(meeting.date), 'd MMMM yyyy', { locale: fr })}
                                                </Typography>
                                            </Box>
                                            <Chip
                                                label={meeting.type}
                                                size="small"
                                                color={meeting.type === 'Ordinaire' ? 'primary' : 'warning'}
                                                variant="outlined"
                                            />
                                        </Stack>

                                        <Divider sx={{ my: 1.5 }} />

                                        {/* Resolutions Matching */}
                                        <Box>
                                            {meeting.resolutions && meeting.resolutions.length > 0 ? (
                                                <Stack spacing={1}>
                                                    {meeting.resolutions.slice(0, 3).map((res, idx) => (
                                                        <Typography key={idx} variant="body2" sx={{
                                                            borderLeft: '3px solid',
                                                            borderColor: 'primary.light',
                                                            pl: 1,
                                                            bgcolor: 'background.paper',
                                                            p: 1
                                                        }}>
                                                            {res}
                                                        </Typography>
                                                    ))}
                                                    {meeting.resolutions.length > 3 && (
                                                        <Typography variant="caption" color="primary">
                                                            + {meeting.resolutions.length - 3} autres résolutions...
                                                        </Typography>
                                                    )}
                                                </Stack>
                                            ) : (
                                                <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                                    Aucune résolution explicite indexée.
                                                </Typography>
                                            )}
                                        </Box>
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </Stack>
                </>
            ) : (
                /* Chat Mode */
                <Card elevation={3}>
                    <JurisprudenceChatBox height="60vh" />
                </Card>
            )}
        </Box>
    );
};

export default JurisprudenceSearch;
