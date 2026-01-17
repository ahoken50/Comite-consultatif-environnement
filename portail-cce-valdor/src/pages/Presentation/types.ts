export interface Attachment {
    id: string;
    name: string;
    url: string;
    type: 'pdf' | 'image' | 'link';
    pageCount?: number;
}

export interface AgendaItem {
    id: string;
    title: string;
    description: string;
    presenter: string;
    durationInMinutes: number;
    attachments: Attachment[];
}

export interface PresentationMeeting {
    id: string;
    title: string;
    date: string;
    agenda: AgendaItem[];
}

export interface Note {
    agendaItemId: string;
    content: string;
    timestamp: number;
}
