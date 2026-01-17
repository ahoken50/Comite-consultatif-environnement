import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types/auth.types';

interface AccessControlProps {
    allowedRoles: UserRole[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

/**
 * AccessControl - Helper component to conditionally render content based on user roles.
 * 
 * @param allowedRoles List of roles that can access the content.
 * @param children Content to render if access is granted.
 * @param fallback Content to render if access is denied (default: null).
 */
import { Alert } from '@mui/material';

export const AccessControl: React.FC<AccessControlProps> = ({ allowedRoles, children, fallback }) => {
    const { user } = useAuth();

    // Default fallback if none provided
    const defaultFallback = (
        <Alert severity="warning" sx={{ my: 1 }}>
            Contenu restreint aux rôles autorisés.
        </Alert>
    );

    const actualFallback = fallback !== undefined ? fallback : defaultFallback;

    if (!user || !user.role) {
        return <>{actualFallback}</>;
    }

    if (allowedRoles.includes(user.role)) {
        return <>{children}</>;
    }

    return <>{actualFallback}</>;
};
