export const ProjectStatus = {
    COMPLETED: 'completed',
    IN_PROGRESS: 'in_progress',
    PENDING: 'pending',
    BLOCKED: 'blocked',
    FINANCING_RECEIVED: 'financing_received',
    TO_CLARIFY: 'to_clarify'
} as const;

export type ProjectStatus = typeof ProjectStatus[keyof typeof ProjectStatus];

export const Priority = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
} as const;

export type Priority = typeof Priority[keyof typeof Priority];

export const Category = {
    WATER: 'water',
    BIODIVERSITY: 'biodiversity',
    REGULATION: 'regulation',
    WASTE: 'waste',
    EMERGENCY: 'emergency',
    INNOVATION: 'innovation',
    OPERATIONS: 'operations',
    CLIMATE: 'climate'
} as const;

export type Category = typeof Category[keyof typeof Category];

/**
 * Represents a link between a project and a resolution/comment from a CCE meeting.
 * Allows tracking follow-up resolutions across multiple meetings for the same project.
 */
export interface LinkedResolution {
    id: string;                              // Unique ID for this link
    meetingId: string;                       // Source meeting ID
    meetingTitle: string;                    // Meeting title (e.g., "CCE 13")
    meetingDate: string;                     // Meeting date ISO string
    agendaItemId: string;                    // Agenda item ID
    agendaItemTitle: string;                 // Agenda item title
    entryIndex: number;                      // Index in minuteEntries array
    entryType: 'resolution' | 'comment';     // Type of entry
    entryNumber: string;                     // Number (e.g., "13-A")
    entryContent: string;                    // Content preview (first 200 chars)
    linkedAt: string;                        // When the link was created
    linkedBy: string;                        // User ID who created the link
}

/**
 * Represents a dependency between two projects.
 * Allows tracking blocking relationships (e.g., "Project A cannot start until Project B is completed").
 */
export interface ProjectDependency {
    id: string;                              // Unique ID for this dependency
    dependsOnProjectId: string;              // ID of the project this depends on
    dependsOnProjectCode: string;            // Code of the dependency project (e.g., "EC-01")
    dependsOnProjectName: string;            // Name of the dependency project
    dependencyType: 'blocks' | 'requires' | 'related'; // Type of dependency
    createdAt: string;                       // When the link was created
    createdBy: string;                       // User ID who created the link
}

export interface Project {
    id: string;
    code: string;
    name: string;
    status: ProjectStatus;
    priority: Priority;
    category: string;
    resolutionCCE: string | null;
    dateCreated: string; // Serialized Timestamp
    dateUpdated: string; // Serialized Timestamp
    dateCompleted: string | null;
    coordinatorId: string;
    description: string;
    currentDetails: string;
    nextSteps: string;
    linkedMeetingIds: string[];
    linkedDocumentIds: string[];
    linkedResolutions?: LinkedResolution[];  // New: array of linked resolutions
    linkedResolutionIds: string[];           // Legacy: kept for backward compatibility
    linkedRegulationIds?: string[];          // New: array of linked regulation IDs from Typesense
    tags: string[];
    isUrgent: boolean;
    estimatedCompletionDate: string | null;
    completionPercentage: number;
    createdBy: string;
    updatedBy: string;
    comments?: Comment[];
    startDate?: string; // ISO Date
    caucusDecisions?: CaucusDecision[];
    // #2.7 Dependencies between projects
    dependencies?: ProjectDependency[];
    // #11.1 AI-generated executive summary (Groq)
    aiSummary?: string;
    aiSummaryGeneratedAt?: string;
}

export interface Comment {
    id: string;
    userId: string;
    userName: string;
    content: string;
    createdAt: string; // ISO string
}

export interface CaucusDecision {
    id: string;
    date: string;
    description: string;
    fileUrl?: string;
    fileName?: string;
    createdBy: string;
}
