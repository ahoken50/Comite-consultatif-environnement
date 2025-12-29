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
    dateCreated: string;
    dateCompleted?: string;
    createdBy: string;
}
