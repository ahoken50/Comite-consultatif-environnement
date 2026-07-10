import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Box,
    InputBase,
    Paper,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Typography,
    Divider,
    IconButton,
    Popper,
    ClickAwayListener,
    Fade,
    ListItemIcon,
    Tooltip,
    Chip,
    Stack,
    CircularProgress
} from '@mui/material';
import {
    Search as SearchIcon,
    Close as CloseIcon,
    Assignment,
    Event,
    Description,
    Person,
    Article,
    History as HistoryIcon
} from '@mui/icons-material';
import { styled, alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { format } from 'date-fns';
import { fetchProjects } from '../../features/projects/projectsSlice';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { fetchDocuments } from '../../features/documents/documentsSlice';
import { fetchMembers } from '../../features/members/membersSlice';

// Styled Search Bar (inspired by Gmail/MUI examples)
const Search = styled('div')(({ theme }) => ({
    position: 'relative',
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.common.white, 0.15),
    '&:hover': {
        backgroundColor: alpha(theme.palette.common.white, 0.25),
    },
    marginRight: theme.spacing(2),
    marginLeft: 0,
    width: '100%',
    [theme.breakpoints.up('sm')]: {
        marginLeft: theme.spacing(3),
        width: 'auto',
    },
    minWidth: 300,
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
    padding: theme.spacing(0, 2),
    height: '100%',
    position: 'absolute',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
    color: 'inherit',
    width: '100%',
    '& .MuiInputBase-input': {
        padding: theme.spacing(1, 1, 1, 0),
        paddingLeft: `calc(1em + ${theme.spacing(4)})`,
        transition: theme.transitions.create('width'),
        width: '100%',
    },
}));

interface SearchResult {
    id: string;
    type: 'project' | 'meeting' | 'document' | 'member';
    title: string;
    subtitle?: string;
    link: string;
    date?: string;
}

type CategoryFilter = 'all' | 'project' | 'meeting' | 'document' | 'member';

const RECENT_SEARCHES_KEY = 'cce-recent-searches';
const MAX_RECENT_SEARCHES = 5;

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}

// Highlight matching terms
const HighlightText: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
    if (!highlight.trim()) return <>{text}</>;

    const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, i) =>
                regex.test(part) ? (
                    <Box component="mark" key={i} sx={{ bgcolor: 'warning.light', px: 0.25, borderRadius: 0.5 }}>
                        {part}
                    </Box>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    );
};

