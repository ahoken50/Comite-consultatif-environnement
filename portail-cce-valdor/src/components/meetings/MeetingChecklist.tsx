import React, { useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Chip,
    LinearProgress,
    Tooltip
} from '@mui/material';
import {
    CheckCircle,
    Cancel,
    Group,
    Description,
    Email,
    ListAlt,
    Warning
} from '@mui/icons-material';
import type { Meeting } from '../../types/meeting.types';

interface MeetingChecklistProps {
    meeting: Meeting;
    hasConvocation?: boolean; // Optional: pass true if convocation has been sent
}

interface ChecklistItem {
    id: string;
    label: string;
    description: string;
    isComplete: boolean;
    icon: React.ReactNode;
    importance: 'critical' | 'important' | 'nice-to-have';
}

/**
 * Meeting Preparation Checklist (#3.1)
 * Shows a checklist of items to verify before a meeting
 */
const MeetingChecklist: React.FC<MeetingChecklistProps> = ({ meeting, hasConvocation }) => {

    const checklistItems: ChecklistItem[] = useMemo(() => {
        const items: ChecklistItem[] = [];

        // 1. Agenda items exist
        const hasAgendaItems = meeting.agendaItems && meeting.agendaItems.length > 0;
        items.push({
            id: 'agenda',
            label: 'Ordre du jour',
            description: hasAgendaItems
                ? `${meeting.agendaItems.length} point(s) à l'ordre du jour`
                : 'Aucun point à l\'ordre du jour',
            isComplete: hasAgendaItems,
            icon: <ListAlt />,
            importance: 'critical'
        });

        // 2. Quorum projected (from RSVPs)
        const rsvps = meeting.rsvps || [];
        const presentCount = rsvps.filter(r => r.status === 'present').length;
        const quorumRequired = meeting.quorumRequired || 3;
        const quorumMet = presentCount >= quorumRequired;
        items.push({
            id: 'quorum',
            label: 'Quorum prévu',
            description: `${presentCount} présence(s) confirmée(s) sur ${quorumRequired} requises`,
            isComplete: quorumMet,
            icon: <Group />,
            importance: 'critical'
        });

        // 3. Convocation sent (check prop first, then fallback to RSVPs)
        // Note: The actual convocation state is in a subcollection, so prefer the prop
        const convocationSent = (hasConvocation === true) || (rsvps.length > 0);
        items.push({
            id: 'convocation',
            label: 'Avis de convocation',
            description: convocationSent
                ? `Envoyé à ${rsvps.length || 'plusieurs'} membre(s)`
                : 'Aucune convocation envoyée',
            isComplete: convocationSent,
            icon: <Email />,
            importance: 'critical'
        });

        // 4. All agenda items have descriptions
        const agendaWithDesc = meeting.agendaItems?.filter(item =>
            item.description && item.description.trim().length > 0
        ).length || 0;
        const totalAgenda = meeting.agendaItems?.length || 0;
        const allHaveDesc = totalAgenda > 0 && agendaWithDesc === totalAgenda;
        items.push({
            id: 'descriptions',
            label: 'Descriptions des points',
            description: totalAgenda > 0
                ? `${agendaWithDesc}/${totalAgenda} point(s) avec description`
                : 'Aucun point à vérifier',
            isComplete: allHaveDesc || totalAgenda === 0,
            icon: <Description />,
            importance: 'important'
        });

        // 5. Meeting location/date set
        const hasLocation = Boolean(meeting.location && meeting.location.trim().length > 0);
        items.push({
            id: 'location',
            label: 'Lieu de la réunion',
            description: hasLocation
                ? meeting.location
                : 'Lieu non spécifié',
            isComplete: hasLocation,
            icon: hasLocation ? <CheckCircle /> : <Warning />,
            importance: 'important'
        });

        return items;
    }, [meeting, hasConvocation]);

    // Calculate overall progress
    const completedCount = checklistItems.filter(item => item.isComplete).length;
    const totalCount = checklistItems.length;
    const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

    // Check for critical items not complete
    const criticalIncomplete = checklistItems.filter(
        item => item.importance === 'critical' && !item.isComplete
    );

    const getProgressColor = () => {
        if (progressPercentage === 100) return 'success';
        if (progressPercentage >= 80) return 'info';
        if (progressPercentage >= 40) return 'warning';
        return 'warning'; // Use warning instead of error for softer appearance
    };

    const getImportanceColor = (importance: string) => {
        switch (importance) {
            case 'critical': return 'warning'; // Changed from 'error' to 'warning'
            case 'important': return 'info';
            default: return 'default';
        }
    };

    return (
        <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Préparation de la réunion
                </Typography>
                <Chip
                    label={`${completedCount}/${totalCount}`}
                    color={getProgressColor() as any}
                    size="small"
                />
            </Box>

            <LinearProgress
                variant="determinate"
                value={progressPercentage}
                color={getProgressColor() as any}
                sx={{ height: 8, borderRadius: 4, mb: 2 }}
            />

            {criticalIncomplete.length > 0 && (
                <Box sx={{
                    bgcolor: 'warning.light',
                    color: 'warning.dark',
                    p: 1.5,
                    borderRadius: 1,
                    mb: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    border: '1px solid',
                    borderColor: 'warning.main'
                }}>
                    <Warning fontSize="small" />
                    <Typography variant="body2">
                        {criticalIncomplete.length} élément(s) à compléter avant la réunion
                    </Typography>
                </Box>
            )}

            <List dense>
                {checklistItems.map((item) => (
                    <ListItem key={item.id} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            {item.isComplete ? (
                                <CheckCircle color="success" />
                            ) : (
                                <Cancel color="warning" />
                            )}
                        </ListItemIcon>
                        <ListItemText
                            primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                        {item.label}
                                    </Typography>
                                    <Tooltip title={item.importance === 'critical' ? 'Critique' : 'Important'}>
                                        <Chip
                                            size="small"
                                            label={item.importance === 'critical' ? '!' : ''}
                                            color={getImportanceColor(item.importance) as any}
                                            sx={{
                                                height: 16,
                                                width: 16,
                                                fontSize: '0.6rem',
                                                display: item.importance === 'nice-to-have' ? 'none' : 'flex'
                                            }}
                                        />
                                    </Tooltip>
                                </Box>
                            }
                            secondary={item.description}
                        />
                        <Box sx={{ ml: 1 }}>
                            {item.icon}
                        </Box>
                    </ListItem>
                ))}
            </List>
        </Paper>
    );
};

export default MeetingChecklist;
