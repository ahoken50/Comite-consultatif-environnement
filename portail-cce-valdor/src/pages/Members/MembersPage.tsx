import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, Grid, CircularProgress, Alert, Snackbar } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMembers, deleteMember, updateMember, createMember } from '../../features/members/membersSlice';
import MemberCard from '../../components/members/MemberCard';
import MemberDialog from '../../components/members/MemberDialog';
import type { Member } from '../../types/member.types';

const MembersPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: members, loading, error } = useSelector((state: RootState) => state.members);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        dispatch(fetchMembers());
    }, [dispatch]);

    const handleAdd = () => {
        setSelectedMember(null);
        setDialogOpen(true);
    };

    const handleEdit = (member: Member) => {
        setSelectedMember(member);
        setDialogOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer ce membre ?')) {
            try {
                await dispatch(deleteMember(id)).unwrap();
                setNotification({ message: 'Membre supprimé avec succès', type: 'success' });
            } catch (err) {
                setNotification({ message: 'Erreur lors de la suppression', type: 'error' });
            }
        }
    };

    const handleSave = async (memberData: Partial<Member>) => {
        try {
            if (selectedMember) {
                // Update existing
                await dispatch(updateMember({
                    id: selectedMember.id,
                    updates: memberData
                })).unwrap();
                setNotification({ message: 'Membre mis à jour avec succès', type: 'success' });
            } else {
                // Create new (generate ID if needed, here we simulate random ID or use email as temp ID)
                // Note: Real app usually creates users via Auth. Here we create a DB record.
                const newId = crypto.randomUUID();
                const newMember = {
                    ...memberData,
                    id: newId,
                    dateJoined: new Date().toISOString()
                } as Member;

                await dispatch(createMember(newMember)).unwrap();
                setNotification({ message: 'Membre ajouté avec succès', type: 'success' });
            }
            setDialogOpen(false);
        } catch (err) {
            console.error(err);
            setNotification({ message: 'Erreur lors de l\'enregistrement', type: 'error' });
        }
    };

    if (loading && members.length === 0) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" fontWeight={700}>
                    Membres du comité
                </Typography>
                <Button variant="contained" startIcon={<Add />} onClick={handleAdd}>
                    Ajouter un membre
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

            <Grid container spacing={3}>
                {members.map((member) => (
                    <Grid size={{ xs: 12, md: 6, lg: 4 }} key={member.id}>
                        <MemberCard
                            member={member}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    </Grid>
                ))}
            </Grid>

            <MemberDialog
                open={dialogOpen}
                member={selectedMember}
                onClose={() => setDialogOpen(false)}
                onSave={handleSave}
            />

            <Snackbar
                open={!!notification}
                autoHideDuration={6000}
                onClose={() => setNotification(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert onClose={() => setNotification(null)} severity={notification?.type || 'success'}>
                    {notification?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MembersPage;
