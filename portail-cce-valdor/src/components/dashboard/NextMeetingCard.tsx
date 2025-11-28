import React from 'react';
import { Card, CardContent, Typography, Box, Button } from '@mui/material';
import { Event, AccessTime } from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';

const NextMeetingCard: React.FC = () => {
    // Mock data
    const nextMeetingDate = new Date(2025, 1, 15, 17, 0); // Feb 15, 2025, 17:00
    const daysRemaining = differenceInDays(nextMeetingDate, new Date());

    return (
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="overline" color="textSecondary" sx={{ fontWeight: 600, letterSpacing: 1 }}>
                        PROCHAINE ASSEMBLÉE
                    </Typography>
                    <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Event color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {format(nextMeetingDate, 'd MMMM yyyy', { locale: fr })}
                        </Typography>
                    </Box>
                    <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AccessTime color="action" fontSize="small" />
                        <Typography variant="body2" color="textSecondary">
                            {format(nextMeetingDate, 'HH:mm', { locale: fr })} - Salle du Conseil
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ mt: 4, textAlign: 'center' }}>
                    <Typography variant="h3" color="primary.main" sx={{ fontWeight: 700 }}>
                        {daysRemaining}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                        jours restants
                    </Typography>
                </Box>

                <Button variant="outlined" fullWidth sx={{ mt: 3 }}>
                    Voir l'ordre du jour
                </Button>
            </CardContent>
        </Card>
    );
};

export default NextMeetingCard;
