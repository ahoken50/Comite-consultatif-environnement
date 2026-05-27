import React, { useState, useEffect } from 'react';
import { AppBar, Toolbar, Typography, IconButton, Avatar, Menu, MenuItem, Box, Badge, Popover, Chip } from '@mui/material';
import { Menu as MenuIcon, Notifications, AccountCircle, WifiOff } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { signOut } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { logout } from '../../features/auth/authSlice';
import type { RootState } from '../../store/rootReducer';
import logo from '../../assets/logo-valdor.png';
import GlobalSearch from '../common/GlobalSearch';
import NotificationCenter from '../common/NotificationCenter';
import { subscribeToNotifications } from '../../services/notificationService';
import type { Notification } from '../../types/notification.types';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
    onMenuClick: () => void;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick }) => {
    const { user } = useSelector((state: RootState) => state.auth);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [notificationAnchorEl, setNotificationAnchorEl] = useState<null | HTMLElement>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // Track online/offline status
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Subscribe to real-time notifications
    useEffect(() => {
        const userId = user?.id || user?.uid;
        if (!userId) return;

        const unsubscribe = subscribeToNotifications(userId, (notifications: Notification[]) => {
            const unread = notifications.filter(n => !n.isRead).length;
            setUnreadCount(unread);
        });

        return () => unsubscribe();
    }, [user]);

    const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleNotificationClick = (event: React.MouseEvent<HTMLElement>) => {
        setNotificationAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleProfile = () => {
        handleClose();
        navigate('/profile');
    };

    const handleNotificationClose = () => {
        setNotificationAnchorEl(null);
    };

    const handleLogout = async () => {
        handleClose();
        await signOut(auth);
        dispatch(logout());
    };

    return (
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
            <Toolbar>
                <IconButton
                    color="inherit"
                    aria-label="open drawer"
                    edge="start"
                    onClick={onMenuClick}
                    sx={{ mr: 2, display: { sm: 'none' } }}
                >
                    <MenuIcon />
                </IconButton>

                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <img src={logo} alt="Val-d'Or" style={{ height: 40, marginRight: 16 }} />
                    <Typography variant="h6" noWrap component="div" sx={{ display: { xs: 'none', sm: 'block' }, color: 'text.primary', fontWeight: 600 }}>
                        Portail CCE
                    </Typography>
                </Box>

                <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', mx: 2 }}>
                    <GlobalSearch />
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {!isOnline && (
                        <Chip
                            icon={<WifiOff sx={{ color: 'amber.main !important' }} />}
                            label="Hors-ligne"
                            variant="outlined"
                            color="warning"
                            size="small"
                            sx={{
                                fontWeight: 500,
                                borderColor: 'warning.main',
                                color: 'warning.main',
                                bgcolor: 'rgba(237, 108, 2, 0.08)',
                            }}
                        />
                    )}

                    <IconButton
                        aria-label="Afficher les notifications"
                        color="inherit"
                        size="large"
                        onClick={handleNotificationClick}
                    >
                        <Badge badgeContent={unreadCount} color="error">
                            <Notifications />
                        </Badge>
                    </IconButton>

                    <Popover
                        open={Boolean(notificationAnchorEl)}
                        anchorEl={notificationAnchorEl}
                        onClose={handleNotificationClose}
                        anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'right',
                        }}
                        transformOrigin={{
                            vertical: 'top',
                            horizontal: 'right',
                        }}
                    >
                        <NotificationCenter onClose={handleNotificationClose} />
                    </Popover>

                    <IconButton
                        size="large"
                        aria-label="account of current user"
                        aria-controls="menu-appbar"
                        aria-haspopup="true"
                        onClick={handleMenu}
                        color="inherit"
                    >
                        {user?.photoURL ? (
                            <Avatar src={user.photoURL} alt={user.displayName || 'User'} sx={{ width: 32, height: 32 }} />
                        ) : (
                            <AccountCircle />
                        )}
                    </IconButton>

                    <Menu
                        id="menu-appbar"
                        anchorEl={anchorEl}
                        anchorOrigin={{
                            vertical: 'top',
                            horizontal: 'right',
                        }}
                        keepMounted
                        transformOrigin={{
                            vertical: 'top',
                            horizontal: 'right',
                        }}
                        open={Boolean(anchorEl)}
                        onClose={handleClose}
                    >
                        <MenuItem onClick={handleProfile}>Mon profil</MenuItem>
                        <MenuItem onClick={handleLogout}>Se déconnecter</MenuItem>
                    </Menu>
                </Box>
            </Toolbar>
        </AppBar>
    );
};

export default Header;

