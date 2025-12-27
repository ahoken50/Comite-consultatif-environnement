import React, { memo } from 'react';
import {
    Card,
    CardContent,
    Typography,
    Avatar,
    Box,
    Chip,
    IconButton,
    Menu,
    MenuItem
} from '@mui/material';
import { MoreVert, Email, Phone } from '@mui/icons-material';
import type { Member } from '../../types/member.types';

interface MemberCardProps {
    member: Member;
    onEdit?: (member: Member) => void;
    onDelete?: (id: string) => void;
}

const MemberCard: React.FC<MemberCardProps> = memo(({ member, onEdit, onDelete }) => {
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

    const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const handleEdit = () => {
        handleMenuClose();
        if (onEdit) onEdit(member);
    };

    const handleDelete = () => {
        handleMenuClose();
        if (onDelete) onDelete(member.id);
    };

    const getRoleColor = (role: string) => {
        switch (role) {
            case 'coordinator': return 'primary';
            case 'member': return 'success';
            case 'observer': return 'default';
            default: return 'default';
        }
    };

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'coordinator': return 'Coordonnateur';
            case 'member': return 'Membre';
            case 'observer': return 'Observateur';
            default: return role;
        }
    };

    return (
        <Card>
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Avatar
                            src={member.photoURL}
                            alt={member.displayName}
                            sx={{ width: 56, height: 56 }}
                        />
                        <Box>
                            <Typography variant="h6">{member.displayName}</Typography>
                            <Chip
                                label={getRoleLabel(member.role)}
                                color={getRoleColor(member.role) as any}
                                size="small"
                                sx={{ mt: 0.5 }}
                            />
                        </Box>
                    </Box>
                    <IconButton onClick={handleMenuOpen} aria-label={`Options pour ${member.displayName}`}>
                        <MoreVert />
                    </IconButton>
                </Box>

                <Box sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'text.secondary' }}>
                        <Email fontSize="small" />
                        <Typography variant="body2">{member.email}</Typography>
                    </Box>
                    {member.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'text.secondary' }}>
                            <Phone fontSize="small" />
                            <Typography variant="body2">{member.phone}</Typography>
                        </Box>
                    )}
                </Box>

                {member.bio && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        {member.bio}
                    </Typography>
                )}
            </CardContent>

            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
            >
                <MenuItem onClick={handleEdit}>Modifier</MenuItem>
                <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>Supprimer</MenuItem>
            </Menu>
        </Card>
    );
});

export default MemberCard;
