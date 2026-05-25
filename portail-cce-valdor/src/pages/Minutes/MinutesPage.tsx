import React, { useEffect, useMemo, useCallback } from 'react';
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
    Button,
    Chip,
    IconButton,
    Tooltip
} from '@mui/material';
import { Edit, PictureAsPdf } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMeetings } from '../../features/meetings/meetingsSlice';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Meeting } from '../../types/meeting.types';

// ⚡ Bolt: Extract row into a React.memo component to prevent re-rendering when parent state changes (e.g. navigation)
// This avoids O(M*K) calculations per row per render.
const MeetingRow = React.memo(({ meeting, onEdit, onDownload }: { meeting: Meeting | any, onEdit: (id: string) => void, onDownload: (meeting: Meeting | any) => void }) => {
    // ⚡ Bolt: Memoize the status calculation (O(M*K)) which was previously inline and unmemoized
    const minutesStatus = useMemo(() => {
        const agendaItems = meeting.agendaItems || [];

        if (agendaItems.length === 0) {
            return <Chip label="À rédiger" color="warning" size="small" variant="outlined" />;
        }

        const itemsWithContent = agendaItems.filter((item: any) => {
            if (item.minuteEntries && item.minuteEntries.length > 0) {
                return item.minuteEntries.some((entry: any) =>
                    entry.content && entry.content.trim().length > 10
                );
            }
            if (item.decision && item.decision.trim().length > 10) {
                return true;
            }
            return false;
        });

        const completionRatio = itemsWithContent.length / agendaItems.length;

        if (completionRatio >= 0.8) {
            return <Chip label="Rédigé" color="success" size="small" variant="outlined" />;
        } else if (completionRatio > 0) {
            return <Chip label="En cours" color="info" size="small" variant="outlined" />;
        }

        return <Chip label="À rédiger" color="warning" size="small" variant="outlined" />;
    }, [meeting.agendaItems]);

    // ⚡ Bolt: Memoize the disable logic (O(M*K)) which was previously calculated on every single render
    const isPdfDisabled = useMemo(() => {
        return (!meeting.minutes || meeting.minutes.length < 5) &&
            !meeting.agendaItems?.some((item: any) =>
                item.minuteEntries?.some((entry: any) =>
                    entry.content && entry.content.trim().length > 10
                )
            );
    }, [meeting.minutes, meeting.agendaItems]);

    return (
        <TableRow hover>
            <TableCell>
                {format(new Date(meeting.date), 'd MMMM yyyy', { locale: fr })}
            </TableCell>
            <TableCell>{meeting.title}</TableCell>
            <TableCell>{minutesStatus}</TableCell>
            <TableCell align="right">
                <Tooltip title="Télécharger PDF">
                    <span>
                        <IconButton
                            onClick={() => onDownload(meeting)}
                            disabled={isPdfDisabled}
                            color="primary"
                        >
                            <PictureAsPdf />
                        </IconButton>
                    </span>
                </Tooltip>
                <Button
                    startIcon={<Edit />}
                    size="small"
                    onClick={() => onEdit(meeting.id)}
                    sx={{ ml: 1 }}
                >
                    Gérer
                </Button>
            </TableCell>
        </TableRow>
    );
});

const MinutesPage: React.FC = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const { items: meetings, loading } = useSelector((state: RootState) => state.meetings);

    useEffect(() => {
        dispatch(fetchMeetings());
    }, [dispatch]);

    // ⚡ Bolt: Memoize the expensive sorting operation (O(N log N) + date parsing)
    // Previously ran on every render loop
    const sortedMeetings = useMemo(() => {
        return [...meetings].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [meetings]);

    // ⚡ Bolt: Stabilize handlers to prevent invalidating React.memo children
    const handleEditMinutes = useCallback((meetingId: string) => {
        navigate(`/meetings/${meetingId}`, { state: { tab: 1 } });
    }, [navigate]);

    const handleDownloadPDF = useCallback(async (meeting: any) => {
        const { generateMinutesPDF } = await import('../../services/pdfServiceMinutes');
        generateMinutesPDF(meeting, meeting.minutes);
    }, []);

    if (loading) {
        return <Typography>Chargement...</Typography>;
    }

    return (
        <Box>
            <Typography variant="h4" fontWeight={700} gutterBottom>
                Procès-verbaux
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
                Gestion et consultation des procès-verbaux des assemblées.
            </Typography>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Titre de l'assemblée</TableCell>
                            <TableCell>Statut PV</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedMeetings.map((meeting) => (
                            <MeetingRow
                                key={meeting.id}
                                meeting={meeting}
                                onEdit={handleEditMinutes}
                                onDownload={handleDownloadPDF}
                            />
                        ))}
                        {sortedMeetings.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} align="center">
                                    Aucune assemblée trouvée.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default MinutesPage;
