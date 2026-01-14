import { useAuthState } from 'react-firebase-hooks/auth';
import { useDocument } from 'react-firebase-hooks/firestore';
import { doc } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import type { UserRole, UserProfile } from '../types/auth.types';

export const usePermissions = () => {
    const [user, authLoading] = useAuthState(auth);

    // Fetch user profile from 'users' collection
    const [userDoc, userLoading] = useDocument(
        user ? doc(db, 'users', user.uid) : null
    );

    const userProfile = userDoc?.data() as UserProfile | undefined;
    const loading = authLoading || userLoading;

    // Helper to check if user has a specific role or higher
    const hasRole = (role: UserRole | UserRole[]): boolean => {
        if (!userProfile || !userProfile.isActive) return false;

        const targetRoles = Array.isArray(role) ? role : [role];
        return targetRoles.includes(userProfile.role);
    };

    // Permission Matrix
    const permissions = {
        meetings: {
            read: () => true, // Everyone active can read (filtered by role in UI if needed)
            write: () => hasRole(['coordinator']),
            delete: () => hasRole(['coordinator']),
            publish: () => hasRole(['coordinator']),
        },
        minutes: {
            read: () => true,
            write: () => hasRole(['coordinator']),
            approve: () => hasRole(['president', 'elected_official']),
        },
        users: {
            manage: () => hasRole(['coordinator']),
            read: () => hasRole(['coordinator', 'president']),
        },
        documents: {
            read: () => true,
            upload: () => hasRole(['coordinator']),
            delete: () => hasRole(['coordinator']),
        }
    };

    return {
        user,
        userProfile,
        loading,
        hasRole,
        permissions,
        isAuthenticated: !!user && !!userProfile?.isActive,
        isCoordinator: hasRole('coordinator'),
        isPresident: hasRole('president'),
        isElected: hasRole('elected_official'),
        isMember: hasRole('member')
    };
};
