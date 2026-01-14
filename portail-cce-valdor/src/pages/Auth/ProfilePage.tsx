import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Button,
    Alert,
    Divider,
    Container,
    Grid,
    CircularProgress
} from '@mui/material';
import { Lock, Logout, Person, Save } from '@mui/icons-material';
import { usePermissions } from '../../hooks/usePermissions';
import { auth } from '../../services/firebase';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth';
import { ROLE_LABELS } from '../../types/auth.types';
import { useNavigate } from 'react-router-dom';

const ProfilePage: React.FC = () => {
    const navigate = useNavigate();
    const { user, userProfile, loading } = usePermissions();

    // Password state
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // UI state
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const handleLogout = async () => {
        try {
            await signOut(auth);
            navigate('/login');
        } catch (err) {
            console.error('Logout error:', err);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (newPassword !== confirmPassword) {
            setError("Les nouveaux mots de passe ne correspondent pas");
            return;
        }

        if (newPassword.length < 6) {
            setError("Le mot de passe doit contenir au moins 6 caractères");
            return;
        }

        if (!user || !user.email) return;

        setSaving(true);
        try {
            // 1. Re-authenticate user
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);

            // 2. Update password
            await updatePassword(user, newPassword);

            setSuccess("Mot de passe mis à jour avec succès");
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            console.error('Password update error:', err);
            if (err.code === 'auth/wrong-password') {
                setError("L'ancien mot de passe est incorrect");
            } else {
                setError("Erreur lors de la mise à jour du mot de passe: " + err.message);
            }
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!user) {
        return <Alert severity="error">Vous devez être connecté</Alert>;
    }

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
            <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Person fontSize="large" color="primary" />
                Mon Profil
            </Typography>

            <Grid container spacing={3}>
                {/* Info Card */}
                <Grid size={{ xs: 12, md: 5 }}>
                    <Paper sx={{ p: 3, height: '100%' }}>
                        <Typography variant="h6" gutterBottom>Informations</Typography>
                        <Divider sx={{ mb: 2 }} />

                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" color="text.secondary">Email</Typography>
                            <Typography variant="body1">{user.email}</Typography>
                        </Box>

                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" color="text.secondary">Rôle Système</Typography>
                            <Typography variant="body1">
                                {userProfile ? ROLE_LABELS[userProfile.role] : 'Non défini'}
                            </Typography>
                        </Box>

                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<Logout />}
                            onClick={handleLogout}
                            fullWidth
                        >
                            Se déconnecter
                        </Button>
                    </Paper>
                </Grid>

                {/* Password Card */}
                <Grid size={{ xs: 12, md: 7 }}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Lock /> Sécurité
                        </Typography>
                        <Divider sx={{ mb: 2 }} />

                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

                        <form onSubmit={handleChangePassword}>
                            <TextField
                                label="Ancien mot de passe"
                                type="password"
                                fullWidth
                                margin="normal"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                            />
                            <TextField
                                label="Nouveau mot de passe"
                                type="password"
                                fullWidth
                                margin="normal"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                            />
                            <TextField
                                label="Confirmer le nouveau mot de passe"
                                type="password"
                                fullWidth
                                margin="normal"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />

                            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                    type="submit"
                                    variant="contained"
                                    startIcon={<Save />}
                                    disabled={saving}
                                >
                                    {saving ? 'Mise à jour...' : 'Mettre à jour'}
                                </Button>
                            </Box>
                        </form>
                    </Paper>
                </Grid>
            </Grid>
        </Container>
    );
};

export default ProfilePage;
