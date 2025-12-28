import React from 'react';
import { Card, CardHeader, List, ListItem, ListItemAvatar, ListItemText, Avatar, Typography, Box, ListItemButton } from '@mui/material';
import {
    Add,
    Edit,
    CheckCircle,
    Delete,
    UploadFile,
    PersonAdd,
    Mic,
    Description
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import type { ActivityLog, ActivityType } from '../../types/activityLog.types';
import { ActivityTypeLabels } from '../../types/activityLog.types';

interface ActivityFeedProps {
    activities: ActivityLog[];
}

// Map activity type to icon and color
const getActivityIcon = (type: ActivityType): { icon: React.ReactElement; color: string } => {
    switch (type) {
        case 'project_created':
        case 'meeting_created':
            return { icon: <Add />, color: '#22c55e' };
        case 'project_updated':
        case 'meeting_updated':
        case 'member_updated':
            return { icon: <Edit />, color: '#3b82f6' };
        case 'project_completed':
        case 'meeting_completed':
            return { icon: <CheckCircle />, color: '#059669' };
        case 'project_deleted':
        case 'document_deleted':
            return { icon: <Delete />, color: '#ef4444' };
        case 'document_uploaded':
            return { icon: <UploadFile />, color: '#8b5cf6' };
        case 'member_joined':
            return { icon: <PersonAdd />, color: '#06b6d4' };
        case 'transcription_completed':
            return { icon: <Mic />, color: '#f97316' };
        case 'minutes_generated':
            return { icon: <Description />, color: '#eab308' };
        default:
            return { icon: <Edit />, color: '#64748b' };
    }
};

const ActivityFeed: React.FC<ActivityFeedProps> = ({ activities }) => {
    const navigate = useNavigate();

    const handleActivityClick = (activity: ActivityLog) => {
        switch (activity.targetType) {
            case 'project':
                navigate(`/projects/${activity.targetId}`);
                break;
            case 'meeting':
                navigate(`/meetings/${activity.targetId}`);
                break;
            case 'document':
                navigate('/documents');
                break;
            case 'member':
                navigate('/members');
                break;
        }
    };

    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Activité récente" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <List>
                {activities.length === 0 ? (
                    <ListItem>
                        <ListItemText
                            primary={
                                <Typography variant="body2" color="text.secondary" align="center">
                                    Aucune activité récente
                                </Typography>
                            }
                            secondary={
                                <Typography variant="caption" color="text.disabled" align="center" component="p">
                                    Les actions effectuées apparaîtront ici
                                </Typography>
                            }
                        />
                    </ListItem>
                ) : (
                    activities.map((activity, index) => {
                        const { icon, color } = getActivityIcon(activity.type);
                        const timeAgo = formatDistanceToNow(new Date(activity.timestamp), {
                            addSuffix: true,
                            locale: fr
                        });

                        return (
                            <ListItem
                                key={activity.id}
                                divider={index < activities.length - 1}
                                disablePadding
                            >
                                <ListItemButton onClick={() => handleActivityClick(activity)}>
                                    <ListItemAvatar>
                                        <Avatar sx={{ bgcolor: 'transparent', color }}>
                                            {icon}
                                        </Avatar>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={
                                            <Typography variant="body2">
                                                <Box component="span" sx={{ fontWeight: 600 }}>
                                                    {activity.userName}
                                                </Box>{' '}
                                                {ActivityTypeLabels[activity.type]}{' '}
                                                <Box component="span" sx={{ fontWeight: 600, color: 'primary.main' }}>
                                                    {activity.targetName}
                                                </Box>
                                            </Typography>
                                        }
                                        secondary={timeAgo}
                                    />
                                </ListItemButton>
                            </ListItem>
                        );
                    })
                )}
            </List>
        </Card>
    );
};

export default ActivityFeed;
