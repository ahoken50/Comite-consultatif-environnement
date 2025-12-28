import React from 'react';
import { Card, CardHeader, List, ListItem, ListItemButton, ListItemText, Chip, Box, Typography } from '@mui/material';
import { Warning } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface Alert {
    id: string;
    code: string;
    title: string;
    status: 'blocked' | 'urgent';
    label: string;
}

interface AlertsPanelProps {
    alerts: Alert[];
}

const AlertsPanel: React.FC<AlertsPanelProps> = ({ alerts }) => {
    const navigate = useNavigate();

    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader
                title={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Warning color="error" />
                        <Typography variant="h6">Alertes Critiques</Typography>
                        {alerts.length > 0 && (
                            <Chip
                                label={alerts.length}
                                size="small"
                                color="error"
                                sx={{ ml: 1 }}
                            />
                        )}
                    </Box>
                }
                sx={{ borderBottom: 1, borderColor: 'divider', py: 2 }}
            />
            <List disablePadding>
                {alerts.length === 0 ? (
                    <ListItem>
                        <ListItemText
                            primary={
                                <Typography variant="body2" color="text.secondary" align="center">
                                    ✅ Aucune alerte critique
                                </Typography>
                            }
                        />
                    </ListItem>
                ) : (
                    alerts.map((alert) => (
                        <ListItem
                            key={alert.id}
                            divider
                            disablePadding
                        >
                            <ListItemButton
                                sx={{ py: 2 }}
                                onClick={() => navigate(`/projects/${alert.id}`)}
                            >
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
                    ))
                )}
            </List>
        </Card>
    );
};

export default AlertsPanel;
