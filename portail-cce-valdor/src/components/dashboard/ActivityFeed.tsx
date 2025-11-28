import React from 'react';
import { Card, CardHeader, List, ListItem, ListItemAvatar, ListItemText, Avatar, Typography, Box } from '@mui/material';
import { Comment, Add, CheckCircle } from '@mui/icons-material';

const activities = [
    { id: 1, user: 'Patricia', action: 'a commenté', target: 'Apiculture urbaine', time: 'Il y a 2h', icon: <Comment />, color: 'info.main' },
    { id: 2, user: 'Système', action: 'Document ajouté', target: 'PV-14.pdf', time: 'Il y a 4h', icon: <Add />, color: 'success.main' },
    { id: 3, user: 'Michaël', action: 'Statut changé', target: 'Panneaux solaires', time: 'Il y a 1j', icon: <CheckCircle />, color: 'primary.main' },
];

const ActivityFeed: React.FC = () => {
    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Activité récente" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <List>
                {activities.map((activity, index) => (
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
                ))}
            </List>
        </Card>
    );
};

export default ActivityFeed;
