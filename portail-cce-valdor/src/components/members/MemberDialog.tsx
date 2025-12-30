import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    Grid,
    FormControlLabel,
    Switch,
    Divider,
    Typography
} from '@mui/material';
import type { Member, MemberRole } from '../../types/member.types';

interface MemberDialogProps {
    open: boolean;
    member?: Member | null;
    onClose: () => void;
    onSave: (memberData: Partial<Member>) => void;
}

const initialMember: Partial<Member> = {
    displayName: '',
    email: '',
    role: 'member',
    phone: '',
    bio: '',
    isActive: true
};

const MemberDialog: React.FC<MemberDialogProps> = ({ open, member, onClose, onSave }) => {
    const [formData, setFormData] = useState<Partial<Member>>(initialMember);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (member) {
            setFormData({
                displayName: member.displayName || '',
                email: member.email || '',
                role: member.role || 'member',
                phone: member.phone || '',
                bio: member.bio || '',
                isActive: member.isActive ?? true
            });
        } else {
            setFormData(initialMember);
        }
        setErrors({});
    }, [member, open]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const handleRoleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, role: e.target.value as MemberRole }));
    };

    const handleSwitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, isActive: e.target.checked }));
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.displayName?.trim()) newErrors.displayName = 'Le nom est requis';
        if (!formData.email?.trim()) newErrors.email = 'L\'email est requis';
        // Basic email validation
        if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = 'Email invalide';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (validate()) {
            onSave(formData);
        }
    };

    const formId = React.useId();

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                {member ? 'Modifier le membre' : 'Ajouter un membre'}
            </DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={2}>
                    <Grid size={12}>
                        <TextField
                            id={`${formId}-displayName`}
                            name="displayName"
                            label="Nom complet"
                            value={formData.displayName}
                            onChange={handleChange}
                            fullWidth
                            required
                            error={!!errors.displayName}
                            helperText={errors.displayName}
                        />
                    </Grid>
                    <Grid size={12}>
                        <TextField
                            id={`${formId}-email`}
                            name="email"
                            label="Email"
                            value={formData.email}
                            onChange={handleChange}
                            fullWidth
                            required
                            type="email"
                            error={!!errors.email}
                            helperText={errors.email}
                            disabled={!!member} // Disable email edit for existing members to avoid auth mismatch
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                            id={`${formId}-role`}
                            name="role"
                            select
                            label="Rôle"
                            value={formData.role}
                            onChange={handleRoleChange}
                            fullWidth
                        >
                            <MenuItem value="member">Membre</MenuItem>
                            <MenuItem value="elected_official">Élu(e) municipal</MenuItem>
                            <MenuItem value="coordinator">Coordonnateur</MenuItem>
                            <MenuItem value="observer">Observateur</MenuItem>
                        </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                            id={`${formId}-phone`}
                            name="phone"
                            label="Téléphone"
                            value={formData.phone}
                            onChange={handleChange}
                            fullWidth
                        />
                    </Grid>
                    <Grid size={12}>
                        <TextField
                            id={`${formId}-bio`}
                            name="bio"
                            label="Biographie / Notes"
                            value={formData.bio}
                            onChange={handleChange}
                            fullWidth
                            multiline
                            rows={3}
                        />
                    </Grid>
                    <Grid size={12}>
                        <FormControlLabel
                            control={
                                <Switch
                                    id={`${formId}-isActive`}
                                    checked={formData.isActive}
                                    onChange={handleSwitchChange}
                                    color="primary"
                                />
                            }
                            label="Membre actif"
                        />
                    </Grid>

                    <Grid size={12}>
                        <Divider sx={{ my: 1 }} >
                            <Typography variant="caption" color="textSecondary">MANDAT & STATUT</Typography>
                        </Divider>
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                            id={`${formId}-mandateStart`}
                            name="mandateStart"
                            label="Début du mandat"
                            type="date"
                            value={formData.mandateStart || ''}
                            onChange={handleChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                            id={`${formId}-mandateEnd`}
                            name="mandateEnd"
                            label="Fin du mandat"
                            type="date"
                            value={formData.mandateEnd || ''}
                            onChange={handleChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 12 }}>
                        <TextField
                            id={`${formId}-appointedByResolution`}
                            name="appointedByResolution"
                            label="Résolution de nomination (ex: 2024-123)"
                            value={formData.appointedByResolution || ''}
                            onChange={handleChange}
                            fullWidth
                        />
                    </Grid>

                    <Grid size={12}>
                        <FormControlLabel
                            control={
                                <Switch
                                    id={`${formId}-isSubstitute`}
                                    checked={!!formData.isSubstitute}
                                    onChange={(e) => setFormData(prev => ({ ...prev, isSubstitute: e.target.checked }))}
                                    color="default"
                                />
                            }
                            label="Ce membre est un suppléant"
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Annuler</Button>
                <Button onClick={handleSubmit} variant="contained" color="primary">
                    {member ? 'Enregistrer' : 'Ajouter'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default MemberDialog;
