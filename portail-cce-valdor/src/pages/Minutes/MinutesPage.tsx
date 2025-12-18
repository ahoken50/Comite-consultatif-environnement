import React, { useEffect } from 'react';
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
import { generateMinutesPDF } from '../../services/pdfServiceMinutes';

const MinutesPage: React.FC = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const { items: meetings, loading } = useSelector((state: RootState) => state.meetings);

    useEffect(() => {
        dispatch(fetchMeetings());
    }, [dispatch]);

    // Sort meetings by date descending
    const sortedMeetings = [...meetings].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const handleEditMinutes = (meetingId: string) => {
        // Navigate to Meeting Detail, Tab 1 (Procès-verbal)
        navigate(`/meetings/${meetingId}`, { state: { tab: 1 } });
    };

    const handleDownloadPDF = (meeting: any) => {
        generateMinutesPDF(meeting, meeting.minutes);
    };

    const getMinutesStatus = (meeting: any) => {
        // Check if agendaItems have minute entries with content
        const agendaItems = meeting.agendaItems || [];

        if (agendaItems.length === 0) {
            return <Chip label="À rédiger" color="warning" size="small" variant="outlined" />;
        }

        // Count items that have minute entries with content
        const itemsWithContent = agendaItems.filter((item: any) => {
            // Check new format (minuteEntries array)
            if (item.minuteEntries && item.minuteEntries.length > 0) {
                return item.minuteEntries.some((entry: any) =>
                    entry.content && entry.content.trim().length > 10
                );
            }
            // Check legacy format (decision field)
            if (item.decision && item.decision.trim().length > 10) {
                return true;
            }
            return false;
        });

        const completionRatio = itemsWithContent.length / agendaItems.length;

        if (completionRatio >= 0.8) {
            // 80%+ items have content = Rédigé
            return <Chip label="Rédigé" color="success" size="small" variant="outlined" />;
        } else if (completionRatio > 0) {
            // Some items have content = En cours
            return <Chip label="En cours" color="info" size="small" variant="outlined" />;
        }

        // No items have content = À rédiger
        return <Chip label="À rédiger" color="warning" size="small" variant="outlined" />;
    };

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
                            <TableRow key={meeting.id} hover>
                                <TableCell>
                                    {format(new Date(meeting.date), 'd MMMM yyyy', { locale: fr })}
                                </TableCell>
                                <TableCell>{meeting.title}</TableCell>
                                <TableCell>{getMinutesStatus(meeting)}</TableCell>
                                <TableCell align="right">
                                    <Tooltip title="Télécharger PDF">
                                        <IconButton
                                            onClick={() => handleDownloadPDF(meeting)}
                                            disabled={!meeting.minutes || meeting.minutes.length < 5}
                                            color="primary"
                                        >
                                            <PictureAsPdf />
                                        </IconButton>
                                    </Tooltip>
                                    <Button
                                        startIcon={<Edit />}
                                        size="small"
                                        onClick={() => handleEditMinutes(meeting.id)}
                                        sx={{ ml: 1 }}
                                    >
                                        Gérer
                                    </Button>
                                </TableCell>
                            </TableRow>
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
