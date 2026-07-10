import React, { useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Avatar,
    Stack
} from '@mui/material';
import { Warning, CheckCircle, Error as ErrorIcon, CalendarMonth } from '@mui/icons-material';
import type { Member } from '../../types/member.types';
import { differenceInDays, parseISO, format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MandateListProps {
    members: Member[];
}

const MandateList: React.FC<MandateListProps> = ({ members }) => {
    // Filter only members with mandate dates
    const sortedMembers = useMemo(() => {
        const mandateMembers = members.filter(m => m.mandateEnd && m.isActive);

        // Sort by expiration date (soonest first)
        return mandateMembers.sort((a, b) => {
            if (!a.mandateEnd || !b.mandateEnd) return 0;
            return new Date(a.mandateEnd).getTime() - new Date(b.mandateEnd).getTime();
        });
    }, [members]);

    const getStatus = (endDateStr: string) => {
        const endDate = parseISO(endDateStr);
        const today = new Date();
        const daysLeft = differenceInDays(endDate, today);

        if (daysLeft < 0) return { label: 'Expiré', color: 'error', icon: <ErrorIcon fontSize="small" /> };
        if (daysLeft < 90) return { label: 'Expire bientôt', color: 'warning', icon: <Warning fontSize="small" /> };
        return { label: 'Actif', color: 'success', icon: <CheckCircle fontSize="small" /> };
    };

    return (
        <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
            <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'white' }}>
                <Typography variant="h6" display="flex" alignItems="center" gap={1}>
                    <CalendarMonth /> Renouvellement des Mandats
                </Typography>
            </Box>

            {sortedMembers.length === 0 ? (
                <Box p={3} textAlign="center">
                    <Typography color="textSecondary">Aucune date de fin de mandat configurée pour les membres actifs.</Typography>
                </Box>
            ) : (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.50' }}>
                                <TableCell>Membre</TableCell>
                                <TableCell>Rôle</TableCell>
                                <TableCell>Fin du Mandat</TableCell>
                                <TableCell>Statut</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sortedMembers.map((member) => {
                                const status = getStatus(member.mandateEnd!);
                                return (
                                    <TableRow key={member.id} hover>
                                        <TableCell>
                                            <Stack direction="row" alignItems="center" spacing={2}>
                                                <Avatar src={member.photoURL} alt={member.displayName} sx={{ width: 32, height: 32 }} />
                                                <Typography variant="body2" fontWeight={500}>
                                                    {member.displayName}
                                                </Typography>
                                            </Stack>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
                                                {member.role === 'elected_official' ? 'Élu' : member.role}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            {format(parseISO(member.mandateEnd!), 'd MMMM yyyy', { locale: fr })}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={status.label}
                                                color={status.color as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'}
                                                size="small"
                                                icon={status.icon}
                                                variant="outlined"
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Paper>
    );
};

export default React.memo(MandateList);
