import {
    collection,
    addDoc,
    getDocs,
    query,
    orderBy,
    limit,
    Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type { ActivityLog, ActivityType } from '../types/activityLog.types';

const COLLECTION_NAME = 'activity_log';

/**
 * Log a user activity
 */
export const logActivity = async (
    type: ActivityType,
    userId: string,
    userName: string,
    targetId: string,
    targetName: string,
    targetType: 'project' | 'meeting' | 'document' | 'member' | 'task',
    details?: string
): Promise<void> => {
    try {
        await addDoc(collection(db, COLLECTION_NAME), {
            type,
            userId,
            userName,
            targetId,
            targetName,
            targetType,
            details: details || null,
            timestamp: Timestamp.now()
        });
    } catch (error) {
        // Log error but don't throw - activity logging should not break main functionality
        console.error('Failed to log activity:', error);
    }
};

/**
 * Get recent activities
 */
export const getRecentActivities = async (maxCount: number = 10): Promise<ActivityLog[]> => {
    const q = query(
        collection(db, COLLECTION_NAME),
        orderBy('timestamp', 'desc'),
        limit(maxCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate
            ? doc.data().timestamp.toDate().toISOString()
            : doc.data().timestamp
    } as ActivityLog));
};

/**
 * Helper to log project activities
 */
export const logProjectActivity = (
    type: ActivityType,
    userId: string,
    userName: string,
    projectId: string,
    projectName: string
) => logActivity(type, userId, userName, projectId, projectName, 'project');

/**
 * Helper to log meeting activities
 */
export const logMeetingActivity = (
    type: 'meeting_created' | 'meeting_updated' | 'meeting_completed' | 'transcription_completed' | 'minutes_generated',
    userId: string,
    userName: string,
    meetingId: string,
    meetingTitle: string
) => logActivity(type, userId, userName, meetingId, meetingTitle, 'meeting');

/**
 * Helper to log document activities
 */
export const logDocumentActivity = (
    type: 'document_uploaded' | 'document_deleted',
    userId: string,
    userName: string,
    documentId: string,
    documentName: string
) => logActivity(type, userId, userName, documentId, documentName, 'document');

/**
 * Helper to log task activities
 */
export const logTaskActivity = (
    type: 'task_created' | 'task_updated' | 'task_completed' | 'task_deleted'
        | 'comment_added',
    userId: string,
    userName: string,
    taskId: string,
    taskTitle: string
) => logActivity(type, userId, userName, taskId, taskTitle, 'task');
