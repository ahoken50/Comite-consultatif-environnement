/**
 * PV Version History Service
 * Manages version history for meeting minutes (Procès-Verbaux)
 */

import {
    collection,
    doc,
    addDoc,
    getDocs,
    getDoc,
    query,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp,
    updateDoc
} from 'firebase/firestore';
import { db } from './firebase';
import { logger } from '../utils/logger';
import type { Meeting, AgendaItem } from '../types/meeting.types';

// ============================================
// TYPES
// ============================================

export interface PVVersion {
    id: string;
    versionNumber: number;
    createdAt: Date;
    createdBy: string;
    status: 'draft' | 'pending_approval' | 'approved' | 'archived';
    changeDescription?: string;

    // Snapshot of the PV content
    minutes: string;
    agendaItems: AgendaItem[];

    // Approval info (if approved)
    approvedAt?: Date;
    approvedBy?: string;

    // Diff metadata
    changesFromPrevious?: {
        addedItems: number;
        modifiedItems: number;
        removedItems: number;
    };
}

export interface VersionComparisonResult {
    added: AgendaItem[];
    removed: AgendaItem[];
    modified: Array<{
        before: AgendaItem;
        after: AgendaItem;
        changes: string[];
    }>;
    unchanged: AgendaItem[];
}

// ============================================
// VERSION MANAGEMENT
// ============================================

/**
 * Get the versions subcollection reference for a meeting
 */
const getVersionsRef = (meetingId: string) =>
    collection(db, 'meetings', meetingId, 'pv_versions');

/**
 * Create a new version of the PV
 */
export const createPVVersion = async (
    meetingId: string,
    meeting: Meeting,
    userId: string,
    changeDescription?: string
): Promise<PVVersion> => {
    const timer = logger.time('PVVersioning', 'Create version');

    try {
        // Get the latest version number
        const latestVersion = await getLatestVersion(meetingId);
        const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

        // Calculate changes from previous version
        let changesFromPrevious: PVVersion['changesFromPrevious'];
        if (latestVersion) {
            const comparison = compareVersions(latestVersion.agendaItems, meeting.agendaItems || []);
            changesFromPrevious = {
                addedItems: comparison.added.length,
                modifiedItems: comparison.modified.length,
                removedItems: comparison.removed.length
            };
        }

        // Create the version document - filter out undefined values for Firestore
        const versionData: Record<string, unknown> = {
            versionNumber: newVersionNumber,
            createdAt: serverTimestamp(),
            createdBy: userId,
            status: 'draft' as const,
            changeDescription: changeDescription || `Version ${newVersionNumber}`,
            minutes: meeting.minutes || '',
            agendaItems: meeting.agendaItems || [],
        };

        // Only add changesFromPrevious if it's defined (not for first version)
        if (changesFromPrevious) {
            versionData.changesFromPrevious = changesFromPrevious;
        }

        const docRef = await addDoc(getVersionsRef(meetingId), versionData);

        logger.info('PVVersioning', `Created version ${newVersionNumber} for meeting ${meetingId}`);
        timer.end({ versionNumber: newVersionNumber });

        return {
            id: docRef.id,
            versionNumber: newVersionNumber,
            createdAt: new Date(),
            createdBy: userId,
            status: 'draft' as const,
            changeDescription: changeDescription || `Version ${newVersionNumber}`,
            minutes: meeting.minutes || '',
            agendaItems: meeting.agendaItems || [],
            changesFromPrevious
        };

    } catch (error) {
        logger.error('PVVersioning', 'Failed to create version', { error, meetingId });
        timer.end({ error: true });
        throw error;
    }
};

/**
 * Get all versions for a meeting
 */
export const getAllVersions = async (meetingId: string): Promise<PVVersion[]> => {
    try {
        const versionsQuery = query(
            getVersionsRef(meetingId),
            orderBy('versionNumber', 'desc')
        );

        const snapshot = await getDocs(versionsQuery);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: (doc.data().createdAt as Timestamp)?.toDate() || new Date(),
            approvedAt: (doc.data().approvedAt as Timestamp)?.toDate()
        })) as PVVersion[];

    } catch (error) {
        logger.error('PVVersioning', 'Failed to get versions', { error, meetingId });
        throw error;
    }
};

/**
 * Get the latest version
 */
export const getLatestVersion = async (meetingId: string): Promise<PVVersion | null> => {
    try {
        const versionsQuery = query(
            getVersionsRef(meetingId),
            orderBy('versionNumber', 'desc'),
            limit(1)
        );

        const snapshot = await getDocs(versionsQuery);

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        return {
            id: doc.id,
            ...doc.data(),
            createdAt: (doc.data().createdAt as Timestamp)?.toDate() || new Date(),
            approvedAt: (doc.data().approvedAt as Timestamp)?.toDate()
        } as PVVersion;

    } catch (error) {
        logger.error('PVVersioning', 'Failed to get latest version', { error, meetingId });
        return null;
    }
};

/**
 * Get a specific version
 */
export const getVersion = async (
    meetingId: string,
    versionId: string
): Promise<PVVersion | null> => {
    try {
        const docRef = doc(db, 'meetings', meetingId, 'pv_versions', versionId);
        const snapshot = await getDoc(docRef);

        if (!snapshot.exists()) return null;

        return {
            id: snapshot.id,
            ...snapshot.data(),
            createdAt: (snapshot.data().createdAt as Timestamp)?.toDate() || new Date(),
            approvedAt: (snapshot.data().approvedAt as Timestamp)?.toDate()
        } as PVVersion;

    } catch (error) {
        logger.error('PVVersioning', 'Failed to get version', { error, meetingId, versionId });
        return null;
    }
};

