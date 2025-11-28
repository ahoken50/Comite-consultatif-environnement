import React, { useEffect } from 'react';
import { Box, Typography, Button, Grid, CircularProgress } from '@mui/material';
import { Add } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMembers, deleteMember } from '../../features/members/membersSlice';
import MemberCard from '../../components/members/MemberCard';
import type { Member } from '../../types/member.types';

const MembersPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: members, loading } = useSelector((state: RootState) => state.members);

    useEffect(() => {
        dispatch(fetchMembers());
    }, [dispatch]);

    const handleEdit = (member: Member) => {
        // Placeholder for edit functionality
        alert(`Edit functionality for ${member.displayName} is not yet implemented.`);
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Êtes-vous sûr de vouloir supprimer ce membre ?')) {
            await dispatch(deleteMember(id));
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
                <Button variant="contained" startIcon={<Add />}>
                    Ajouter un membre
                </Button>
            </Box>

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
        </Box>
    );
};

export default MembersPage;
