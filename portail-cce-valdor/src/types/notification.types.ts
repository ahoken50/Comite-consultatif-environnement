/**
 * Notification Types
 * For in-app notification center (#6.1)
 */

export type NotificationType =
    | 'mention'           // @mention in comments
    | 'meeting_reminder'  // Upcoming meeting
    | 'deadline'          // Project deadline approaching
    | 'approval_request'  // PV needs approval
    | 'document_expiring' // Document expiration alert
    | 'project_update'    // Project status changed
    | 'system';           // System announcements

export interface Notification {
    id: string;
    userId: string;                  // Recipient user ID
    type: NotificationType;
    title: string;                   // Short title
    message: string;                 // Detailed message
    link?: string;                   // Internal link (e.g., "/projects/abc123")
    relatedEntityType?: 'project' | 'meeting' | 'document' | 'member';
    relatedEntityId?: string;
    isRead: boolean;
    readAt?: string;                 // ISO string when marked as read
    createdAt: string;               // ISO string
    expiresAt?: string;              // Optional auto-expire date

    // For mentions
    mentionedBy?: string;            // User ID who mentioned
    mentionedByName?: string;        // Display name of mentioner
}

export interface NotificationPreferences {
    emailNotifications: boolean;
    meetingReminders: boolean;
    projectUpdates: boolean;
    commentReplies: boolean;
    weeklyDigest: boolean;
    mentionNotifications: boolean;   // #6.4 Mention notifications
}

/**
 * Session Types
 * For session management (#10.2)
 */
export interface UserSession {
    id: string;
    userId: string;
    deviceInfo: {
        browser: string;
        os: string;
        device: string;
    };
    ipAddress?: string;
    location?: string;               // Approximate location (city/country)
    createdAt: string;               // Session start
    lastActiveAt: string;            // Last activity
    isCurrent: boolean;              // Is this the current session
}
