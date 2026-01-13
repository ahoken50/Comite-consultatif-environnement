import React, { useState, useEffect } from 'react';
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
    Chip,
    FormControl,
    InputLabel,
    Select,
    MenuItem
} from '@mui/material';
import { Delete, Add, AutoAwesome } from '@mui/icons-material';
import type { Attendee, Meeting } from '../../types/meeting.types';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMembers } from '../../features/members/membersSlice';
import { getRoleLabel } from '../../constants';

interface AttendanceManagerProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

const AttendanceManager: React.FC<AttendanceManagerProps> = ({ meeting, onUpdate }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: members } = useSelector((state: RootState) => state.members);

    const [selectedMemberId, setSelectedMemberId] = useState('');
    const [customName, setCustomName] = useState(''); // For non-members (guests)
    const [newAttendeeRole, setNewAttendeeRole] = useState('');
    const [isGuest, setIsGuest] = useState(false);

    useEffect(() => {
        if (members.length === 0) {
            dispatch(fetchMembers());
        }
    }, [dispatch, members.length]);

    // Calculate Quorum: Users present AND NOT 'Coordonnateur'
    const quorumCount = meeting.attendees?.filter(a =>
        a.isPresent &&
        a.role.toLowerCase() !== 'coordonnateur' &&
        !a.name.toLowerCase().includes('michaël ross') // Security check as requested
    ).length || 0;

    const quorumRequired = meeting.quorumRequired || 4;
    const isQuorumMet = quorumCount >= quorumRequired;

    const handleTogglePresence = (attendeeId: string) => {
        const updatedAttendees = meeting.attendees.map(a =>
            a.id === attendeeId ? { ...a, isPresent: !a.isPresent } : a
        );
        onUpdate({ attendees: updatedAttendees });
    };

    const handleAddMember = () => {
        if (isGuest) {
            if (!customName.trim()) return;
            const newAttendee: Attendee = {
                id: Date.now().toString(),
                name: customName,
                role: newAttendeeRole || 'Invité',
                isPresent: true
            };
            const updatedAttendees = [...(meeting.attendees || []), newAttendee];
            onUpdate({ attendees: updatedAttendees });
            setCustomName('');
            setNewAttendeeRole('');
        } else {
            if (!selectedMemberId) return;
            const member = members.find(m => m.id === selectedMemberId);
            if (!member) return;

            const newAttendee: Attendee = {
                id: member.id,
                name: member.displayName,
                role: member.role || 'Membre',
                isPresent: true
            };
            const updatedAttendees = [...(meeting.attendees || []), newAttendee];
            onUpdate({ attendees: updatedAttendees });
            setSelectedMemberId('');
        }
    };

    const handleDeleteAttendee = (attendeeId: string) => {
        const updatedAttendees = meeting.attendees.filter(a => a.id !== attendeeId);
        onUpdate({ attendees: updatedAttendees });
    };

    // --- AI Sync Logic ---
    const handleSyncFromDraft = () => {
        const draftContent = meeting.minutesDraft?.content;
        if (!draftContent) {
            alert("Aucun brouillon de PV disponible pour la synchronisation.");
            return;
        }

        // Simple regex to find "Sont présents :" and "Sont absents :" sections
        // Note: This relies on the AI following the standard PV format
        const presentMatch = draftContent.match(/Sont présents\s*:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
        const absentMatch = draftContent.match(/Sont absents\s*:\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);

        let updatedAttendees: Attendee[] = [...(meeting.attendees || [])];
        let changesCount = 0;

        const processNames = (text: string, isPresent: boolean) => {
            if (!text) return;
            // Split by comma or newline and clean up
            const names = text.split(/,|\n/).map(n => n.trim().replace(/^- /, '')).filter(n => n.length > 2);

            names.forEach(extractedName => {
                // Find matching member
                const member = members.find(m =>
                    m.displayName.toLowerCase().includes(extractedName.toLowerCase()) ||
                    extractedName.toLowerCase().includes(m.displayName.toLowerCase())
                );

                if (member) {
                    // Check if already in attendees
                    const existingIndex = updatedAttendees.findIndex(a => a.id === member.id);
                    if (existingIndex >= 0) {
                        if (updatedAttendees[existingIndex].isPresent !== isPresent) {
                            updatedAttendees[existingIndex] = { ...updatedAttendees[existingIndex], isPresent };
                            changesCount++;
                        }
                    } else {
                        // Add if missing
                        updatedAttendees.push({
                            id: member.id,
                            name: member.displayName,
                            role: member.role || 'Membre',
                            isPresent: isPresent
                        });
                        changesCount++;
                    }
                }
            });
        };

        if (presentMatch) processNames(presentMatch[1], true);
        if (absentMatch) processNames(absentMatch[1], false);

        if (changesCount > 0) {
            onUpdate({ attendees: updatedAttendees });
            alert(`${changesCount} présences mises à jour depuis le brouillon IA.`);
        } else {
            alert("Aucune correspondance trouvée ou aucun changement nécessaire.");
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="h6">Gestion des présences</Typography>
                    <Button
                        startIcon={<AutoAwesome />}
                        size="small"
                        variant="outlined"
                        color="secondary"
                        onClick={handleSyncFromDraft}
                        disabled={!meeting.minutesDraft?.content}
                        title="Synchroniser les présences depuis le brouillon IA"
                    >
                        Importer du PV (IA)
                    </Button>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="subtitle2" color="text.secondary">
                        Quorum (hors coord.): {quorumCount} / {quorumRequired}
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
                            width: `${Math.min(100, (quorumCount / quorumRequired) * 100)}%`,
                            height: '100%',
                            bgcolor: isQuorumMet ? 'success.main' : 'warning.main',
                            transition: 'width 0.5s ease-in-out'
                        }} />
                    </Box>
                </Box>
                <Chip
                    label={isQuorumMet ? "QUORUM ATTEINT" : "QUORUM NON ATTEINT"}
                    color={isQuorumMet ? "success" : "warning"}
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
                                        label={getRoleLabel(attendee.role)}
                                        size="small"
                                        variant="outlined"
                                        color={attendee.role === 'coordinator' || attendee.role === 'elected_official' ? 'info' : 'default'}
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

                <Box sx={{ mb: 2 }}>
                    <Checkbox
                        checked={isGuest}
                        onChange={(e) => setIsGuest(e.target.checked)}
                        size="small"
                    />
                    <Typography variant="caption" component="span">Ajouter un invité (hors liste des membres)</Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    {isGuest ? (
                        <>
                            <TextField
                                label="Nom complet"
                                size="small"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                fullWidth
                            />
                            <TextField
                                label="Rôle (ex: Invité)"
                                size="small"
                                value={newAttendeeRole}
                                onChange={(e) => setNewAttendeeRole(e.target.value)}
                                sx={{ width: '200px' }}
                            />
                        </>
                    ) : (
                        <FormControl fullWidth size="small">
                            <InputLabel>Sélectionner un membre</InputLabel>
                            <Select
                                value={selectedMemberId}
                                label="Sélectionner un membre"
                                onChange={(e) => setSelectedMemberId(e.target.value)}
                            >
                                {members
                                    .filter(m => !meeting.attendees?.some(a => a.id === m.id)) // Filter out already added
                                    .map((member) => (
                                        <MenuItem key={member.id} value={member.id}>
                                            {member.displayName} ({member.role})
                                        </MenuItem>
                                    ))}
                            </Select>
                        </FormControl>
                    )}

                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={handleAddMember}
                        disabled={isGuest ? !customName.trim() : !selectedMemberId}
                        sx={{ mt: 0.5 }}
                    >
                        Ajouter
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
};

export default AttendanceManager;
