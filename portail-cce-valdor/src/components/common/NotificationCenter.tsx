import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    ListItemButton,
    Divider,
    Button,
    Badge,
    CircularProgress
} from '@mui/material';
import {
    AlternateEmail,
    Event,
    Assignment,
    Description,
    Notifications as NotifIcon,
    CheckCircle,
    MarkEmailRead
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import type { Notification, NotificationType } from '../../types/notification.types';
import {
    subscribeToNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead
} from '../../services/notificationService';
import { safeDate } from '../../utils/dateUtils';

interface NotificationCenterProps {
    onClose?: () => void;
}

/**
 * Notification Center Component (#6.1)
 * Displays a list of notifications with mark-as-read functionality
 */
const NotificationCenter: React.FC<NotificationCenterProps> = ({ onClose }) => {
    const navigate = useNavigate();
    const { user } = useSelector((state: RootState) => state.auth);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const userId = user?.id || user?.uid;
        if (!userId) {
            setLoading(false);
            return;
        }

        setLoading(true);

        const unsubscribe = subscribeToNotifications(userId, (notifs) => {
            setNotifications(notifs);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleNotificationClick = async (notification: Notification) => {
        // Mark as read
        if (!notification.isRead) {
            await markNotificationAsRead(notification.id);
        }

        // Navigate if there's a link
        if (notification.link) {
            navigate(notification.link);
            onClose?.();
        }
    };

    const handleMarkAllAsRead = async () => {
        const userId = user?.id || user?.uid;
        if (userId) {
            await markAllNotificationsAsRead(userId);
        }
    };

    const getNotificationIcon = (type: NotificationType) => {
        switch (type) {
            case 'mention':
                return <AlternateEmail color="primary" />;
            case 'meeting_reminder':
                return <Event color="info" />;
            case 'deadline':
                return <Assignment color="warning" />;
            case 'approval_request':
                return <CheckCircle color="success" />;
            case 'document_expiring':
                return <Description color="error" />;
            case 'project_update':
                return <Assignment color="primary" />;
            default:
                return <NotifIcon color="action" />;
        }
    };

    const unreadCount = notifications.filter(n => !n.isRead).length;

    if (loading) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <CircularProgress size={24} />
            </Box>
        );
    }

    return (
        <Box sx={{ width: 360, maxHeight: 480, overflow: 'auto' }}>
            <Box sx={{
                p: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: 1,
                borderColor: 'divider'
            }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Notifications
                </Typography>
                {unreadCount > 0 && (
                    <Button
                        size="small"
                        startIcon={<MarkEmailRead />}
                        onClick={handleMarkAllAsRead}
                    >
                        Tout marquer lu
                    </Button>
                )}
            </Box>

            {notifications.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                    <NotifIcon color="disabled" sx={{ fontSize: 48, mb: 1 }} />
                    <Typography color="text.secondary" variant="body2">
                        Aucune notification
                    </Typography>
                </Box>
            ) : (
                <List dense sx={{ py: 0 }}>
                    {notifications.map((notification, index) => (
                        <React.Fragment key={notification.id}>
                            {index > 0 && <Divider />}
                            <ListItem
                                disablePadding
                                sx={{
                                    bgcolor: notification.isRead ? 'transparent' : 'action.hover'
                                }}
                            >
                                <ListItemButton
                                    onClick={() => handleNotificationClick(notification)}
                                    sx={{ py: 1.5 }}
                                >
                                    <ListItemIcon sx={{ minWidth: 40 }}>
                                        <Badge
                                            variant="dot"
                                            color="primary"
                                            invisible={notification.isRead}
                                        >
                                            {getNotificationIcon(notification.type)}
                                        </Badge>
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    fontWeight: notification.isRead ? 400 : 600,
                                                    mb: 0.5
                                                }}
                                            >
                                                {notification.title}
                                            </Typography>
                                        }
                                        secondary={
                                            <Box>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{
                                                        display: 'block',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {notification.message}
                                                </Typography>
                                                <Typography
                                                    variant="caption"
                                                    color="text.disabled"
                                                    sx={{ mt: 0.5, display: 'block' }}
                                                >
                                                    {formatDistanceToNow(safeDate(notification.createdAt) || new Date(), {
                                                        addSuffix: true,
                                                        locale: fr
                                                    })}
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                </ListItemButton>
                            </ListItem>
                        </React.Fragment>
                    ))}
                </List>
            )}
        </Box>
    );
};

export default NotificationCenter;
