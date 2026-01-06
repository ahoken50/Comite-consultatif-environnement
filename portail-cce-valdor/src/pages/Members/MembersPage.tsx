import React, { useEffect, useState, useCallback } from 'react';
import { Box, Typography, Button, Grid, CircularProgress, Alert, Snackbar, Tabs, Tab } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMembers, updateMember, createMember } from '../../features/members/membersSlice';
import { fetchProjects } from '../../features/projects/projectsSlice';
import MemberCard from '../../components/members/MemberCard';
import MemberDialog from '../../components/members/MemberDialog';
import type { Member } from '../../types/member.types';

import MandateList from '../../components/members/MandateList';

const MembersPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: members, loading, error } = useSelector((state: RootState) => state.members);
    const { items: projects } = useSelector((state: RootState) => state.projects);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const [tabValue, setTabValue] = useState(0);

    useEffect(() => {
        dispatch(fetchMembers());
        dispatch(fetchProjects());
    }, [dispatch]);

    const projectCounts = React.useMemo(() => {
        const counts: Record<string, number> = {};
        projects.forEach(p => {
            if (p.coordinatorId) {
                counts[p.coordinatorId] = (counts[p.coordinatorId] || 0) + 1;
            }
        });
        return counts;
    }, [projects]);

    const handleAdd = () => {
        setSelectedMember(null);
        setDialogOpen(true);
    };

    const handleEdit = useCallback((member: Member) => {
        setSelectedMember(member);
        setDialogOpen(true);
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        // Soft delete recommendation instead of hard delete
        if (window.confirm('Voulez-vous archiver ce membre ? Il ne sera plus considéré comme actif mais restera dans l\'historique.')) {
            try {
                // Update to inactive instead of delete
                await dispatch(updateMember({
                    id: id,
                    updates: { isActive: false }
                })).unwrap();
                setNotification({ message: 'Membre archivé avec succès', type: 'success' });
            } catch (error) {
                console.error('Failed to archive member:', error);
                setNotification({ message: 'Erreur lors de l\'archivage', type: 'error' });
            }
        }
    }, [dispatch]);

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
                // Create new
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

    // Filter members based on tab
    const displayedMembers = React.useMemo(() => {
        return members.filter(m => tabValue === 0 ? m.isActive : !m.isActive);
    }, [members, tabValue]);

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

            {/* Mandate Dashboard - Only show for Active tab */}
            {tabValue === 0 && (
                <Box sx={{ mb: 4 }}>
                    <MandateList members={members} />
                </Box>
            )}

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                    <Tab label={`Membres Actifs (${members.filter(m => m.isActive).length})`} />
                    <Tab label={`Archives (${members.filter(m => !m.isActive).length})`} />
                </Tabs>
            </Box>

            <Grid container spacing={3}>
                {displayedMembers.map((member) => (
                    <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={member.id}>
                        <MemberCard
                            member={member}
                            projectCount={projectCounts[member.id] || 0}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    </Grid>
                ))}
                {displayedMembers.length === 0 && (
                    <Grid size={12}>
                        <Typography color="textSecondary" align="center" py={4}>
                            Aucun membre dans cette section.
                        </Typography>
                    </Grid>
                )}
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
