/**
 * Activity Log Types
 * Used for tracking user actions across the application
 */

export type ActivityType =
    | 'project_created'
    | 'project_updated'
    | 'project_completed'
    | 'project_deleted'
    | 'meeting_created'
    | 'meeting_updated'
    | 'meeting_completed'
    | 'document_uploaded'
    | 'document_deleted'
    | 'member_joined'
    | 'member_updated'
    | 'transcription_completed'
    | 'minutes_generated'
    | 'task_created'
    | 'task_updated'
    | 'task_completed'
    | 'task_deleted';

export interface ActivityLog {
    id: string;
    type: ActivityType;
    userId: string;
    userName: string;
    targetId: string;      // ID of the affected entity (project, meeting, etc.)
    targetName: string;    // Name/title of the affected entity
    targetType: 'project' | 'meeting' | 'document' | 'member' | 'task';
    details?: string;      // Optional additional details
    timestamp: string;     // ISO string
}

// French labels for activity types
export const ActivityTypeLabels: Record<ActivityType, string> = {
    project_created: 'a créé le projet',
    project_updated: 'a mis à jour le projet',
    project_completed: 'a complété le projet',
    project_deleted: 'a supprimé le projet',
    meeting_created: 'a créé la réunion',
    meeting_updated: 'a mis à jour la réunion',
    meeting_completed: 'a complété la réunion',
    document_uploaded: 'a téléversé le document',
    document_deleted: 'a supprimé le document',
    member_joined: 'a rejoint le comité',
    member_updated: 'a mis à jour le profil de',
    transcription_completed: 'a transcrit l\'enregistrement de',
    minutes_generated: 'a généré le PV de',
    task_created: 'a ajouté une tâche à',
    task_updated: 'a mis à jour une tâche de',
    task_completed: 'a complété une tâche de',
    task_deleted: 'a supprimé une tâche de'
};
