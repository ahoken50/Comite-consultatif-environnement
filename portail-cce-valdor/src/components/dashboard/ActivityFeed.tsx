import React from 'react';
import { Card, CardHeader, List, ListItem, ListItemAvatar, ListItemText, Avatar, Typography, Box } from '@mui/material';

const activities: Array<{ id: number; user: string; action: string; target: string; time: string; icon: React.ReactElement; color: string }> = [];

const ActivityFeed: React.FC = () => {
    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Activité récente" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <List>
                {activities.length === 0 ? (
                    <ListItem>
                        <ListItemText
                            primary={<Typography variant="body2" color="text.secondary" align="center">Aucune activité récente</Typography>}
                        />
                    </ListItem>
                ) : (
                    activities.map((activity, index) => (
                        <ListItem key={activity.id} divider={index < activities.length - 1}>
                            <ListItemAvatar>
                                <Avatar sx={{ bgcolor: 'transparent', color: activity.color }}>
                                    {activity.icon}
                                </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                                primary={
                                    <Typography variant="body2">
                                        <Box component="span" sx={{ fontWeight: 600 }}>{activity.user}</Box> {activity.action} <Box component="span" sx={{ fontWeight: 600, color: 'primary.main' }}>{activity.target}</Box>
                                    </Typography>
                                }
                                secondary={activity.time}
                            />
                        </ListItem>
                    ))
                )}
            </List>
        </Card>
    );
};

export default ActivityFeed;
