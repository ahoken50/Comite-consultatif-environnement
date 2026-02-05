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
    Typography,
    Box
} from '@mui/material';
import type { Member, MemberRole } from '../../types/member.types';
import { uploadMemberSignature } from '../../features/members/membersAPI';
import { CloudUpload, Delete } from '@mui/icons-material';

interface MemberDialogProps {
    open: boolean;
    member?: Member | null;
    onClose: () => void;
    onSave: (memberData: Partial<Member>) => void | Promise<void>;
    readOnlyAdminFields?: boolean;
}

const initialMember: Partial<Member> = {
    displayName: '',
    email: '',
    role: 'member',
    phone: '',
    bio: '',
    isActive: true
};

const MemberDialog: React.FC<MemberDialogProps> = ({ open, member, onClose, onSave, readOnlyAdminFields = false }) => {
    const [formData, setFormData] = useState<Partial<Member>>(initialMember);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [uploading, setUploading] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    useEffect(() => {
        if (member) {
            setFormData({
                displayName: member.displayName || '',
                email: member.email || '',
                role: member.role || 'member',
                phone: member.phone || '',
                bio: member.bio || '',
                isActive: member.isActive ?? true,
                mandateStart: member.mandateStart || '',
                mandateEnd: member.mandateEnd || '',
                appointedByResolution: member.appointedByResolution || '',
                isSubstitute: member.isSubstitute || false,
                signatureUrl: member.signatureUrl
            });
        } else {
            setFormData(initialMember);
        }
        setErrors({});

        // Reset local state
        setPendingFile(null);
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(null);
    }, [member, open]);

    // Cleanup preview URL on unmount
    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

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

    const handleSubmit = async () => {
        if (!validate()) return;

        setUploading(true);
        try {
            const currentData = { ...formData };
            let finalId = member?.id || currentData.id;

            // Generate ID if missing (for new members)
            if (!finalId) {
                finalId = crypto.randomUUID();
                currentData.id = finalId;
            }

            // Upload pending signature if exists
            if (pendingFile) {
                const url = await uploadMemberSignature(pendingFile, finalId);
                currentData.signatureUrl = url;
            }

            await onSave(currentData);
        } catch (error) {
            console.error('Error saving member:', error);
            setErrors(prev => ({ ...prev, form: 'Erreur lors de l\'enregistrement' }));
        } finally {
            setUploading(false);
        }
    };

    const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setPendingFile(file);

            // Create preview
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
        }
    };

    const handleRemoveSignature = () => {
        setPendingFile(null);
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
        }
        setFormData(prev => ({ ...prev, signatureUrl: null as any }));
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
                            disabled={readOnlyAdminFields}
                        >
                            <MenuItem value="president">Président(e)</MenuItem>
                            <MenuItem value="vice_president">Vice-Président(e)</MenuItem>
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
                                    disabled={readOnlyAdminFields}
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
                            disabled={readOnlyAdminFields}
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
                            disabled={readOnlyAdminFields}
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
                            disabled={readOnlyAdminFields}
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
                                    disabled={readOnlyAdminFields}
                                />
                            }
                            label="Ce membre est un suppléant"
                        />
                    </Grid>

                    <Grid size={12}>
                        <Divider sx={{ my: 2 }}>
                            <Typography variant="caption" color="textSecondary">SIGNATURE NUMÉRIQUE</Typography>
                        </Divider>

                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, p: 2, border: '1px dashed #ccc', borderRadius: 1 }}>
                            {(previewUrl || formData.signatureUrl) ? (
                                <Box sx={{ position: 'relative', width: '100%', maxWidth: 300, textAlign: 'center' }}>
                                    <img
                                        src={previewUrl || formData.signatureUrl}
                                        alt="Signature"
                                        style={{ maxHeight: 100, maxWidth: '100%', objectFit: 'contain' }}
                                    />
                                    <Button
                                        size="small"
                                        color="error"
                                        startIcon={<Delete />}
                                        onClick={handleRemoveSignature}
                                        sx={{ mt: 1 }}
                                    >
                                        Supprimer
                                    </Button>
                                </Box>
                            ) : (
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="body2" color="textSecondary" gutterBottom>
                                        Aucune signature présente.
                                    </Typography>
                                    <Button
                                        component="label"
                                        variant="outlined"
                                        startIcon={<CloudUpload />}
                                        disabled={uploading}
                                    >
                                        {uploading ? 'Traitement...' : 'Ajouter une signature (Image)'}
                                        <input
                                            type="file"
                                            hidden
                                            accept="image/*"
                                            onChange={handleSignatureUpload}
                                        />
                                    </Button>
                                </Box>
                            )}
                            {errors.signatureUrl && <Typography color="error" variant="caption">{errors.signatureUrl}</Typography>}
                            <Typography variant="caption" color="textSecondary">
                                La signature sera enregistrée lors de la validation du formulaire.
                            </Typography>
                        </Box>
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={uploading}>Annuler</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    color="primary"
                    disabled={uploading}
                >
                    {uploading ? 'Enregistrement...' : (member ? 'Enregistrer' : 'Ajouter')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default MemberDialog;
