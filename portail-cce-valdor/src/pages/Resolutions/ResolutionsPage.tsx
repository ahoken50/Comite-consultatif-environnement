import React, { useEffect, useState, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    TextField,
    InputAdornment,
    Button,
    Link as MuiLink,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress
} from '@mui/material';
import { Search, Gavel, Assignment } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import { ProjectStatusLabels } from '../../constants';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import Breadcrumbs from '../../components/common/Breadcrumbs'; // [NEW]

interface ResolutionRow {
    id: string; // Unique ID (meetingId-agendaId-entryIndex)
    number: string;
    content: string;
    date: string;
    meetingId: string;
    meetingTitle: string;
    topicTitle: string;
    projectId?: string;
    projectCode?: string;
    status?: string; // [NEW] Status derived from linked project
}

const ResolutionsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all'); // [NEW]

    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const { items: projects } = useSelector((state: RootState) => state.projects);

    useEffect(() => {
        if (meetings.length === 0) dispatch(fetchMeetings());
        if (projects.length === 0) dispatch(fetchProjects());
    }, [dispatch, meetings.length, projects.length]);

    // Optimize: Create a Map for O(1) project lookup instead of O(N) find inside the loop
    const projectsMap = useMemo(() => {
        return new Map(projects.map(p => [p.id, p]));
    }, [projects]);

    const resolutions: ResolutionRow[] = useMemo(() => {
        const rows: ResolutionRow[] = [];

        meetings.forEach(meeting => {
            meeting.agendaItems.forEach(item => {
                // Check minuteEntries array first (new format)
                if (item.minuteEntries && item.minuteEntries.length > 0) {
                    item.minuteEntries.forEach((entry, index) => {
                        if (entry.type === 'resolution') {
                            // Find linked project - optimized with O(1) lookup
                            const project = item.linkedProjectId ? projectsMap.get(item.linkedProjectId) : undefined;

                            rows.push({
                                id: `${meeting.id}-${item.id}-${index}`,
                                number: entry.number || 'N/A',
                                content: entry.content,
                                date: meeting.date,
                                meetingId: meeting.id,
                                meetingTitle: meeting.title,
                                topicTitle: item.title,
                                projectId: item.linkedProjectId,
                                projectCode: project?.code,
                                status: project?.status || 'Non lié' // [NEW] Default to 'Non lié' if no project
                            });
                        }
                    });
                }
                // Fallback: Check legacy format (minuteType, minuteNumber directly on item)
                else if ((item as any).minuteType === 'resolution' && (item as any).minuteNumber) {
                    const project = item.linkedProjectId ? projectsMap.get(item.linkedProjectId) : undefined;

                    rows.push({
                        id: `${meeting.id}-${item.id}-legacy`,
                        number: (item as any).minuteNumber || 'N/A',
                        content: (item as any).decision || item.description || '',
                        date: meeting.date,
                        meetingId: meeting.id,
                        meetingTitle: meeting.title,
                        topicTitle: item.title,
                        projectId: item.linkedProjectId,
                        projectCode: project?.code,
                        status: project?.status || 'Non lié'
                    });
                }
            });
        });

        // Sort by date desc
        return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [meetings, projectsMap]);

    // [NEW] Get unique statuses for filter
    const uniqueStatuses = useMemo(() => {
        const statuses = new Set(resolutions.map(r => r.status).filter(Boolean));
        return Array.from(statuses).sort();
    }, [resolutions]);

    // [MODIFIED] Supabase Search Integration
    const [searchResults, setSearchResults] = useState<ResolutionRow[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchMode, setSearchMode] = useState(false); // true if using Supabase results

    // Debounce search
    useEffect(() => {
        const performSearch = async () => {
            if (!searchTerm.trim()) {
                setSearchMode(false);
                return;
            }

            setIsSearching(true);
            setSearchMode(true);

            try {
                // Import dynamically to avoid circular deps if any, or just use imported service
                // Assuming searchResolutions is available in supabaseSearchService
                const { searchResolutions } = await import('../../services/supabaseSearchService');

                const results = await searchResolutions(searchTerm, { matchCount: 50 });

                // Map to ResolutionRow
                const mapped: ResolutionRow[] = results.hits.map(h => ({
                    id: h.document.id,
                    number: h.document.number,
                    content: h.document.content,
                    date: h.document.date,
                    meetingId: h.document.meetingId,
                    meetingTitle: h.document.meetingTitle,
                    topicTitle: h.document.topicTitle,
                    status: 'Inconnu' // Search index might not have live project status
                }));

                setSearchResults(mapped);
            } catch (error) {
                console.error("Search failed", error);
            } finally {
                setIsSearching(false);
            }
        };

        const timer = setTimeout(performSearch, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const filteredResolutions = useMemo(() => {
        // If in Supabase Search Mode, use API results
        if (searchMode) return searchResults;

        // Otherwise, use local Redux filtering (Default view)
        return resolutions.filter(r => {
            const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
            return matchesStatus; // Only status filter applies here since search text triggers Search Mode
        });
    }, [resolutions, searchResults, searchMode, statusFilter]);

    // [NEW] Helper for status colors
    const getStatusColor = (status?: string) => {
        switch (status?.toLowerCase()) {
            case 'complété':
            case 'terminé':
                return 'success';
            case 'en cours':
                return 'primary';
            case 'en attente':
                return 'warning';
            case 'annulé':
                return 'error';
            case 'nouveau':
                return 'info';
            default:
                return 'default';
        }
    };

    return (
        <Box>
            <Breadcrumbs
                items={[
                    { label: 'Accueil', to: '/dashboard' },
                    { label: 'Résolutions' }
                ]}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Gavel color="primary" sx={{ fontSize: 32 }} />
                    <Typography variant="h4" fontWeight={700}>
                        Registre des Résolutions
                    </Typography>
                </Box>
            </Box>

            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        fullWidth
                        placeholder="Rechercher par numéro, contenu, sujet ou code projet..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search color="action" />
                                </InputAdornment>
                            ),
                            endAdornment: isSearching ? (
                                <InputAdornment position="end">
                                    <CircularProgress size={20} />
                                </InputAdornment>
                            ) : null
                        }}
                    />
                    <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel size="small">Filtrer par statut</InputLabel>
                        <Select
                            value={statusFilter}
                            label="Filtrer par statut"
                            onChange={(e) => setStatusFilter(e.target.value)}
                            size="small"
                        >
                            <MenuItem value="all"><em>Tous les statuts</em></MenuItem>
                            {uniqueStatuses.map(status => (
                                <MenuItem key={status} value={status}>{status}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
            </Paper>

            <TableContainer component={Paper}>
                <Table sx={{ minWidth: 650 }}>
                    <TableHead>
                        <TableRow sx={{ bgcolor: 'background.default' }}>
                            <TableCell><strong>Numéro</strong></TableCell>
                            <TableCell><strong>Date / Réunion</strong></TableCell>
                            <TableCell><strong>Sujet</strong></TableCell>
                            <TableCell><strong>Contenu de la décision</strong></TableCell>
                            <TableCell><strong>Projet Lié</strong></TableCell>
                            <TableCell><strong>Statut</strong></TableCell> {/* [NEW] */}
                            <TableCell align="right"><strong>Action</strong></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filteredResolutions.length > 0 ? (
                            filteredResolutions.map((row) => (
                                <TableRow key={row.id} hover>
                                    <TableCell>
                                        <Chip
                                            label={row.number}
                                            color="primary"
                                            variant="outlined"
                                            size="small"
                                            sx={{ fontWeight: 'bold' }}
                                        />
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 180, minWidth: 120 }}>
                                        <Typography variant="body2" fontWeight={500}>
                                            {format(new Date(row.date), 'd MMMM yyyy', { locale: fr })}
                                        </Typography>
                                        <MuiLink
                                            component="button"
                                            variant="caption"
                                            onClick={() => navigate(`/meetings/${row.meetingId}`)}
                                            sx={{
                                                display: 'block',
                                                textAlign: 'left',
                                                maxWidth: '100%',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}
                                            title={row.meetingTitle}
                                        >
                                            {row.meetingTitle}
                                        </MuiLink>
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 200 }}>
                                        <Typography variant="body2" noWrap title={row.topicTitle}>
                                            {row.topicTitle}
                                        </Typography>
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 400 }}>
                                        <Typography variant="body2" sx={{
                                            display: '-webkit-box',
                                            overflow: 'hidden',
                                            WebkitBoxOrient: 'vertical',
                                            WebkitLineClamp: 3
                                        }}>
                                            {row.content}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        {row.projectId ? (
                                            <Chip
                                                icon={<Assignment />}
                                                label={row.projectCode || 'Projet'}
                                                onClick={() => navigate(`/projects/${row.projectId}`)}
                                                size="small"
                                                clickable
                                            />
                                        ) : (
                                            <Typography variant="caption" color="textSecondary">-</Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={ProjectStatusLabels[row.status as keyof typeof ProjectStatusLabels] || row.status || 'N/A'}
                                            color={getStatusColor(row.status) as any}
                                            size="small"
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        <Button
                                            size="small"
                                            onClick={() => navigate(`/meetings/${row.meetingId}#resolution-${row.id.split('-').slice(1).join('-')}`, { state: { tab: 1 } })}
                                        >
                                            Voir
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                                    <Typography color="textSecondary">
                                        Aucune résolution trouvée {searchTerm && `pour "${searchTerm}"`}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default ResolutionsPage;
