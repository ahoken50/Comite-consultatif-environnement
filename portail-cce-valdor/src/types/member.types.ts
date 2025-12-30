export type MemberRole = 'coordinator' | 'member' | 'observer' | 'elected_official';

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

    // Mandate & HR
    mandateStart?: string; // ISO string
    mandateEnd?: string; // ISO string
    profession?: string; // e.g. "Biologiste"
    expertiseTags?: string[]; // e.g. ["Eau", "Faune", "Urbanisme"]
    appointedByResolution?: string; // Resolution number of appointment

    // Substitute
    isSubstitute?: boolean;
    substituteForMemberId?: string; // ID of the member they substitute for
}

export interface MemberUpdateData {
    displayName?: string;
    photoURL?: string;
    role?: MemberRole;
    phone?: string;
    bio?: string;
    isActive?: boolean;

    // Mandate Support
    mandateStart?: string;
    mandateEnd?: string;
    profession?: string;
    expertiseTags?: string[];
    appointedByResolution?: string;
    isSubstitute?: boolean;
    substituteForMemberId?: string;
}
