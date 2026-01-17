import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types/auth.types';
import { Box, CircularProgress } from '@mui/material';

interface RoleGuardProps {
    allowedRoles: UserRole[];
    redirectPath?: string;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
                <CircularProgress />
            </Box>
        );
    }

    if (!user || !user.role || !allowedRoles.includes(user.role)) {
        return <Navigate to="/access-denied" replace />;
    }

    return <Outlet />;
};
