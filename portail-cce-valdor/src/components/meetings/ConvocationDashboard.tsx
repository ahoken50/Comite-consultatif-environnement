import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    Divider,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Chip,
    CircularProgress,
    Button,
    Alert,
    LinearProgress
} from '@mui/material';
import {
    CheckCircle,
    Cancel,
    Help,
    Email,
    Sync,
    Refresh
} from '@mui/icons-material';
import type { Meeting } from '../../types/meeting.types';
import { getLatestConvocation, type Convocation, type ConvocationRecipient, resendConvocationEmails } from '../../services/convocationService';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

interface ConvocationDashboardProps {
    meeting: Meeting;
    onUpdate?: () => void;
    user?: any;
    members?: any[];
}

const ConvocationDashboard: React.FC<ConvocationDashboardProps> = ({ meeting, onUpdate, user, members = [] }) => {
    const [convocation, setConvocation] = useState<Convocation | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const currentMember = members.find(m => m.id === user?.uid || m.id === user?.id || m.email === user?.email);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getLatestConvocation(meeting.id);
            setConvocation(data);
        } catch (err) {
            console.error('Error loading convocation:', err);
            setError('Impossible de charger les données de convocation');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [meeting.id]);

    const handleSyncToAttendance = async () => {
        if (!convocation || !meeting) return;

        setSyncing(true);
        try {
            // Get currently confirmed recipients from convocation
            const confirmedRecipients = convocation.recipients.filter(r => r.status === 'confirmed');

            if (confirmedRecipients.length === 0) {
                alert('Aucun membre confirmé à synchroniser.');
                return;
            }

            // Get current attendees or empty array
            const currentAttendees = meeting.attendees || [];
            const newAttendees = [...currentAttendees];
            let addedCount = 0;

            confirmedRecipients.forEach(recipient => {
                // Check if already in attendance list (by ID or exact name match)
                const exists = currentAttendees.some(
                    a => a.id === recipient.memberId || a.name === recipient.name
                );

                if (!exists) {
                    // Look up real role from members collection
                    const memberRecord = members.find(m => m.id === recipient.memberId || m.displayName === recipient.name);
                    newAttendees.push({
                        id: recipient.memberId || Date.now().toString() + Math.random(),
                        name: recipient.name,
                        role: memberRecord?.role || 'member',
                        isPresent: true
                    });
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                await updateDoc(doc(db, 'meetings', meeting.id), {
                    attendees: newAttendees
                });
                if (onUpdate) onUpdate();
                alert(`${addedCount} membre(s) ajouté(s) à la liste de présence.`);
            } else {
                alert('Tous les membres confirmés sont déjà dans la liste de présence.');
            }

        } catch (err) {
            console.error('Error syncing attendance:', err);
            alert('Erreur lors de la synchronisation');
        } finally {
            setSyncing(false);
        }
    };

    const handleResendPending = async () => {
        if (!convocation || !meeting || !currentMember) return;

        const pendingRecipients = convocation.recipients.filter(r => r.status === 'pending');
        if (pendingRecipients.length === 0) {
            alert('Aucun membre en attente.');
            return;
        }

        if (!window.confirm(`Voulez-vous renvoyer l'invitation à ${pendingRecipients.length} membre(s) en attente ?`)) {
            return;
        }

        setResending(true);
        try {
            const result = await resendConvocationEmails(
                meeting,
                convocation.id!,
                pendingRecipients,
                currentMember
            );

            if (result.success) {
                alert('Rappels envoyés avec succès !');
            } else {
                alert(`Erreur : ${result.error}`);
            }
        } catch (err) {
            console.error('Error resending:', err);
            alert('Erreur lors de l\'envoi des rappels');
        } finally {
            setResending(false);
        }
    };

    if (loading && !convocation) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
    }

    if (!convocation) {
        return null; // Don't show anything if no convocation exists yet
    }

    const stats = {
        total: convocation.recipients.length,
        confirmed: convocation.recipients.filter(r => r.status === 'confirmed').length,
        declined: convocation.recipients.filter(r => r.status === 'declined').length,
        pending: convocation.recipients.filter(r => r.status === 'pending').length
    };

    const participationRate = stats.total > 0
        ? Math.round(((stats.confirmed + stats.declined) / stats.total) * 100)
        : 0;

    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: '#f8fafd' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Email color="primary" />
                    <Typography variant="h6">Suivi des convocations</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        startIcon={resending ? <CircularProgress size={16} /> : <Email />}
                        size="small"
                        color="secondary"
                        onClick={handleResendPending}
                        disabled={loading || resending || !currentMember || stats.pending === 0}
                    >
                        Relancer ({stats.pending})
                    </Button>
                    <Button
                        startIcon={<Refresh />}
                        size="small"
                        onClick={loadData}
                        disabled={loading}
                    >
                        Actualiser
                    </Button>
                </Box>
            </Box>

            {/* Stats Cards */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <Paper sx={{ p: 2, flex: 1, textAlign: 'center', bgcolor: '#e8f5e9' }}>
                    <Typography variant="h4" color="success.main" fontWeight="bold">
                        {stats.confirmed}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Confirmés</Typography>
                </Paper>
                <Paper sx={{ p: 2, flex: 1, textAlign: 'center', bgcolor: '#ffebee' }}>
                    <Typography variant="h4" color="error.main" fontWeight="bold">
                        {stats.declined}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Absents</Typography>
                </Paper>
                <Paper sx={{ p: 2, flex: 1, textAlign: 'center', bgcolor: '#fff3e0' }}>
                    <Typography variant="h4" color="warning.main" fontWeight="bold">
                        {stats.pending}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">En attente</Typography>
                </Paper>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Taux de réponse</Typography>
                    <Typography variant="body2" fontWeight="bold">{participationRate}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={participationRate} />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2">Détails par membre</Typography>

                <Button
                    variant="outlined"
                    size="small"
                    startIcon={syncing ? <CircularProgress size={16} /> : <Sync />}
                    onClick={handleSyncToAttendance}
                    disabled={syncing || stats.confirmed === 0}
                >
                    Synchroniser les présences
                </Button>
            </Box>

            <List dense sx={{ maxHeight: 200, overflow: 'auto', bgcolor: 'background.paper', borderRadius: 1 }}>
                {convocation.recipients.map((recipient: ConvocationRecipient) => (
                    <ListItem key={recipient.token} divider>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            {recipient.status === 'confirmed' ? (
                                <CheckCircle color="success" fontSize="small" />
                            ) : recipient.status === 'declined' ? (
                                <Cancel color="error" fontSize="small" />
                            ) : (
                                <Help color="action" fontSize="small" />
                            )}
                        </ListItemIcon>
                        <ListItemText
                            primary={recipient.name}
                            secondary={recipient.email}
                        />
                        <Chip
                            label={
                                recipient.status === 'confirmed' ? 'Présent' :
                                    recipient.status === 'declined' ? 'Absent' : 'En attente'
                            }
                            size="small"
                            color={
                                recipient.status === 'confirmed' ? 'success' :
                                    recipient.status === 'declined' ? 'error' : 'default'
                            }
                            variant="outlined"
                        />
                    </ListItem>
                ))}
            </List>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'right' }}>
                Envoyé le {new Date(convocation.sentAt).toLocaleDateString()}
            </Typography>
        </Paper>
    );
};

export default React.memo(ConvocationDashboard);
