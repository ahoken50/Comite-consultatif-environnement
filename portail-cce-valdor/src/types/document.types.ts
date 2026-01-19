export type DocumentCategory =
    | 'pv'              // Procès-verbal
    | 'resolution'      // Resolution
    | 'odj'             // Ordre du jour
    | 'presentation'    // Presentation
    | 'report'          // Report
    | 'annexe'          // Annexe/Attachment
    | 'permit'          // Permit or certificate
    | 'contract'        // Contract
    | 'other';          // Other

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

    // #4.1 Versioning
    version?: number;                    // Current version number
    previousVersionId?: string;          // Link to previous version
    versionHistory?: DocumentVersion[];  // Array of all versions

    // #4.3 OCR Content for search
    ocrContent?: string;                 // Extracted text content
    ocrProcessedAt?: string;             // When OCR was performed

    // #4.4 Auto-categorization
    category?: DocumentCategory;         // Document category
    categoryConfidence?: number;         // AI confidence (0-1)

    // #4.7 Expiration management
    expirationDate?: string;             // ISO string, when doc expires
    expirationAlertSent?: boolean;       // Alert already sent?

    // General enhancements
    isFavorite?: boolean;                // User favorites
    tags?: string[];                     // Searchable tags
}

/**
 * Version history entry for document versioning (#4.1)
 */
export interface DocumentVersion {
    versionNumber: number;
    documentId: string;                  // ID of this version's document
    url: string;                         // Download URL of this version
    uploadedBy: string;
    uploadedAt: string;
    changeNote?: string;                 // What changed in this version
}

