export type MemberRole = 'coordinator' | 'member' | 'observer';

export interface Member {
    id: string; // Corresponds to Firebase Auth UID
    displayName: string;
    email: string;
    photoURL?: string;
    role: MemberRole;
    phone?: string;
    bio?: string;
    dateJoined: string; // ISO string
    isActive: boolean;
}

export interface MemberUpdateData {
    displayName?: string;
    photoURL?: string;
    role?: MemberRole;
    phone?: string;
    bio?: string;
    isActive?: boolean;
}
