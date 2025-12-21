export const MeetingType = {
    REGULAR: 'regular',
    SPECIAL: 'special',
    URGENT: 'urgent'
} as const;

export type MeetingType = typeof MeetingType[keyof typeof MeetingType];

export const MeetingStatus = {
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
} as const;

export type MeetingStatus = typeof MeetingStatus[keyof typeof MeetingStatus];

export interface AgendaItem {
    id: string;
    order?: number;
    title: string;
    description: string;
    duration: number; // in minutes
    presenter: string;
    objective: string; // e.g., 'Information', 'Décision', 'Consultation'
    agendaNote?: string; // Note for ODJ (what will be discussed/decided) - NEW, separate from PV
    decision?: string; // PV content: actual resolution/decision made during meeting (legacy - kept for backward compatibility)
    linkedProjectId?: string;
    // Legacy minutes fields (kept for backward compatibility)
    minuteType?: 'resolution' | 'comment' | 'other';
    minuteNumber?: string; // e.g. "09-35" or "09-A"
    proposer?: string;
    seconder?: string;
    minuteContent?: string;
    // NEW: Array of resolutions/comments for this agenda item
    // Allows multiple resolutions AND comments per item
    minuteEntries?: MinuteEntry[];
}

// NEW: Interface for individual minute entry (resolution or comment)
export interface MinuteEntry {
    type: 'resolution' | 'comment';
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
    attendees: Attendee[];
    agendaItems: AgendaItem[];
    minutes: string; // HTML content for PV
    minutesFileUrl?: string; // URL of the uploaded signed PV
    minutesFileName?: string; // Name of the uploaded file
    minutesFileStoragePath?: string; // Storage path of the uploaded file
    minutesFileDocumentId?: string; // ID of the document in Documents collection
    // AI Transcription fields
    audioRecording?: AudioRecording;
    minutesDraft?: MinutesDraft;
    dateCreated: string;
    dateUpdated: string;
}