const GlobalSearch: React.FC = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const inputRef = useRef<HTMLInputElement>(null);

    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
    const [recentSearches, setRecentSearches] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    // Debounce the query for filtering
    const debouncedQuery = useDebounce(query, 300);

    // Get data from Redux
    const projects = useSelector((state: RootState) => state.projects.items);
    const meetings = useSelector((state: RootState) => state.meetings.items);
    const documents = useSelector((state: RootState) => state.documents.items);
    const members = useSelector((state: RootState) => state.members.items);


    // Ctrl+K keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const [localResults, setLocalResults] = useState<SearchResult[]>([]);
    const [supabaseResults, setSupabaseResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // 1. Local Search (Fast, Synchronous)
    useEffect(() => {
        if (!debouncedQuery.trim()) {
            setLocalResults([]);
            return;
        }

        const lowerQuery = debouncedQuery.toLowerCase();
        const results: SearchResult[] = [];

        // Projects
        if (categoryFilter === 'all' || categoryFilter === 'project') {
            projects.forEach(p => {
                if (p.name.toLowerCase().includes(lowerQuery) || p.code.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: p.id,
                        type: 'project',
                        title: p.name,
                        subtitle: `${p.code} - ${p.status}`,
                        link: `/projects/${p.id}`,
                        date: p.dateUpdated
                    });
                }
            });
        }

        // Meetings (Local Filtering)
        if (categoryFilter === 'all' || categoryFilter === 'meeting') {
            meetings.forEach(m => {
                if (m.title.toLowerCase().includes(lowerQuery) || (m.location && m.location.toLowerCase().includes(lowerQuery))) {
                    results.push({
                        id: m.id,
                        type: 'meeting',
                        title: m.title,
                        subtitle: m.type === 'regular' ? 'Régulière' : 'Spéciale',
                        link: `/meetings/${m.id}`,
                        date: m.date
                    });
                }
                // Note: We deliberately skip deep local search for minutes here because Supabase does it better/fuzzy
            });
        }

        // Documents
        if (categoryFilter === 'all' || categoryFilter === 'document') {
            documents.forEach(d => {
                if (d.name.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: d.id,
                        type: 'document',
                        title: d.name,
                        subtitle: `${(d.size / 1024).toFixed(0)} KB`,
                        link: d.url,
                        date: d.dateUploaded
                    });
                }
            });
        }

        // Members
        if (categoryFilter === 'all' || categoryFilter === 'member') {
            members.forEach(m => {
                if (m.displayName.toLowerCase().includes(lowerQuery) || m.email.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: m.id,
                        type: 'member',
                        title: m.displayName,
                        subtitle: m.role,
                        link: `/members`
                    });
                }
            });
        }

        setLocalResults(results);

    }, [debouncedQuery, projects, meetings, documents, members, categoryFilter]);

    // 2. Supabase Search (Async, optimized for Resolutions & Content)
    useEffect(() => {
        const fetchSupabaseResults = async () => {
            if (!debouncedQuery.trim()) {
                setSupabaseResults([]);
                return;
            }

            setIsSearching(true);
            try {
                const { searchResolutions } = await import('../../services/supabaseSearchService');
                const response = await searchResolutions(debouncedQuery, { matchCount: 5 });

                const mapped: SearchResult[] = response.hits.map(h => ({
                    id: h.document.id, // ID is synthetic meetingId-index
                    type: 'meeting', // We use 'meeting' icon but subtitle clarifies
                    title: h.document.number !== 'N/A' ? `Résolution ${h.document.number}` : h.document.topicTitle,
                    subtitle: `...${h.document.content.substring(0, 60)}...`,
                    link: `/meetings/${h.document.meetingId}#resolution-${h.document.id.split('-').slice(1).join('-')}`,
                    date: h.document.date
                }));

                setSupabaseResults(mapped);

            } catch (err) {
                console.error("Global search error:", err);
            } finally {
                setIsSearching(false);
            }
        };

        const timer = setTimeout(fetchSupabaseResults, 300); // Debounce API call slightly
        return () => clearTimeout(timer);
    }, [debouncedQuery]);

    // Merge results
    const results = useMemo(() => {
        const combined = [...localResults, ...supabaseResults];
        // Deduplicate by ID if necessary (though types usually differ)
        // Sort by relevance or date could be added here
        return combined.slice(0, 15);
    }, [localResults, supabaseResults]);

    // Save to recent searches
    const saveToRecent = useCallback((searchTerm: string) => {
        if (!searchTerm.trim()) return;

        setRecentSearches(prev => {
            const filtered = prev.filter(s => s.toLowerCase() !== searchTerm.toLowerCase());
            const updated = [searchTerm, ...filtered].slice(0, MAX_RECENT_SEARCHES);
            localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
            return updated;
        });
    }, []);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (e.target.value.trim()) {
            setAnchorEl(e.currentTarget);
            setShowResults(true);
            setSelectedIndex(-1);
        } else {
            setShowResults(false);
        }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setAnchorEl(e.currentTarget);
        setShowResults(true);

        // Lazy load data if missing
        if (projects.length === 0) dispatch(fetchProjects());
        if (meetings.length === 0) dispatch(fetchMeetings());
        if (documents.length === 0) dispatch(fetchDocuments());
        if (members.length === 0) dispatch(fetchMembers());
    };

    const handleResultClick = (result: SearchResult) => {
        saveToRecent(query);
        if (result.type === 'document') {
            window.open(result.link, '_blank');
        } else {
            navigate(result.link);
        }
        setShowResults(false);
        setQuery('');
    };

    const handleRecentClick = (searchTerm: string) => {
        setQuery(searchTerm);
        inputRef.current?.focus();
    };

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        const itemCount = results.length || recentSearches.length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => (prev < itemCount - 1 ? prev + 1 : 0));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : itemCount - 1));
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0) {
                    if (results.length > 0 && results[selectedIndex]) {
                        handleResultClick(results[selectedIndex]);
                    } else if (recentSearches[selectedIndex]) {
                        handleRecentClick(recentSearches[selectedIndex]);
                    }
                }
                break;
            case 'Escape':
                setShowResults(false);
                inputRef.current?.blur();
                break;
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'project': return <Assignment color="primary" />;
            case 'meeting': return <Event color="secondary" />;
            case 'document': return <Description color="action" />;
            case 'member': return <Person color="info" />;
            default: return <Article />;
        }
    };

    const categoryChips: { key: CategoryFilter; label: string }[] = [
        { key: 'all', label: 'Tout' },
        { key: 'project', label: 'Projets' },
        { key: 'meeting', label: 'Réunions' },
        { key: 'document', label: 'Documents' },
        { key: 'member', label: 'Membres' },
    ];

    return (
        <ClickAwayListener onClickAway={() => setShowResults(false)}>
            <Box>
                <Search>
                    <SearchIconWrapper>
                        {isSearching ? <CircularProgress size={20} color="inherit" /> : <SearchIcon />}
                    </SearchIconWrapper>
                    <StyledInputBase
                        inputRef={inputRef}
                        placeholder="Rechercher... (Ctrl+K)"
                        inputProps={{ 'aria-label': 'search' }}
                        value={query}
                        onChange={handleSearchChange}
                        onFocus={handleFocus}
                        onKeyDown={handleKeyDown}
                    />
                    {query && (
                        <Tooltip title="Effacer la recherche">
                            <IconButton
                                size="small"
                                aria-label="Effacer la recherche"
                                sx={{ position: 'absolute', right: 4, top: 4, color: 'white' }}
                                onClick={() => {
                                    setQuery('');
                                    setShowResults(false);
                                }}
                            >
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                </Search>

                <Popper
                    open={showResults}
                    anchorEl={anchorEl}
                    placement="bottom-start"
                    transition
                    sx={{ zIndex: 1300, width: anchorEl?.clientWidth ? Math.max(anchorEl.clientWidth, 400) : 400 }}
                >
                    {({ TransitionProps }) => (
                        <Fade {...TransitionProps} timeout={350}>
                            <Paper elevation={4} sx={{ mt: 1, maxHeight: 450, overflow: 'auto' }}>
                                {/* Category Filter Chips */}
                                <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                        {categoryChips.map(chip => (
                                            <Chip
                                                key={chip.key}
                                                label={chip.label}
                                                size="small"
                                                color={categoryFilter === chip.key ? 'primary' : 'default'}
                                                variant={categoryFilter === chip.key ? 'filled' : 'outlined'}
                                                onClick={() => setCategoryFilter(chip.key)}
                                                sx={{ cursor: 'pointer' }}
                                            />
                                        ))}
                                    </Stack>
                                </Box>

                                <List dense>
                                    {/* Show results if query exists */}
                                    {debouncedQuery.trim() && (
                                        <>
                                            <ListItem>
                                                <Typography variant="overline" color="text.secondary">
                                                    RÉSULTATS ({results.length})
                                                </Typography>
                                            </ListItem>
                                            <Divider />
                                            {results.length > 0 ? (
                                                results.map((result, index) => (
                                                    <ListItem
                                                        key={`${result.type}-${result.id}`}
                                                        disablePadding
                                                    >
                                                        <ListItemButton
                                                            onClick={() => handleResultClick(result)}
                                                            selected={selectedIndex === index}
                                                        >
                                                            <ListItemIcon sx={{ minWidth: 40 }}>
                                                                {getIcon(result.type)}
                                                            </ListItemIcon>
                                                            <ListItemText
                                                                primary={<HighlightText text={result.title} highlight={debouncedQuery} />}
                                                                secondary={
                                                                    <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                        <span>{result.subtitle}</span>
                                                                        {result.date && (
                                                                            <span>{format(new Date(result.date), 'dd/MM/yyyy')}</span>
                                                                        )}
                                                                    </Box>
                                                                }
                                                            />
                                                        </ListItemButton>
                                                    </ListItem>
                                                ))
                                            ) : (
                                                <ListItem>
                                                    <ListItemText
                                                        primary={
                                                            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                                                                Aucun résultat trouvé
                                                            </Typography>
                                                        }
                                                        secondary={
                                                            <Typography variant="caption" color="text.disabled" align="center" display="block">
                                                                Essayez d'autres mots-clés
                                                            </Typography>
                                                        }
                                                    />
                                                </ListItem>
                                            )}
                                        </>
                                    )}

                                    {/* Show recent searches when no query */}
                                    {!debouncedQuery.trim() && recentSearches.length > 0 && (
                                        <>
                                            <ListItem>
                                                <Typography variant="overline" color="text.secondary">
                                                    RECHERCHES RÉCENTES
                                                </Typography>
                                            </ListItem>
                                            <Divider />
                                            {recentSearches.map((term, index) => (
                                                <ListItem key={term} disablePadding>
                                                    <ListItemButton
                                                        onClick={() => handleRecentClick(term)}
                                                        selected={selectedIndex === index}
                                                    >
                                                        <ListItemIcon sx={{ minWidth: 40 }}>
                                                            <HistoryIcon color="action" fontSize="small" />
                                                        </ListItemIcon>
                                                        <ListItemText primary={term} />
                                                    </ListItemButton>
                                                </ListItem>
                                            ))}
                                        </>
                                    )}

                                    {/* Empty state when no query and no recent searches */}
                                    {!debouncedQuery.trim() && recentSearches.length === 0 && (
                                        <ListItem>
                                            <ListItemText
                                                primary={
                                                    <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                                                        Commencez à taper pour rechercher
                                                    </Typography>
                                                }
                                            />
                                        </ListItem>
                                    )}
                                </List>
                            </Paper>
                        </Fade>
                    )}
                </Popper>
            </Box>
        </ClickAwayListener>
    );
};

export default GlobalSearch;

