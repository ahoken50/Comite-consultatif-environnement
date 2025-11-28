import React from 'react';
import { Card, CardHeader, List, ListItem, ListItemButton, ListItemText, Chip, Box, Typography } from '@mui/material';
import { Warning } from '@mui/icons-material';

const AlertsPanel: React.FC = () => {
    // Mock data - replace with real data later
    const alerts = [
        { id: 1, code: 'EC-07', title: 'Politique environnementale', status: 'blocked', label: 'BLOQUÉ' },
        { id: 2, code: 'ND-04', title: 'Balayures de rue', status: 'urgent', label: 'URGENT' },
        { id: 3, code: 'ND-05', title: 'Réfection barrage', status: 'urgent', label: 'URGENT' },
    ];

    return (
        <Card>
            <CardHeader
                title={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Warning color="error" />
                        <Typography variant="h6">Alertes Critiques</Typography>
                    </Box>
                }
                sx={{ borderBottom: 1, borderColor: 'divider', py: 2 }}
            />
            <List disablePadding>
                {alerts.map((alert) => (
                    <ListItem
                        key={alert.id}
                        divider
                        disablePadding
                    >
                        <ListItemButton sx={{ py: 2 }}>
                            <ListItemText
                                primary={
                                    <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                                        {alert.code}: {alert.title}
                                    </Typography>
                                }
                                secondary="Action requise immédiatement"
                            />
                            <Chip
                                label={alert.label}
                                size="small"
                                color={alert.status === 'blocked' ? 'error' : 'warning'}
                                sx={{ fontWeight: 600, borderRadius: 1 }}
                            />
                        </ListItemButton>
                    </ListItem>
                ))}
            </List>
        </Card>
    );
};

export default AlertsPanel;
