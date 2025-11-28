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

export interface Project {
    id: string;
    code: string;
    name: string;
    status: ProjectStatus;
    priority: Priority;
    category: Category;
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
    linkedResolutionIds: string[];
    tags: string[];
    isUrgent: boolean;
    estimatedCompletionDate: string | null;
    completionPercentage: number;
    createdBy: string;
    updatedBy: string;
}
