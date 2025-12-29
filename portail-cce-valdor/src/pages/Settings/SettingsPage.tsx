import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    TextField,
    Button,
    Avatar,
    Grid,
    Snackbar,
    Tabs,
    Tab,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Switch,
    Divider,
    Alert
} from '@mui/material';
import { Save, Storage, Settings as SettingsIcon, Person } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { updateMember, ensureMemberProfile } from '../../features/members/membersSlice';
import CategoryManager from '../../components/settings/CategoryManager';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`settings-tabpanel-${index}`}
            aria-labelledby={`settings-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ pt: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

const SettingsPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const { currentMember, loading } = useSelector((state: RootState) => state.members);

    const [tabValue, setTabValue] = useState(0);
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

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
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
                Paramètres & Profil
            </Typography>

            <Paper sx={{ p: 3, mt: 3, maxWidth: 900, mx: 'auto' }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={handleTabChange} aria-label="settings tabs">
                        <Tab icon={<Person />} label="Mon Profil" iconPosition="start" />
                        <Tab icon={<SettingsIcon />} label="Système" iconPosition="start" />
                    </Tabs>
                </Box>

                <TabPanel value={tabValue} index={0}>
                    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
                        <Typography variant="h6" gutterBottom>Modifier mes informations</Typography>
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
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <Typography variant="h6" gutterBottom>Paramètres du système</Typography>
                    <Alert severity="info" sx={{ mb: 3 }}>
                        Ces paramètres affectent l'ensemble de l'application et sont réservés aux administrateurs.
                    </Alert>

                    <List>
                        <ListItem>
                            <ListItemText
                                primary="Notifications par courriel"
                                secondary="Envoyer un résumé des activités hebdomadaire"
                            />
                            <ListItemSecondaryAction>
                                <Switch edge="end" defaultChecked />
                            </ListItemSecondaryAction>
                        </ListItem>
                        <Divider variant="inset" component="li" />
                        <ListItem>
                            <ListItemText
                                primary="Thème sombre"
                                secondary="Activer le mode sombre pour l'application"
                            />
                            <ListItemSecondaryAction>
                                <Switch edge="end" />
                            </ListItemSecondaryAction>
                        </ListItem>
                    </List>

                    <Box sx={{ mt: 4 }}>
                        <Typography variant="subtitle1" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Storage fontSize="small" /> Données du Système
                        </Typography>

                        <Divider sx={{ mb: 3 }} />

                        <CategoryManager />

                        <Box sx={{ mt: 4 }}>
                            <Typography variant="subtitle2" gutterBottom>Autres paramètres (À venir)</Typography>
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                    <Button variant="outlined" fullWidth disabled>
                                        Modèles d'Ordre du Jour
                                    </Button>
                                </Grid>
                            </Grid>
                        </Box>
                    </Box>
                </TabPanel>
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
