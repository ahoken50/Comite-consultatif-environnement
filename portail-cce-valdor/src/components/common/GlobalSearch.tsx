import React, { useState } from 'react';
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
    Tooltip
} from '@mui/material';
import {
    Search as SearchIcon,
    Close as CloseIcon,
    Assignment,
    Event,
    Description,
    Person,
    Article
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

const GlobalSearch: React.FC = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    // Get data from Redux
    const projects = useSelector((state: RootState) => state.projects.items);
    const meetings = useSelector((state: RootState) => state.meetings.items);
    const documents = useSelector((state: RootState) => state.documents.items);
    const members = useSelector((state: RootState) => state.members.items);

    // Filter results
    const results: SearchResult[] = React.useMemo(() => {
        if (!query.trim()) return [];

        const lowerQuery = query.toLowerCase();
        const searchResults: SearchResult[] = [];

        // Projects
        projects.forEach(p => {
            if (p.name.toLowerCase().includes(lowerQuery) || p.code.toLowerCase().includes(lowerQuery)) {
                searchResults.push({
                    id: p.id,
                    type: 'project',
                    title: p.name,
                    subtitle: `${p.code} - ${p.status}`,
                    link: `/projects/${p.id}`,
                    date: p.dateUpdated
                });
            }
        });

        // Meetings
        meetings.forEach(m => {
            if (m.title.toLowerCase().includes(lowerQuery) || (m.location && m.location.toLowerCase().includes(lowerQuery))) {
                searchResults.push({
                    id: m.id,
                    type: 'meeting',
                    title: m.title,
                    subtitle: m.type === 'regular' ? 'Régulière' : 'Spéciale',
                    link: `/meetings/${m.id}`,
                    date: m.date
                });
            }
        });

        // Documents
        documents.forEach(d => {
            if (d.name.toLowerCase().includes(lowerQuery)) {
                searchResults.push({
                    id: d.id,
                    type: 'document',
                    title: d.name,
                    subtitle: `${(d.size / 1024).toFixed(0)} KB`,
                    link: d.url,
                    date: d.dateUploaded
                });
            }
        });

        // Members
        members.forEach(m => {
            if (m.displayName.toLowerCase().includes(lowerQuery) || m.email.toLowerCase().includes(lowerQuery)) {
                searchResults.push({
                    id: m.id,
                    type: 'member',
                    title: m.displayName,
                    subtitle: m.role,
                    link: `/members`
                });
            }
        });

        return searchResults.slice(0, 10); // Limit to 10 filtered results
    }, [query, projects, meetings, documents, members]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (e.target.value.trim()) {
            setAnchorEl(e.currentTarget);
            setShowResults(true);
        } else {
            setShowResults(false);
        }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (query.trim()) {
            setAnchorEl(e.currentTarget);
            setShowResults(true);
        }

        // Lazy load data if missing
        if (projects.length === 0) dispatch(fetchProjects());
        if (meetings.length === 0) dispatch(fetchMeetings());
        if (documents.length === 0) dispatch(fetchDocuments());
        if (members.length === 0) dispatch(fetchMembers());
    };

    const handleResultClick = (result: SearchResult) => {
        if (result.type === 'document') {
            window.open(result.link, '_blank');
        } else {
            navigate(result.link);
        }
        setShowResults(false);
        setQuery('');
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

    return (
        <ClickAwayListener onClickAway={() => setShowResults(false)}>
            <Box>
                <Search>
                    <SearchIconWrapper>
                        <SearchIcon />
                    </SearchIconWrapper>
                    <StyledInputBase
                        placeholder="Rechercher..."
                        inputProps={{ 'aria-label': 'search' }}
                        value={query}
                        onChange={handleSearchChange}
                        onFocus={handleFocus}
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
                    open={showResults && results.length > 0}
                    anchorEl={anchorEl}
                    placement="bottom-start"
                    transition
                    sx={{ zIndex: 1300, width: anchorEl?.clientWidth }}
                >
                    {({ TransitionProps }) => (
                        <Fade {...TransitionProps} timeout={350}>
                            <Paper elevation={4} sx={{ mt: 1, maxHeight: 400, overflow: 'auto' }}>
                                <List dense>
                                    <ListItem>
                                        <Typography variant="overline" color="text.secondary">
                                            RÉSULTATS ({results.length})
                                        </Typography>
                                    </ListItem>
                                    <Divider />
                                    {results.map((result) => (
                                        <ListItem
                                            key={`${result.type}-${result.id}`}
                                            disablePadding
                                        >
                                            <ListItemButton onClick={() => handleResultClick(result)}>
                                                <ListItemIcon sx={{ minWidth: 40 }}>
                                                    {getIcon(result.type)}
                                                </ListItemIcon>
                                                <ListItemText
                                                    primary={result.title}
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
                                    ))}
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
