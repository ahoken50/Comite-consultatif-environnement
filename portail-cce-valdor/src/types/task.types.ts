export const TaskStatus = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed'
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export interface ProjectTask {
    id: string;
    projectId: string;
    description: string;
    status: TaskStatus;
    assigneeId?: string; // Member ID
    dueDate?: string; // ISO Date
    
    // Explicit links to CCE Decisions (Couche Exécution)
    sourceMeetingId?: string; // ID of the meeting where this task was decided
    sourceAgendaItemId?: string; // ID of the agenda item
    sourceMinuteEntryOrder?: string; // Number/Order of the resolution (e.g., "12-A")
    
    dateCreated: string;
    dateCompleted?: string;
    createdBy: string;
}
