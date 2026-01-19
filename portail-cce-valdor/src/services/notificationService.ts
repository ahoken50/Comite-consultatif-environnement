/**
 * Notification Service (#6.1)
 * Manages in-app notifications for users
 */

import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    onSnapshot,
    writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import type { Notification } from '../types/notification.types';

const NOTIFICATIONS_COLLECTION = 'notifications';

/**
 * Create a new notification
 */
export const createNotification = async (
    notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>
): Promise<string> => {
    const docRef = await addDoc(collection(db, NOTIFICATIONS_COLLECTION), {
        ...notification,
        isRead: false,
        createdAt: new Date().toISOString()
    });
    return docRef.id;
};

/**
 * Create a mention notification (#6.4)
 */
export const createMentionNotification = async (
    mentionedUserId: string,
    mentionedByUserId: string,
    mentionedByName: string,
    context: {
        type: 'project' | 'meeting';
        entityId: string;
        entityName: string;
        commentPreview: string;
    }
): Promise<string> => {
    return createNotification({
        userId: mentionedUserId,
        type: 'mention',
        title: `${mentionedByName} vous a mentionné`,
        message: `Dans ${context.type === 'project' ? 'le projet' : 'la réunion'} "${context.entityName}": "${context.commentPreview.substring(0, 100)}${context.commentPreview.length > 100 ? '...' : ''}"`,
        link: `/${context.type}s/${context.entityId}`,
        relatedEntityType: context.type,
        relatedEntityId: context.entityId,
        mentionedBy: mentionedByUserId,
        mentionedByName
    });
};

/**
 * Create a meeting reminder notification
 */
export const createMeetingReminder = async (
    userId: string,
    meetingId: string,
    meetingTitle: string,
    daysUntil: number
): Promise<string> => {
    return createNotification({
        userId,
        type: 'meeting_reminder',
        title: 'Réunion à venir',
        message: `${meetingTitle} dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''}`,
        link: `/meetings/${meetingId}`,
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId
    });
};

/**
 * Get unread notifications for a user
 */
export const getUnreadNotifications = async (userId: string): Promise<Notification[]> => {
    const q = query(
        collection(db, NOTIFICATIONS_COLLECTION),
        where('userId', '==', userId),
        where('isRead', '==', false),
        orderBy('createdAt', 'desc'),
        limit(50)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as Notification));
};

/**
 * Get all recent notifications for a user
 */
export const getRecentNotifications = async (
    userId: string,
    maxCount: number = 20
): Promise<Notification[]> => {
    const q = query(
        collection(db, NOTIFICATIONS_COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(maxCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as Notification));
};

/**
 * Mark a notification as read
 */
export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
    await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId), {
        isRead: true,
        readAt: new Date().toISOString()
    });
};

/**
 * Mark all notifications as read for a user
 */
export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
    const unread = await getUnreadNotifications(userId);
    const batch = writeBatch(db);

    unread.forEach(notification => {
        batch.update(doc(db, NOTIFICATIONS_COLLECTION, notification.id), {
            isRead: true,
            readAt: new Date().toISOString()
        });
    });

    await batch.commit();
};

/**
 * Subscribe to real-time notification updates
 */
export const subscribeToNotifications = (
    userId: string,
    callback: (notifications: Notification[]) => void
): (() => void) => {
    const q = query(
        collection(db, NOTIFICATIONS_COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(20)
    );

    return onSnapshot(q, (snapshot) => {
        const notifications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Notification));
        callback(notifications);
    });
};

/**
 * Get unread count for badge
 */
export const getUnreadCount = async (userId: string): Promise<number> => {
    const unread = await getUnreadNotifications(userId);
    return unread.length;
};