/**
 * Approve a version (marks it as official)
 */
export const approveVersion = async (
    meetingId: string,
    versionId: string,
    userId: string
): Promise<void> => {
    try {
        const docRef = doc(db, 'meetings', meetingId, 'pv_versions', versionId);

        await updateDoc(docRef, {
            status: 'approved',
            approvedAt: serverTimestamp(),
            approvedBy: userId
        });

        logger.info('PVVersioning', `Approved version ${versionId} for meeting ${meetingId}`);

    } catch (error) {
        logger.error('PVVersioning', 'Failed to approve version', { error, meetingId, versionId });
        throw error;
    }
};

/**
 * Restore a previous version (creates a new version from an old one)
 */
export const restoreVersion = async (
    meetingId: string,
    versionId: string,
    userId: string
): Promise<PVVersion> => {
    try {
        const oldVersion = await getVersion(meetingId, versionId);

        if (!oldVersion) {
            throw new Error('Version not found');
        }

        // Create a partial meeting object with required fields for versioning
        const restoredMeeting = {
            id: meetingId,
            title: '',
            date: '',
            type: 'regular' as const,
            status: 'scheduled' as const,
            location: '',
            attendees: [],
            dateCreated: new Date().toISOString(),
            dateUpdated: new Date().toISOString(),
            minutes: oldVersion.minutes,
            agendaItems: oldVersion.agendaItems
        } satisfies Meeting;

        const newVersion = await createPVVersion(
            meetingId,
            restoredMeeting,
            userId,
            `Restauré depuis la version ${oldVersion.versionNumber}`
        );

        logger.info('PVVersioning', `Restored version ${versionId} as new version`, {
            meetingId,
            oldVersion: oldVersion.versionNumber,
            newVersion: newVersion.versionNumber
        });

        return newVersion;

    } catch (error) {
        logger.error('PVVersioning', 'Failed to restore version', { error, meetingId, versionId });
        throw error;
    }
};

// ============================================
// VERSION COMPARISON
// ============================================

/**
 * Compare two versions to find differences
 */
export const compareVersions = (
    oldItems: AgendaItem[],
    newItems: AgendaItem[]
): VersionComparisonResult => {
    const oldIds = new Set(oldItems.map(item => item.id));
    const newIds = new Set(newItems.map(item => item.id));

    const result: VersionComparisonResult = {
        added: [],
        removed: [],
        modified: [],
        unchanged: []
    };

    // Find added items
    result.added = newItems.filter(item => !oldIds.has(item.id));

    // Find removed items
    result.removed = oldItems.filter(item => !newIds.has(item.id));

    // Find modified and unchanged items
    newItems.filter(item => oldIds.has(item.id)).forEach(newItem => {
        const oldItem = oldItems.find(item => item.id === newItem.id);
        if (!oldItem) return;

        const changes = detectItemChanges(oldItem, newItem);

        if (changes.length > 0) {
            result.modified.push({
                before: oldItem,
                after: newItem,
                changes
            });
        } else {
            result.unchanged.push(newItem);
        }
    });

    return result;
};

/**
 * Detect changes between two agenda items
 */
const detectItemChanges = (oldItem: AgendaItem, newItem: AgendaItem): string[] => {
    const changes: string[] = [];

    if (oldItem.title !== newItem.title) {
        changes.push('Titre modifié');
    }

    if (oldItem.decision !== newItem.decision) {
        changes.push('Décision modifiée');
    }

    if (oldItem.objective !== newItem.objective) {
        changes.push('Objectif modifié');
    }

    if (oldItem.description !== newItem.description) {
        changes.push('Description modifiée');
    }

    // Compare minute entries
    const oldEntries = oldItem.minuteEntries || [];
    const newEntries = newItem.minuteEntries || [];

    if (oldEntries.length !== newEntries.length) {
        changes.push(`Entrées modifiées (${oldEntries.length} → ${newEntries.length})`);
    } else {
        const entriesChanged = oldEntries.some((oldEntry, index) => {
            const newEntry = newEntries[index];
            return oldEntry.content !== newEntry?.content ||
                oldEntry.number !== newEntry?.number ||
                oldEntry.type !== newEntry?.type;
        });

        if (entriesChanged) {
            changes.push('Contenu des entrées modifié');
        }
    }

    return changes;
};

/**
 * Get a human-readable diff summary
 */
export const getDiffSummary = (comparison: VersionComparisonResult): string => {
    const parts: string[] = [];

    if (comparison.added.length > 0) {
        parts.push(`${comparison.added.length} point(s) ajouté(s)`);
    }
    if (comparison.removed.length > 0) {
        parts.push(`${comparison.removed.length} point(s) supprimé(s)`);
    }
    if (comparison.modified.length > 0) {
        parts.push(`${comparison.modified.length} point(s) modifié(s)`);
    }

    if (parts.length === 0) {
        return 'Aucune modification';
    }

    return parts.join(', ');
};

export default {
    createPVVersion,
    getAllVersions,
    getLatestVersion,
    getVersion,
    approveVersion,
    restoreVersion,
    compareVersions,
    getDiffSummary
};
