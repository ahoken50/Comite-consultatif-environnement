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
    Link as MuiLink
} from '@mui/material';
import { Search, Gavel, Assignment } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

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
}

const ResolutionsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');

    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const { items: projects } = useSelector((state: RootState) => state.projects);

    useEffect(() => {
        if (meetings.length === 0) dispatch(fetchMeetings());
        if (projects.length === 0) dispatch(fetchProjects());
    }, [dispatch, meetings.length, projects.length]);

    const resolutions: ResolutionRow[] = useMemo(() => {
        const rows: ResolutionRow[] = [];

        meetings.forEach(meeting => {
            meeting.agendaItems.forEach(item => {
                if (item.minuteEntries) {
                    item.minuteEntries.forEach((entry, index) => {
                        if (entry.type === 'resolution') {
                            // Find linked project
                            const project = projects.find(p => p.id === item.linkedProjectId);

                            rows.push({
                                id: `${meeting.id}-${item.id}-${index}`,
                                number: entry.number || 'N/A',
                                content: entry.content,
                                date: meeting.date,
                                meetingId: meeting.id,
                                meetingTitle: meeting.title,
                                topicTitle: item.title,
                                projectId: item.linkedProjectId,
                                projectCode: project?.code
                            });
                        }
                    });
                }
            });
        });

        // Sort by date desc
        return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [meetings, projects]);

    const filteredResolutions = useMemo(() => {
        return resolutions.filter(r =>
            r.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.topicTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.projectCode && r.projectCode.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [resolutions, searchTerm]);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Gavel color="primary" sx={{ fontSize: 32 }} />
                    <Typography variant="h4" fontWeight={700}>
                        Registre des Résolutions
                    </Typography>
                </Box>
            </Box>

            <Paper sx={{ p: 2, mb: 3 }}>
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
                    }}
                />
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
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={500}>
                                            {format(new Date(row.date), 'd MMMM yyyy', { locale: fr })}
                                        </Typography>
                                        <MuiLink
                                            component="button"
                                            variant="caption"
                                            onClick={() => navigate(`/meetings/${row.meetingId}`)}
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
                                    <TableCell align="right">
                                        <Button
                                            size="small"
                                            onClick={() => navigate(`/meetings/${row.meetingId}`)}
                                        >
                                            Voir
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
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
