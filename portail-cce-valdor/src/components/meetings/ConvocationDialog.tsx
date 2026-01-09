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
    Avatar,
    Tabs,
    Tab,
    Alert
} from '@mui/material';
import { Send, SelectAll, CheckCircle, Notifications, EventNote } from '@mui/icons-material';
import type { Member } from '../../types/member.types';
import type { Meeting } from '../../types/meeting.types';
import { getActiveMembers, sendConvocations, sendAvisConvocation } from '../../services/convocationService';

interface ConvocationDialogProps {
    open: boolean;
    meeting: Meeting;
    currentMember: Member;
    onClose: () => void;
    onSuccess: (sentCount: number, type: 'avis' | 'confirmation') => void;
    onError: (error: string) => void;
}

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
    <div role="tabpanel" hidden={value !== index}>
        {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
);

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
    const [tabValue, setTabValue] = useState(0); // 0 = Avis, 1 = Confirmation

    // Calculate dates
    const meetingDate = new Date(meeting.date);
    const deadlineDate = new Date(meetingDate);
    deadlineDate.setDate(deadlineDate.getDate() - 15);

    const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const formattedMeetingDate = meetingDate.toLocaleDateString('fr-CA', dateOptions);
    const formattedDeadline = deadlineDate.toLocaleDateString('fr-CA', dateOptions);

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
            setSelectedMemberIds(new Set());
        } else {
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
            const selectedMembers = members.filter(m => selectedMemberIds.has(m.id));

            if (tabValue === 0) {
                // Phase 1: Avis de convocation
                const result = await sendAvisConvocation(meeting, currentMember, selectedMembers);
                if (result.success) {
                    onSuccess(result.sentCount || 0, 'avis');
                    onClose();
                } else {
                    onError(result.error || 'Erreur inconnue');
                }
            } else {
                // Phase 2: Confirmation avec RSVP
                const result = await sendConvocations(meeting, currentMember, selectedMembers);
                if (result.success) {
                    onSuccess(result.sentCount || 0, 'confirmation');
                    onClose();
                } else {
                    onError(result.error || 'Erreur inconnue');
                }
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
                    <Typography variant="h6">Envoyer une convocation</Typography>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {/* Meeting info */}
                <Box sx={{ mb: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Réunion :</Typography>
                    <Typography variant="body1" fontWeight="bold">{meeting.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        📅 {formattedMeetingDate}
                    </Typography>
                </Box>

                {/* Phase selection tabs */}
                <Tabs
                    value={tabValue}
                    onChange={(_, v) => setTabValue(v)}
                    variant="fullWidth"
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                    <Tab
                        icon={<Notifications />}
                        iconPosition="start"
                        label="Phase 1 : Avis"
                    />
                    <Tab
                        icon={<EventNote />}
                        iconPosition="start"
                        label="Phase 2 : Ordre du jour"
                    />
                </Tabs>

                {/* Tab content */}
                <TabPanel value={tabValue} index={0}>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        📨 <strong>Avis de convocation</strong><br />
                        Email simple avec la date de la réunion et la date limite pour suggérer des sujets.
                        <br /><br />
                        <strong>Date limite :</strong> {formattedDeadline}
                    </Alert>
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <Alert severity="success" sx={{ mb: 2 }}>
                        📋 <strong>Ordre du jour + RSVP</strong><br />
                        Email avec l'ordre du jour en pièce jointe et boutons pour confirmer la présence.
                    </Alert>
                </TabPanel>

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        {/* Select all button */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, mt: 2 }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                Destinataires :
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
                        <List dense sx={{ maxHeight: 250, overflow: 'auto' }}>
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
                    color={tabValue === 0 ? "warning" : "primary"}
                    onClick={handleSend}
                    disabled={loading || sending || selectedMemberIds.size === 0}
                    startIcon={sending ? <CircularProgress size={20} /> : (tabValue === 0 ? <Notifications /> : <Send />)}
                >
                    {sending
                        ? 'Envoi en cours...'
                        : tabValue === 0
                            ? `Envoyer l'avis à ${selectedMemberIds.size} membre${selectedMemberIds.size !== 1 ? 's' : ''}`
                            : `Envoyer l'ordre du jour à ${selectedMemberIds.size} membre${selectedMemberIds.size !== 1 ? 's' : ''}`
                    }
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ConvocationDialog;
