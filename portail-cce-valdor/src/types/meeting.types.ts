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
    order: number;
    title: string;
    description: string;
    duration: number; // in minutes
    presenter: string;
    linkedProjectId?: string;
}

export interface Attendee {
    id: string;
    name: string;
    role: string;
    isPresent: boolean;
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
    dateCreated: string;
    dateUpdated: string;
}
