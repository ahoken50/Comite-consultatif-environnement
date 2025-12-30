import React, { useState } from 'react';
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
    Checkbox,
    TextField,
    Button,
    IconButton,
    Chip
} from '@mui/material';
import { Delete, Add } from '@mui/icons-material';
import type { Attendee, Meeting } from '../../types/meeting.types';

interface AttendanceManagerProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

const AttendanceManager: React.FC<AttendanceManagerProps> = ({ meeting, onUpdate }) => {
    const [newAttendeeName, setNewAttendeeName] = useState('');
    const [newAttendeeRole, setNewAttendeeRole] = useState('');

    const handleTogglePresence = (attendeeId: string) => {
        const updatedAttendees = meeting.attendees.map(a =>
            a.id === attendeeId ? { ...a, isPresent: !a.isPresent } : a
        );
        onUpdate({ attendees: updatedAttendees });
    };

    const handleAddAttendee = () => {
        if (!newAttendeeName.trim()) return;

        const newAttendee: Attendee = {
            id: Date.now().toString(),
            name: newAttendeeName,
            role: newAttendeeRole || 'Membre',
            isPresent: true
        };

        const updatedAttendees = [...(meeting.attendees || []), newAttendee];
        onUpdate({ attendees: updatedAttendees });
        setNewAttendeeName('');
        setNewAttendeeRole('');
    };

    const handleDeleteAttendee = (attendeeId: string) => {
        const updatedAttendees = meeting.attendees.filter(a => a.id !== attendeeId);
        onUpdate({ attendees: updatedAttendees });
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6">Gestion des présences</Typography>
                <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="subtitle2" color="text.secondary">
                        Quorum: {meeting.attendees?.filter(a => a.isPresent).length || 0} / {meeting.quorumRequired || 4}
                    </Typography>
                </Box>
            </Box>

            {/* Quorum Progress Bar */}
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ width: '100%', mr: 1 }}>
                    <Box sx={{
                        height: 10,
                        bgcolor: 'grey.200',
                        borderRadius: 5,
                        overflow: 'hidden',
                        position: 'relative'
                    }}>
                        <Box sx={{
                            width: `${Math.min(100, ((meeting.attendees?.filter(a => a.isPresent).length || 0) / (meeting.quorumRequired || 4)) * 100)}%`,
                            height: '100%',
                            bgcolor: (meeting.attendees?.filter(a => a.isPresent).length || 0) >= (meeting.quorumRequired || 4) ? 'success.main' : 'warning.main',
                            transition: 'width 0.5s ease-in-out'
                        }} />
                    </Box>
                </Box>
                <Chip
                    label={(meeting.attendees?.filter(a => a.isPresent).length || 0) >= (meeting.quorumRequired || 4) ? "QUORUM ATTEINT" : "QUORUM NON ATTEINT"}
                    color={(meeting.attendees?.filter(a => a.isPresent).length || 0) >= (meeting.quorumRequired || 4) ? "success" : "warning"}
                    size="small"
                />
            </Box>

            <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox">Présent</TableCell>
                            <TableCell>Nom</TableCell>
                            <TableCell>Rôle</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {(meeting.attendees || []).map((attendee) => (
                            <TableRow key={attendee.id} hover selected={attendee.isPresent}>
                                <TableCell padding="checkbox">
                                    <Checkbox
                                        checked={attendee.isPresent}
                                        onChange={() => handleTogglePresence(attendee.id)}
                                        color="primary"
                                    />
                                </TableCell>
                                <TableCell>{attendee.name}</TableCell>
                                <TableCell>
                                    <Chip
                                        label={attendee.role}
                                        size="small"
                                        variant="outlined"
                                        color={attendee.role === 'Secrétaire' || attendee.role === 'Conseiller' ? 'info' : 'default'}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    <IconButton
                                        size="small"
                                        color="error"
                                        onClick={() => handleDeleteAttendee(attendee.id)}
                                    >
                                        <Delete />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {(meeting.attendees || []).length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                                    Aucun participant inscrit. Ajoutez des membres ci-dessous.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                <Typography variant="subtitle2" gutterBottom>Ajouter un participant</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        label="Nom complet"
                        size="small"
                        value={newAttendeeName}
                        onChange={(e) => setNewAttendeeName(e.target.value)}
                        fullWidth
                    />
                    <TextField
                        label="Rôle (ex: Membre, Invité)"
                        size="small"
                        value={newAttendeeRole}
                        onChange={(e) => setNewAttendeeRole(e.target.value)}
                        sx={{ width: '200px' }}
                    />
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={handleAddAttendee}
                        disabled={!newAttendeeName.trim()}
                    >
                        Ajouter
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
};

export default AttendanceManager;
