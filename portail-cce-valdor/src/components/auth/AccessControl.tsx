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
export const AccessControl: React.FC<AccessControlProps> = ({ allowedRoles, children, fallback = null }) => {
    const { user } = useAuth();

    if (!user || !user.role) {
        return <>{fallback}</>;
    }

    if (allowedRoles.includes(user.role)) {
        return <>{children}</>;
    }

    return <>{fallback}</>;
};
