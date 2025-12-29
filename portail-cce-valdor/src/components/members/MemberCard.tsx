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
    MenuItem,
    Divider
} from '@mui/material';
import { MoreVert, Email, Phone, Event, Assignment } from '@mui/icons-material';
import type { Member } from '../../types/member.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MemberCardProps {
    member: Member;
    projectCount?: number;
    onEdit?: (member: Member) => void;
    onDelete?: (id: string) => void;
}

const MemberCard: React.FC<MemberCardProps> = memo(({ member, projectCount = 0, onEdit, onDelete }) => {
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
            case 'elected_official': return 'secondary';
            case 'observer': return 'default';
            default: return 'default';
        }
    };

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'coordinator': return 'Coordonnateur';
            case 'member': return 'Membre';
            case 'elected_official': return 'Élu Responsable';
            case 'observer': return 'Observateur';
            default: return role;
        }
    };

    return (
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.3s', '&:hover': { boxShadow: 6 } }}>
            <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Avatar
                            src={member.photoURL}
                            alt={member.displayName}
                            sx={{ width: 64, height: 64, bgcolor: 'primary.light' }}
                        >
                            {member.displayName.charAt(0)}
                        </Avatar>
                        <Box>
                            <Typography variant="h6" fontWeight="bold">{member.displayName}</Typography>
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

                <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
                        <Email fontSize="small" color="action" />
                        <Typography variant="body2">{member.email}</Typography>
                    </Box>
                    {member.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
                            <Phone fontSize="small" color="action" />
                            <Typography variant="body2">{member.phone}</Typography>
                        </Box>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
                        <Event fontSize="small" color="action" />
                        <Typography variant="body2">
                            Membre depuis {member.dateJoined ? format(new Date(member.dateJoined), 'MMM yyyy', { locale: fr }) : '-'}
                        </Typography>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Assignment color={projectCount > 0 ? 'primary' : 'disabled'} />
                        <Typography variant="body2" fontWeight={projectCount > 0 ? 'bold' : 'normal'}>
                            {projectCount} projet{projectCount !== 1 ? 's' : ''} assigné{projectCount !== 1 ? 's' : ''}
                        </Typography>
                    </Box>
                </Box>

                {member.bio && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: 'italic' }}>
                        "{member.bio}"
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
