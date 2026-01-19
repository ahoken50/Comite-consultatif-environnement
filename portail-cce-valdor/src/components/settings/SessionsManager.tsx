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
    IconButton,
    Chip,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Alert,
    Skeleton,
    Tooltip
} from '@mui/material';
import { Logout, Computer, Smartphone, Tablet, Refresh } from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import type { UserSession } from '../../types/notification.types';
import { safeDate } from '../../utils/dateUtils';

/**
 * Sessions Manager Component (#10.2)
 * Allows users to view and terminate active sessions
 */
const SessionsManager: React.FC = () => {
    const { user } = useSelector((state: RootState) => state.auth);
    const [sessions, setSessions] = useState<UserSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [sessionToTerminate, setSessionToTerminate] = useState<UserSession | null>(null);
    const [terminating, setTerminating] = useState(false);

    const fetchSessions = async () => {
        if (!user?.id && !user?.uid) return;

        setLoading(true);
        setError(null);

        try {
            const userId = user.id || user.uid;
            const sessionsRef = collection(db, 'sessions');
            const q = query(sessionsRef, where('userId', '==', userId));
            const snapshot = await getDocs(q);

            const sessionsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as UserSession));

            // Sort by last active (most recent first)
            sessionsData.sort((a, b) => {
                const dateA = safeDate(a.lastActiveAt)?.getTime() || 0;
                const dateB = safeDate(b.lastActiveAt)?.getTime() || 0;
                return dateB - dateA;
            }
            );

            setSessions(sessionsData);
        } catch (err) {
            console.error('Error fetching sessions:', err);
            setError('Erreur lors du chargement des sessions');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, [user]);

    const handleTerminateSession = (session: UserSession) => {
        setSessionToTerminate(session);
        setConfirmDialogOpen(true);
    };

    const confirmTerminateSession = async () => {
        if (!sessionToTerminate) return;

        setTerminating(true);
        try {
            await deleteDoc(doc(db, 'sessions', sessionToTerminate.id));
            setSessions(prev => prev.filter(s => s.id !== sessionToTerminate.id));
            setConfirmDialogOpen(false);
            setSessionToTerminate(null);
        } catch (err) {
            console.error('Error terminating session:', err);
            setError('Erreur lors de la déconnexion');
        } finally {
            setTerminating(false);
        }
    };

    const getDeviceIcon = (device: string) => {
        const deviceLower = device.toLowerCase();
        if (deviceLower.includes('mobile') || deviceLower.includes('phone')) {
            return <Smartphone />;
        }
        if (deviceLower.includes('tablet') || deviceLower.includes('ipad')) {
            return <Tablet />;
        }
        return <Computer />;
    };

    if (loading) {
        return (
            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>Sessions actives</Typography>
                <Skeleton variant="rectangular" height={200} />
            </Paper>
        );
    }

    return (
        <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Sessions actives
                </Typography>
                <Button
                    size="small"
                    startIcon={<Refresh />}
                    onClick={fetchSessions}
                >
                    Actualiser
                </Button>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {sessions.length === 0 ? (
                <Alert severity="info">
                    Aucune session active enregistrée. Les sessions apparaîtront ici après votre prochaine connexion.
                </Alert>
            ) : (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Appareil</TableCell>
                                <TableCell>Navigateur</TableCell>
                                <TableCell>Localisation</TableCell>
                                <TableCell>Dernière activité</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sessions.map((session) => (
                                <TableRow
                                    key={session.id}
                                    sx={{
                                        bgcolor: session.isCurrent ? 'action.selected' : 'inherit'
                                    }}
                                >
                                    <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            {getDeviceIcon(session.deviceInfo.device)}
                                            <Box>
                                                <Typography variant="body2">
                                                    {session.deviceInfo.device}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {session.deviceInfo.os}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2">
                                            {session.deviceInfo.browser}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2">
                                            {session.location || 'Localisation non disponible'}
                                        </Typography>
                                        {session.ipAddress && (
                                            <Typography variant="caption" color="text.secondary">
                                                {session.ipAddress}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2">
                                            {formatDistanceToNow(safeDate(session.lastActiveAt) || new Date(), {
                                                addSuffix: true,
                                                locale: fr
                                            })}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        {session.isCurrent ? (
                                            <Chip
                                                label="Session actuelle"
                                                size="small"
                                                color="primary"
                                            />
                                        ) : (
                                            <Tooltip title="Déconnecter cette session">
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={() => handleTerminateSession(session)}
                                                >
                                                    <Logout />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Confirmation Dialog */}
            <Dialog open={confirmDialogOpen} onClose={() => setConfirmDialogOpen(false)}>
                <DialogTitle>Déconnecter cette session ?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Cette action déconnectera l'appareil "{sessionToTerminate?.deviceInfo.device}"
                        de votre compte. L'utilisateur devra se reconnecter.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDialogOpen(false)}>
                        Annuler
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={confirmTerminateSession}
                        disabled={terminating}
                    >
                        {terminating ? 'Déconnexion...' : 'Déconnecter'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default SessionsManager;
