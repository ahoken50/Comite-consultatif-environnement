import React from 'react';
import { Card, CardContent, Typography, Box, Chip, IconButton } from '@mui/material';
import { CalendarToday, LocationOn, Edit, Delete } from '@mui/icons-material';
import type { Meeting } from '../../types/meeting.types';
import { MeetingStatus, MeetingType } from '../../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MeetingCardProps {
    meeting: Meeting;
    onClick: (id: string) => void;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
}

const MeetingCard: React.FC<MeetingCardProps> = ({ meeting, onClick, onEdit, onDelete }) => {
    const getStatusColor = (status: MeetingStatus) => {
        switch (status) {
            case MeetingStatus.SCHEDULED: return 'primary';
            case MeetingStatus.IN_PROGRESS: return 'success';
            case MeetingStatus.COMPLETED: return 'default';
            case MeetingStatus.CANCELLED: return 'error';
            default: return 'default';
        }
    };

    const getTypeLabel = (type: MeetingType) => {
        switch (type) {
            case MeetingType.REGULAR: return 'Régulière';
            case MeetingType.SPECIAL: return 'Spéciale';
            case MeetingType.URGENT: return 'Urgence';
            default: return type;
        }
    };

    return (
        <Card
            sx={{
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 4
                },
                position: 'relative'
            }}
            onClick={() => onClick(meeting.id)}
        >
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box>
                        <Typography variant="h6" fontWeight={700} gutterBottom>
                            {meeting.title}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Chip
                                label={getTypeLabel(meeting.type)}
                                size="small"
                                color={meeting.type === MeetingType.URGENT ? 'error' : 'default'}
                                variant="outlined"
                            />
                            <Chip
                                label={meeting.status === 'scheduled' ? 'Planifiée' : meeting.status === 'in_progress' ? 'En cours' : meeting.status === 'completed' ? 'Terminée' : 'Annulée'}
                                size="small"
                                color={getStatusColor(meeting.status) as any}
                            />
                        </Box>
                    </Box>
                    <Box>
                        {onEdit && (
                            <IconButton
                                size="small"
                                onClick={(e) => { e.stopPropagation(); onEdit(meeting.id); }}
                            >
                                <Edit fontSize="small" />
                            </IconButton>
                        )}
                        {onDelete && (
                            <IconButton
                                size="small"
                                color="error"
                                onClick={(e) => { e.stopPropagation(); onDelete(meeting.id); }}
                            >
                                <Delete fontSize="small" />
                            </IconButton>
                        )}
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'text.secondary' }}>
                    <CalendarToday fontSize="small" />
                    <Typography variant="body2">
                        {format(new Date(meeting.date), 'd MMMM yyyy à HH:mm', { locale: fr })}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                    <LocationOn fontSize="small" />
                    <Typography variant="body2">
                        {meeting.location}
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
};

export default MeetingCard;
