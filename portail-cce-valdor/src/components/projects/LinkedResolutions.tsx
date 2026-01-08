import React, { useState, useMemo } from 'react';
import {
    Box,
    Typography,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Paper,
    Chip,
    Divider,
    Alert
} from '@mui/material';
import { Add, Delete, Link as LinkIcon, Event, Comment, Description } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import type { Project, LinkedResolution } from '../../types/project.types';
import { linkResolutionToProject, unlinkResolutionFromProject } from '../../features/projects/projectsSlice';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface LinkedResolutionsProps {
    project: Project;
}

/**
 * Component to display and manage linked CCE resolutions/comments for a project.
 * Allows linking resolutions from different CCE meetings to track follow-up discussions.
 */
const LinkedResolutions: React.FC<LinkedResolutionsProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedMeetingId, setSelectedMeetingId] = useState<string>('');
    const [selectedAgendaItemId, setSelectedAgendaItemId] = useState<string>('');
    const [selectedEntryIndex, setSelectedEntryIndex] = useState<number>(-1);
    const [isLinking, setIsLinking] = useState(false);

    // Get past meetings with minute entries
    const pastMeetingsWithMinutes = useMemo(() => {
        return meetings
            .filter(m => {
                // Only show meetings that have agenda items with minute entries
                return m.agendaItems?.some(item =>
                    item.minuteEntries && item.minuteEntries.length > 0
                );
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [meetings]);

    // Get selected meeting
    const selectedMeeting = useMemo(() => {
        return meetings.find(m => m.id === selectedMeetingId);
    }, [meetings, selectedMeetingId]);

    // Get agenda items with minute entries for selected meeting
    const agendaItemsWithEntries = useMemo(() => {
        if (!selectedMeeting) return [];
        return selectedMeeting.agendaItems?.filter(item =>
            item.minuteEntries && item.minuteEntries.length > 0
        ) || [];
    }, [selectedMeeting]);

    // Get selected agenda item
    const selectedAgendaItem = useMemo(() => {
        return agendaItemsWithEntries.find(item => item.id === selectedAgendaItemId);
    }, [agendaItemsWithEntries, selectedAgendaItemId]);

    // Get minute entries for selected agenda item
    const minuteEntries = useMemo(() => {
        return selectedAgendaItem?.minuteEntries || [];
    }, [selectedAgendaItem]);

    // Get selected entry
    const selectedEntry = useMemo(() => {
        if (selectedEntryIndex < 0 || selectedEntryIndex >= minuteEntries.length) return null;
        return minuteEntries[selectedEntryIndex];
    }, [minuteEntries, selectedEntryIndex]);

    const handleOpenDialog = () => {
        setDialogOpen(true);
        setSelectedMeetingId('');
        setSelectedAgendaItemId('');
        setSelectedEntryIndex(-1);
    };

    const handleCloseDialog = () => {
        setDialogOpen(false);
    };

    const handleMeetingChange = (meetingId: string) => {
        setSelectedMeetingId(meetingId);
        setSelectedAgendaItemId('');
        setSelectedEntryIndex(-1);
    };

    const handleAgendaItemChange = (agendaItemId: string) => {
        setSelectedAgendaItemId(agendaItemId);
        setSelectedEntryIndex(-1);
    };

    const handleLinkResolution = async () => {
        if (!user || !selectedMeeting || !selectedAgendaItem || !selectedEntry) return;

        setIsLinking(true);
        try {
            const resolution: LinkedResolution = {
                id: `${selectedMeetingId}-${selectedAgendaItemId}-${selectedEntryIndex}-${Date.now()}`,
                meetingId: selectedMeetingId,
                meetingTitle: selectedMeeting.title,
                meetingDate: selectedMeeting.date,
                agendaItemId: selectedAgendaItemId,
                agendaItemTitle: selectedAgendaItem.title,
                entryIndex: selectedEntryIndex,
                entryType: selectedEntry.type,
                entryNumber: selectedEntry.number || '',
                entryContent: selectedEntry.content?.substring(0, 200) || '',
                linkedAt: new Date().toISOString(),
                linkedBy: user.uid
            };

            await dispatch(linkResolutionToProject({
                projectId: project.id,
                resolution,
                projectName: project.name,
                userId: user.uid,
                userName: user.displayName || user.email || 'Utilisateur'
            })).unwrap();

            handleCloseDialog();
        } catch (error) {
            console.error('Failed to link resolution:', error);
        } finally {
            setIsLinking(false);
        }
    };

    const handleUnlinkResolution = async (resolutionId: string) => {
        if (!user) return;
        if (!window.confirm('Voulez-vous vraiment supprimer ce lien ?')) return;

        try {
            await dispatch(unlinkResolutionFromProject({
                projectId: project.id,
                resolutionId,
                projectName: project.name,
                userId: user.uid,
                userName: user.displayName || user.email || 'Utilisateur'
            })).unwrap();
        } catch (error) {
            console.error('Failed to unlink resolution:', error);
        }
    };

    const linkedResolutions = project.linkedResolutions || [];

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                    <LinkIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Résolutions CCE liées
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<Add />}
                    size="small"
                    onClick={handleOpenDialog}
                >
                    Lier une résolution
                </Button>
            </Box>

            {linkedResolutions.length === 0 ? (
                <Paper sx={{ p: 3, textAlign: 'center', bgcolor: 'grey.50' }}>
                    <Typography color="text.secondary">
                        Aucune résolution ou commentaire CCE lié à ce projet.
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                        Liez des résolutions d'autres assemblées pour suivre l'évolution du dossier.
                    </Typography>
                </Paper>
            ) : (
                <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                    {linkedResolutions.map((resolution, index) => (
                        <React.Fragment key={resolution.id}>
                            {index > 0 && <Divider />}
                            <ListItem sx={{ py: 2 }}>
                                <Box sx={{ mr: 2, color: resolution.entryType === 'resolution' ? 'primary.main' : 'warning.main' }}>
                                    {resolution.entryType === 'resolution' ? <Description /> : <Comment />}
                                </Box>
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                            <Chip
                                                label={resolution.entryNumber || resolution.entryType}
                                                size="small"
                                                color={resolution.entryType === 'resolution' ? 'primary' : 'warning'}
                                                variant="outlined"
                                            />
                                            <Typography variant="subtitle2">
                                                {resolution.meetingTitle}
                                            </Typography>
                                            <Chip
                                                icon={<Event />}
                                                label={format(new Date(resolution.meetingDate), 'd MMM yyyy', { locale: fr })}
                                                size="small"
                                                variant="outlined"
                                            />
                                        </Box>
                                    }
                                    secondary={
                                        <Box sx={{ mt: 1 }}>
                                            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                {resolution.agendaItemTitle}
                                            </Typography>
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    mt: 0.5,
                                                    whiteSpace: 'pre-line',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 3,
                                                    WebkitBoxOrient: 'vertical'
                                                }}
                                            >
                                                {resolution.entryContent}
                                            </Typography>
                                        </Box>
                                    }
                                />
                                <ListItemSecondaryAction>
                                    <IconButton
                                        edge="end"
                                        color="error"
                                        onClick={() => handleUnlinkResolution(resolution.id)}
                                        size="small"
                                    >
                                        <Delete />
                                    </IconButton>
                                </ListItemSecondaryAction>
                            </ListItem>
                        </React.Fragment>
                    ))}
                </List>
            )}

            {/* Link Dialog */}
            <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
                <DialogTitle>Lier une résolution ou commentaire CCE</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
                        {/* Step 1: Select Meeting */}
                        <FormControl fullWidth>
                            <InputLabel>1. Sélectionner une assemblée CCE</InputLabel>
                            <Select
                                value={selectedMeetingId}
                                label="1. Sélectionner une assemblée CCE"
                                onChange={(e) => handleMeetingChange(e.target.value)}
                            >
                                {pastMeetingsWithMinutes.map(meeting => (
                                    <MenuItem key={meeting.id} value={meeting.id}>
                                        {meeting.title} - {format(new Date(meeting.date), 'd MMMM yyyy', { locale: fr })}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Step 2: Select Agenda Item */}
                        {selectedMeetingId && (
                            <FormControl fullWidth>
                                <InputLabel>2. Sélectionner un point d'ordre du jour</InputLabel>
                                <Select
                                    value={selectedAgendaItemId}
                                    label="2. Sélectionner un point d'ordre du jour"
                                    onChange={(e) => handleAgendaItemChange(e.target.value)}
                                >
                                    {agendaItemsWithEntries.map(item => (
                                        <MenuItem key={item.id} value={item.id}>
                                            {item.title}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

                        {/* Step 3: Select Resolution/Comment */}
                        {selectedAgendaItemId && minuteEntries.length > 0 && (
                            <FormControl fullWidth>
                                <InputLabel>3. Sélectionner une résolution ou commentaire</InputLabel>
                                <Select
                                    value={selectedEntryIndex >= 0 ? selectedEntryIndex.toString() : ''}
                                    label="3. Sélectionner une résolution ou commentaire"
                                    onChange={(e) => setSelectedEntryIndex(parseInt(e.target.value))}
                                >
                                    {minuteEntries.map((entry, idx) => (
                                        <MenuItem key={idx} value={idx}>
                                            {entry.type === 'resolution' ? '📋' : '💬'} {entry.number || `Entrée ${idx + 1}`} - {entry.content?.substring(0, 80)}...
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

                        {/* Preview */}
                        {selectedEntry && (
                            <Alert severity="info" icon={selectedEntry.type === 'resolution' ? <Description /> : <Comment />}>
                                <Typography variant="subtitle2" gutterBottom>
                                    {selectedEntry.type === 'resolution' ? 'Résolution' : 'Commentaire'} {selectedEntry.number}
                                </Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                                    {selectedEntry.content}
                                </Typography>
                            </Alert>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>Annuler</Button>
                    <Button
                        variant="contained"
                        onClick={handleLinkResolution}
                        disabled={!selectedEntry || isLinking}
                        startIcon={<LinkIcon />}
                    >
                        {isLinking ? 'Liaison...' : 'Lier au projet'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default LinkedResolutions;
