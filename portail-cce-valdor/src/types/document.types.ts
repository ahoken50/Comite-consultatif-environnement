export interface Document {
    id: string;
    name: string;
    type: string; // MIME type or extension
    size: number; // in bytes
    url: string; // Download URL
    storagePath: string; // Path in Firebase Storage
    uploadedBy: string; // User ID
    dateUploaded: string; // ISO string
    linkedEntityId?: string; // ID of project or meeting
    linkedEntityType?: 'project' | 'meeting';
    agendaItemId?: string; // ID of the specific agenda item if applicable
}
