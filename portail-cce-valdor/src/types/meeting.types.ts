export const MeetingType = {
    REGULAR: 'regular',
    SPECIAL: 'special',
    URGENT: 'urgent',
    CIRCULAR: 'circular'
} as const;

export type MeetingType = typeof MeetingType[keyof typeof MeetingType];

export const MeetingStatus = {
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
} as const;

export type MeetingStatus = typeof MeetingStatus[keyof typeof MeetingStatus];

export interface AudioSegment {
    start: number;       // elapsed seconds from recording start
    end?: number;        // end second of this topic
    audioUrl?: string;   // specific audio recording url if multiple files
}

export interface AgendaItem {
    id: string;
    order?: number;
    title: string;
    description: string;
    duration: number; // in minutes
    actualDuration?: number; // in seconds, tracked during presentation
    presenter: string;
    objective: string; // e.g., 'Information', 'Décision', 'Consultation'
    agendaNote?: string; // Note for ODJ (what will be discussed/decided) - NEW, separate from PV
    decision?: string; // PV content: actual resolution/decision made during meeting (legacy - kept for backward compatibility)
    linkedProjectId?: string;
    // Legacy minutes fields (kept for backward compatibility)
    minuteType?: 'resolution' | 'comment' | 'note' | 'other';
    minuteNumber?: string; // e.g. "09-35" or "09-A"
    proposer?: string;
    seconder?: string;
    minuteContent?: string;
    // NEW: Array of resolutions/comments for this agenda item
    // Allows multiple resolutions AND comments per item
    minuteEntries?: MinuteEntry[];
    // NEW: Council Recommendation settings
    isRecommendationToCouncil?: boolean;
    councilIncludedEntryIndices?: number[]; // indices of `minuteEntries` to include. If undefined, all are included.
    audioSegment?: AudioSegment; // NEW: Audio division by subject segment
}

// NEW: Interface for individual minute entry (resolution or comment)
export interface MinuteEntry {
    type: 'resolution' | 'comment' | 'note';
    number: string;      // e.g., "09-35" or "09-A"
    content: string;     // The decision/comment text (CONSIDÉRANT, IL EST RÉSOLU, etc.)
    proposer?: string;
    seconder?: string;
}

export interface Attendee {
    id: string;
    name: string;
    role: string;
    isPresent: boolean;
}

// Audio recording for AI transcription
export interface AudioRecording {
    fileUrl: string;
    fileName: string;
    storagePath: string;
    fileSize: number; // bytes
    duration: number; // seconds
    mimeType: string;
    uploadedAt: string; // ISO string
    transcription?: string;
    transcriptionStatus: 'pending' | 'processing' | 'completed' | 'error';
    transcriptionError?: string;
    transcribedAt?: string; // ISO string
    speakerMapping?: Record<string, string>;
}


// AI-generated minutes draft
export interface MinutesDraft {
    content: string;
    generatedAt: string; // ISO string
    status: 'draft' | 'reviewed' | 'final';
    version: number;
    userFeedback?: string;
    finalizedAt?: string; // ISO string
}

export interface Meeting {
    id: string;
    title: string;
    date: string; // ISO string
    location: string;
    type: MeetingType;
    status: MeetingStatus;

    // Meeting sequence number for resolution/comment numbering (e.g., 10, 11, 12)
    meetingNumber?: number;

    // Privacy & Access
    isConfidential?: boolean; // Huis clos vs Public

    attendees: Attendee[]; // Actual attendance (during meeting)
    agendaItems: AgendaItem[];

    // RSVP & Quorum
    rsvps?: MeetingRSVP[];
    quorumRequired?: number;
    projectedQuorum?: number; // Calculated from RSVPs

    minutes: string; // HTML content for PV
    minutesFileUrl?: string; // URL of the uploaded signed PV
    minutesFileName?: string; // Name of the uploaded file
    minutesFileStoragePath?: string; // Storage path of the uploaded file
    minutesFileDocumentId?: string; // ID of the document in Documents collection

    // AI Transcription fields
    audioRecording?: AudioRecording; // Legacy (single)
    audioRecordings?: AudioRecording[]; // New (multiple)
    minutesDraft?: MinutesDraft;

    // PV Approval Flow
    approvalStatus?: 'draft' | 'waiting_approval' | 'approved' | 'final';
    approvalSignatures?: ApprovalSignature[];
    isApprovalAvailable?: boolean; // Controls if non-coordinators can see/use sign buttons
    consignedMeetingId?: string; // ID of the regular meeting where this circular meeting was consigned

    dateCreated: string;
    dateUpdated: string;
}

export interface ApprovalSignature {
    role: 'president' | 'elected_official' | 'coordinator' | 'admin_bypass' | 'member' | 'vice_president';
    signedBy: string; // User ID
    signedByName: string;
    signedAt: string; // ISO string
    consentType?: 'digital' | 'email';
    emailConsentText?: string;
}

// RSVP and Quorum types
export type RSVPStatus = 'present' | 'absent' | 'uncertain' | 'pending';

export interface MeetingRSVP {
    userId: string;
    status: RSVPStatus;
    reason?: string; // If absent
    updatedAt: string;
}

