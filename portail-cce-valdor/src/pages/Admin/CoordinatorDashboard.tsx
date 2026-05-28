import React, { useEffect, useState } from 'react';
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
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Alert,
    CircularProgress,
    Button
} from '@mui/material';
import { SmartToy, AutoAwesome, CheckCircleOutline } from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { fetchAllUsers, updateUserRole } from '../../features/users/usersAPI';
import type { UserProfile, UserRole } from '../../types/auth.types';
import { ROLES, ROLE_LABELS } from '../../types/auth.types';
import { useAuth } from '../../hooks/useAuth';

const CoordinatorDashboard: React.FC = () => {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);

    // AI Prompt Optimization States
    const [aiLoading, setAiLoading] = useState(false);
    const [aiSuccess, setAiSuccess] = useState<string | null>(null);
    const [aiError, setAiError] = useState<string | null>(null);

    const handleOptimizePrompts = async () => {
        try {
            setAiLoading(true);
            setAiSuccess(null);
            setAiError(null);
            
            const functions = getFunctions();
            const rlhfOptimize = httpsCallable(functions, 'rlhf_get_optimized_params');
            
            const response = await rlhfOptimize({ forceReoptimize: true });
            const data = response.data as { success: boolean };
            
            if (data.success) {
                setAiSuccess("Félicitations ! Le compilateur DSPy a analysé avec succès vos corrections d'apprentissage actif (ml_corrections), extrait les résolutions de référence appropriées, et re-compilé le prompt système de rédaction de PV. Les hyperparamètres ont été calibrés à jour.");
            } else {
                setAiError("Une erreur est survenue lors de l'optimisation des invites de l'IA.");
            }
        } catch (err: any) {
            console.error("[RLHF] Optimization failed:", err);
            setAiError(`Échec de la compilation du prompt : ${err.message || err}`);
        } finally {
            setAiLoading(false);
        }
    };

    const loadUsers = async () => {
        try {
            setLoading(true);
            const data = await fetchAllUsers();
            setUsers(data);
        } catch (err) {
            setError('Erreur lors du chargement des utilisateurs.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const handleRoleChange = async (userId: string, newRole: UserRole) => {
        if (userId === currentUser?.id) {
            alert("Vous ne pouvez pas modifier votre propre rôle.");
            return;
        }

        try {
            setUpdating(userId);
            await updateUserRole(userId, newRole);
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
        } catch (err) {
            console.error(err);
            alert("Erreur lors de la mise à jour du rôle.");
        } finally {
            setUpdating(null);
        }
    };

    if (loading) return <CircularProgress />;

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h4" gutterBottom>
                Tableau de bord Coordonnateur
            </Typography>
            <Typography variant="subtitle1" color="textSecondary" gutterBottom>
                Gestion des utilisateurs et des accès
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Paper sx={{ mt: 3, p: 2 }}>
                <Typography variant="h6" gutterBottom>Utilisateurs du système</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Nom</TableCell>
                                <TableCell>Email</TableCell>
                                <TableCell>Rôle Actuel</TableCell>
                                <TableCell>Statut</TableCell>
                                <TableCell>Action</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>{user.displayName || '-'}</TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={ROLE_LABELS[user.role] || user.role}
                                            color={user.role === 'coordinator' ? 'primary' : 'default'}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {user.isActive ? <Chip label="Actif" color="success" size="small" variant="outlined" /> : <Chip label="Inactif" size="small" />}
                                    </TableCell>
                                    <TableCell>
                                        <FormControl size="small" sx={{ minWidth: 200 }}>
                                            <InputLabel>Modifier Rôle</InputLabel>
                                            <Select
                                                label="Modifier Rôle"
                                                value={user.role}
                                                onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                                                disabled={updating === user.id || user.id === currentUser?.id}
                                            >
                                                {ROLES.map((role) => (
                                                    <MenuItem key={role} value={role}>
                                                        {ROLE_LABELS[role]}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            {/* AI Prompt Optimization Section (DSPy / RLHF) */}
            <Paper sx={{ mt: 4, p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <SmartToy color="primary" sx={{ fontSize: 28 }} />
                    <Typography variant="h6" fontWeight={600}>
                        Optimisation de l'IA & Compilateur de Prompts DSPy
                    </Typography>
                </Box>
                
                <Typography variant="body2" color="textSecondary" sx={{ mb: 3, maxWidth: 800 }}>
                    Ce module déclenche manuellement le compilateur de prompts **DSPy** et la boucle d'apprentissage actif **RLHF**. 
                    L'IA va analyser l'ensemble des corrections réelles apportées sur les procès-verbaux (termes récurrents, structures légales modifiées), 
                    extraire les meilleurs exemples (few-shot) et re-compiler un système de consignes et de paramètres de température optimaux 
                    pour les futures rédactions de PV.
                </Typography>
                
                {aiSuccess && (
                    <Alert severity="success" sx={{ mb: 3, display: 'flex', alignItems: 'center' }} icon={<CheckCircleOutline fontSize="inherit" />}>
                        {aiSuccess}
                    </Alert>
                )}
                
                {aiError && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        {aiError}
                    </Alert>
                )}
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleOptimizePrompts}
                        disabled={aiLoading}
                        startIcon={aiLoading ? <CircularProgress size={20} color="inherit" /> : <AutoAwesome />}
                        sx={{ px: 3, py: 1, borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                    >
                        {aiLoading ? 'Optimisation en cours...' : 'Optimiser les invites par IA'}
                    </Button>
                    
                    {aiLoading && (
                        <Typography variant="caption" color="textSecondary">
                            Analyse des corrections en cours (ml_corrections)...
                        </Typography>
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

export default CoordinatorDashboard;
