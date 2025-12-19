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
    Switch
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

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                {member ? 'Modifier le membre' : 'Ajouter un membre'}
            </DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={2}>
                    <Grid size={12}>
                        <TextField
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
                            name="role"
                            select
                            label="Rôle"
                            value={formData.role}
                            onChange={handleRoleChange}
                            fullWidth
                        >
                            <MenuItem value="member">Membre</MenuItem>
                            <MenuItem value="coordinator">Coordonnateur</MenuItem>
                            <MenuItem value="observer">Observateur</MenuItem>
                        </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                            name="phone"
                            label="Téléphone"
                            value={formData.phone}
                            onChange={handleChange}
                            fullWidth
                        />
                    </Grid>
                    <Grid size={12}>
                        <TextField
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
                                    checked={formData.isActive}
                                    onChange={handleSwitchChange}
                                    color="primary"
                                />
                            }
                            label="Membre actif"
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
