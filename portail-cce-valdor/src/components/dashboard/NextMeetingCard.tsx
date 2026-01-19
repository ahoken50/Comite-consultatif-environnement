import React from 'react';
import { Card, CardContent, Typography, Box, Button, CircularProgress } from '@mui/material';
import { Event, AccessTime } from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import type { Meeting } from '../../types/meeting.types';

interface NextMeetingCardProps {
    meeting: Meeting | null;
}

/**
 * Enhanced NextMeetingCard with circular countdown (#1.3)
 * Color coded: green (>7 days), yellow (3-7 days), red (<3 days)
 */
const NextMeetingCard: React.FC<NextMeetingCardProps> = ({ meeting }) => {
    const navigate = useNavigate();

    const nextMeetingDate = meeting ? new Date(meeting.date) : null;
    const daysUntil = nextMeetingDate ? differenceInDays(nextMeetingDate, new Date()) : 0;

    // Calculate color based on days remaining
    const getCountdownColor = (days: number): string => {
        if (days <= 0) return '#ef4444'; // Red - today or past
        if (days <= 2) return '#ef4444'; // Red - urgent
        if (days <= 7) return '#f59e0b'; // Yellow/Orange - warning
        return '#22c55e'; // Green - comfortable
    };

    // Calculate progress (30 days max countdown visualization)
    const maxDays = 30;
    const progressValue = Math.min(100, Math.max(0, ((maxDays - daysUntil) / maxDays) * 100));

    const countdownColor = getCountdownColor(daysUntil);

    return (
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="overline" color="textSecondary" sx={{ fontWeight: 600, letterSpacing: 1 }}>
                        PROCHAINE ASSEMBLÉE
                    </Typography>
                    {nextMeetingDate ? (
                        <>
                            <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Event color="primary" />
                                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                    {format(nextMeetingDate, 'd MMMM yyyy', { locale: fr })}
                                </Typography>
                            </Box>
                            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <AccessTime color="action" fontSize="small" />
                                <Typography variant="body2" color="textSecondary">
                                    {format(nextMeetingDate, 'HH:mm', { locale: fr })} - {meeting?.location || 'Lieu à confirmer'}
                                </Typography>
                            </Box>
                            {meeting?.title && (
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                                    {meeting.title}
                                </Typography>
                            )}
                        </>
                    ) : (
                        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Event color="disabled" />
                            <Typography variant="body1" color="text.secondary">
                                Aucune assemblée prévue
                            </Typography>
                        </Box>
                    )}
                </Box>

                {/* Circular Countdown Visual (#1.3) */}
                {nextMeetingDate && daysUntil >= 0 && (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                            {/* Background circle */}
                            <CircularProgress
                                variant="determinate"
                                value={100}
                                size={100}
                                thickness={4}
                                sx={{ color: 'grey.200' }}
                            />
                            {/* Progress circle */}
                            <CircularProgress
                                variant="determinate"
                                value={100 - progressValue}
                                size={100}
                                thickness={4}
                                sx={{
                                    color: countdownColor,
                                    position: 'absolute',
                                    left: 0,
                                    transition: 'color 0.3s ease',
                                }}
                            />
                            {/* Center content */}
                            <Box
                                sx={{
                                    top: 0,
                                    left: 0,
                                    bottom: 0,
                                    right: 0,
                                    position: 'absolute',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Typography
                                    variant="h4"
                                    component="span"
                                    sx={{ fontWeight: 700, color: countdownColor, lineHeight: 1 }}
                                >
                                    {daysUntil}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                    {daysUntil === 0 ? "Aujourd'hui!" : daysUntil === 1 ? 'jour' : 'jours'}
                                </Typography>
                            </Box>
                        </Box>
                    </Box>
                )}

                <Button
                    variant="outlined"
                    fullWidth
                    sx={{ mt: 3 }}
                    disabled={!meeting}
                    onClick={() => meeting && navigate(`/meetings/${meeting.id}`)}
                >
                    Voir l'ordre du jour
                </Button>
            </CardContent>
        </Card>
    );
};

export default NextMeetingCard;

