export type UserRole = 'coordinator' | 'president' | 'elected_official' | 'member';

export interface UserProfile {
    id: string;             // Firebase Auth UID
    uid?: string;           // Alias for id (compatibility)
    email: string;
    displayName?: string;
    role: UserRole;
    memberId?: string;      // ID du membre lié dans la collection 'members'
    isActive: boolean;
    createdAt: string;
    lastLoginAt?: string;
}

export const ROLES: UserRole[] = ['coordinator', 'president', 'elected_official', 'member'];

export const ROLE_LABELS: Record<UserRole, string> = {
    coordinator: 'Coordonnateur (Admin)',
    president: 'Président',
    elected_official: 'Élu Responsable',
    member: 'Membre'
};
