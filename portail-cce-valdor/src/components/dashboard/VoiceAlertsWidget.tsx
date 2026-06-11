import React from 'react';
import {
    Card, CardHeader, CardContent, Box, Typography, LinearProgress,
    Chip, List, ListItem, ListItemText, ListItemIcon, Skeleton
} from '@mui/material';
import { RecordVoiceOver, Warning, CheckCircle } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { VoiceAlert } from '../../services/voiceAlertService';
import { getQualityColor, getQualityLabel } from '../../services/voiceAlertService';

interface VoiceAlertsWidgetProps {
    alerts: VoiceAlert[];
    loading: boolean;
}

const VoiceAlertsWidget: React.FC<VoiceAlertsWidgetProps> = ({ alerts, loading }) => {
    const navigate = useNavigate();

    const needsImprovement = alerts.filter(a => a.quality !== 'robuste');
    const total = alerts.length;

    if (loading) {
        return (
            <Card sx={{ height: '100%' }}>
                <CardHeader title={<Skeleton width={180} />} />
                <CardContent>
                    {[1, 2, 3].map(i => (
                        <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
                    ))}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader
                avatar={<RecordVoiceOver color="primary" />}
                title={
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>Profils Vocaux</Typography>
                }
                subheader={
                    needsImprovement.length > 0
                        ? `${needsImprovement.length}/${total} profils nécessitent une amélioration`
                        : '✅ Tous les profils sont à jour'
                }
                subheaderTypographyProps={{
                    variant: 'caption',
                    color: needsImprovement.length > 0 ? 'warning.main' : 'success.main',
                    fontWeight: 500,
                }}
                sx={{ pb: 0 }}
            />
            <CardContent sx={{ pt: 1, maxHeight: 280, overflow: 'auto' }}>
                {needsImprovement.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                        <CheckCircle sx={{ fontSize: 40, color: '#22c55e', mb: 1 }} />
                        <Typography variant="body2">
                            Tous les profils vocaux sont robustes.
                        </Typography>
                    </Box>
                ) : (
                    <List dense disablePadding>
                        {needsImprovement.slice(0, 6).map((alert) => (
                            <ListItem
                                key={alert.memberId}
                                sx={{
                                    px: 0,
                                    cursor: 'pointer',
                                    borderRadius: 1,
                                    '&:hover': { bgcolor: 'action.hover' },
                                }}
                                onClick={() => navigate('/members')}
                            >
                                <ListItemIcon sx={{ minWidth: 32 }}>
                                    {alert.quality === 'inexistant' ? (
                                        <Warning sx={{ fontSize: 18, color: '#ef4444' }} />
                                    ) : (
                                        <RecordVoiceOver sx={{ fontSize: 18, color: getQualityColor(alert.quality) }} />
                                    )}
                                </ListItemIcon>
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }} noWrap>
                                                {alert.memberName}
                                            </Typography>
                                            <Chip
                                                label={getQualityLabel(alert.quality)}
                                                size="small"
                                                sx={{
                                                    fontSize: '0.65rem',
                                                    height: 20,
                                                    bgcolor: getQualityColor(alert.quality) + '20',
                                                    color: getQualityColor(alert.quality),
                                                    fontWeight: 600,
                                                    borderRadius: 1,
                                                }}
                                            />
                                        </Box>
                                    }
                                    secondary={
                                        <Box sx={{ mt: 0.5 }}>
                                            <LinearProgress
                                                variant="determinate"
                                                value={alert.percentComplete}
                                                sx={{
                                                    height: 4,
                                                    borderRadius: 2,
                                                    bgcolor: 'grey.200',
                                                    '& .MuiLinearProgress-bar': {
                                                        borderRadius: 2,
                                                        bgcolor: getQualityColor(alert.quality),
                                                    }
                                                }}
                                            />
                                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                                                {alert.sampleCount}/10 échantillons
                                            </Typography>
                                        </Box>
                                    }
                                />
                            </ListItem>
                        ))}
                        {needsImprovement.length > 6 && (
                            <Typography
                                variant="caption"
                                color="primary"
                                sx={{ cursor: 'pointer', mt: 1, display: 'block', textAlign: 'center' }}
                                onClick={() => navigate('/members')}
                            >
                                +{needsImprovement.length - 6} autres membres →
                            </Typography>
                        )}
                    </List>
                )}
            </CardContent>
        </Card>
    );
};

export default VoiceAlertsWidget;
