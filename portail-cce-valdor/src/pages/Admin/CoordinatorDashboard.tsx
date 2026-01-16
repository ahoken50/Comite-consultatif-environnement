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
    CircularProgress
} from '@mui/material';
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
        </Box>
    );
};

export default CoordinatorDashboard;
