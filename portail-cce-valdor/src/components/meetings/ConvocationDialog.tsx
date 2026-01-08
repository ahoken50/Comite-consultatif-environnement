import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Checkbox,
    Typography,
    Box,
    Divider,
    CircularProgress,
    Chip,
    Avatar
} from '@mui/material';
import { Send, SelectAll, CheckCircle } from '@mui/icons-material';
import type { Member } from '../../types/member.types';
import type { Meeting } from '../../types/meeting.types';
import { getActiveMembers, sendConvocations } from '../../services/convocationService';

interface ConvocationDialogProps {
    open: boolean;
    meeting: Meeting;
    currentMember: Member;
    onClose: () => void;
    onSuccess: (sentCount: number) => void;
    onError: (error: string) => void;
}

const ConvocationDialog: React.FC<ConvocationDialogProps> = ({
    open,
    meeting,
    currentMember,
    onClose,
    onSuccess,
    onError
}) => {
    const [members, setMembers] = useState<Member[]>([]);
    const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);

    // Load active members when dialog opens
    useEffect(() => {
        if (open) {
            loadMembers();
        }
    }, [open]);

    const loadMembers = async () => {
        setLoading(true);
        try {
            const activeMembers = await getActiveMembers();
            setMembers(activeMembers);
            // Select all by default
            setSelectedMemberIds(new Set(activeMembers.map(m => m.id)));
        } catch (err) {
            console.error('Error loading members:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = (memberId: string) => {
        const newSelected = new Set(selectedMemberIds);
        if (newSelected.has(memberId)) {
            newSelected.delete(memberId);
        } else {
            newSelected.add(memberId);
        }
        setSelectedMemberIds(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedMemberIds.size === members.length) {
            // Deselect all
            setSelectedMemberIds(new Set());
        } else {
            // Select all
            setSelectedMemberIds(new Set(members.map(m => m.id)));
        }
    };

    const handleSend = async () => {
        if (selectedMemberIds.size === 0) {
            onError('Veuillez sélectionner au moins un membre');
            return;
        }

        setSending(true);
        try {
            // Filter members to only selected ones
            const selectedMembers = members.filter(m => selectedMemberIds.has(m.id));

            const result = await sendConvocations(meeting, currentMember, selectedMembers);

            if (result.success) {
                onSuccess(result.sentCount || 0);
                onClose();
            } else {
                onError(result.error || 'Erreur inconnue');
            }
        } catch (err) {
            onError('Erreur lors de l\'envoi');
            console.error(err);
        } finally {
            setSending(false);
        }
    };

    const getRoleLabel = (role: string): string => {
        switch (role) {
            case 'coordinator': return 'Coordonnateur';
            case 'president': return 'Président(e)';
            case 'vice_president': return 'Vice-Président(e)';
            case 'elected_official': return 'Élu(e)';
            case 'member': return 'Membre';
            case 'observer': return 'Observateur';
            default: return role;
        }
    };

    const allSelected = selectedMemberIds.size === members.length;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Send color="primary" />
                    <Typography variant="h6">Envoyer les convocations</Typography>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        {/* Meeting info */}
                        <Box sx={{ mb: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary">Réunion :</Typography>
                            <Typography variant="body1" fontWeight="bold">{meeting.title}</Typography>
                        </Box>

                        {/* Select all button */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                Sélectionner les destinataires :
                            </Typography>
                            <Button
                                size="small"
                                startIcon={allSelected ? <CheckCircle /> : <SelectAll />}
                                onClick={handleSelectAll}
                            >
                                {allSelected ? 'Désélectionner tout' : 'Tout sélectionner'}
                            </Button>
                        </Box>

                        <Divider sx={{ mb: 1 }} />

                        {/* Members list */}
                        <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                            {members.map((member) => (
                                <ListItem key={member.id} disablePadding>
                                    <ListItemButton onClick={() => handleToggle(member.id)} dense>
                                        <ListItemIcon>
                                            <Checkbox
                                                edge="start"
                                                checked={selectedMemberIds.has(member.id)}
                                                tabIndex={-1}
                                                disableRipple
                                            />
                                        </ListItemIcon>
                                        <ListItemIcon sx={{ minWidth: 40 }}>
                                            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.light' }}>
                                                {member.displayName.charAt(0)}
                                            </Avatar>
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={member.displayName}
                                            secondary={member.email}
                                        />
                                        <Chip
                                            label={getRoleLabel(member.role)}
                                            size="small"
                                            variant="outlined"
                                            sx={{ ml: 1 }}
                                        />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                        </List>

                        {/* Selection count */}
                        <Box sx={{ mt: 2, textAlign: 'right' }}>
                            <Typography variant="body2" color="text.secondary">
                                {selectedMemberIds.size} membre{selectedMemberIds.size !== 1 ? 's' : ''} sélectionné{selectedMemberIds.size !== 1 ? 's' : ''}
                            </Typography>
                        </Box>
                    </>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={sending}>
                    Annuler
                </Button>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSend}
                    disabled={loading || sending || selectedMemberIds.size === 0}
                    startIcon={sending ? <CircularProgress size={20} /> : <Send />}
                >
                    {sending ? 'Envoi en cours...' : `Envoyer à ${selectedMemberIds.size} membre${selectedMemberIds.size !== 1 ? 's' : ''}`}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ConvocationDialog;
