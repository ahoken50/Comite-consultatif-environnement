import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    TextField,
    Button,
    Avatar,
    Grid,
    Snackbar
} from '@mui/material';
import { Save } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { updateMember, ensureMemberProfile } from '../../features/members/membersSlice';

const SettingsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const { currentMember, loading } = useSelector((state: RootState) => state.members);

    const [formData, setFormData] = useState({
        displayName: '',
        email: '',
        phone: '',
        bio: '',
        photoURL: ''
    });
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        if (user) {
            dispatch(ensureMemberProfile(user));
        }
    }, [dispatch, user]);

    useEffect(() => {
        if (currentMember) {
            setFormData({
                displayName: currentMember.displayName || '',
                email: currentMember.email || '',
                phone: currentMember.phone || '',
                bio: currentMember.bio || '',
                photoURL: currentMember.photoURL || ''
            });
        }
    }, [currentMember]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (currentMember) {
            await dispatch(updateMember({
                id: currentMember.id,
                updates: {
                    displayName: formData.displayName,
                    phone: formData.phone,
                    bio: formData.bio,
                    photoURL: formData.photoURL
                }
            }));
            setSuccessMessage('Profil mis à jour avec succès !');
        }
    };

    return (
        <Box>
            <Typography variant="h4" fontWeight={700} gutterBottom>
                Paramètres
            </Typography>

            <Paper sx={{ p: 4, maxWidth: 800, mx: 'auto', mt: 4 }}>
                <Typography variant="h6" gutterBottom>
                    Mon Profil
                </Typography>

                <Box component="form" onSubmit={handleSubmit} sx={{ mt: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 4 }}>
                        <Avatar
                            src={formData.photoURL}
                            sx={{ width: 80, height: 80 }}
                        />
                        <TextField
                            label="URL de la photo"
                            name="photoURL"
                            value={formData.photoURL}
                            onChange={handleChange}
                            fullWidth
                            size="small"
                            helperText="Lien vers votre photo de profil"
                        />
                    </Box>

                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                label="Nom complet"
                                name="displayName"
                                value={formData.displayName}
                                onChange={handleChange}
                                fullWidth
                                required
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                label="Email"
                                name="email"
                                value={formData.email}
                                disabled
                                fullWidth
                                helperText="L'email ne peut pas être modifié"
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                label="Téléphone"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                fullWidth
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                label="Biographie"
                                name="bio"
                                value={formData.bio}
                                onChange={handleChange}
                                fullWidth
                                multiline
                                rows={4}
                            />
                        </Grid>
                    </Grid>

                    <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            type="submit"
                            variant="contained"
                            startIcon={<Save />}
                            disabled={loading}
                        >
                            Enregistrer
                        </Button>
                    </Box>
                </Box>
            </Paper>

            <Snackbar
                open={!!successMessage}
                autoHideDuration={6000}
                onClose={() => setSuccessMessage('')}
                message={successMessage}
            />
        </Box>
    );
};

export default SettingsPage;
