import {
    collection,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    Timestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { Meeting } from '../../types/meeting.types';

const COLLECTION_NAME = 'meetings';

/**
 * Recursively removes all undefined values from an object.
 * Firestore does not accept undefined values and will throw an error.
 * This function ensures all updates are safe by:
 * - Removing keys with undefined values
 * - Recursively processing nested objects and arrays
 * - Replacing undefined strings with empty strings
 */
const sanitizeForFirestore = (obj: any): any => {
    if (obj === undefined) {
        return null; // Replace undefined with null (Firestore accepts null)
    }
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof Timestamp) {
        return obj; // Preserve Firestore Timestamps
    }
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeForFirestore(item));
    }

    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value === undefined) {
            // For string-type fields, use empty string; otherwise null
            if (['decision', 'description', 'proposer', 'seconder', 'minuteNumber', 'minutes'].includes(key)) {
                cleaned[key] = '';
            }
            // Skip undefined values entirely for fields that should be absent
            // This is safer than setting to null for optional fields like minuteType
        } else {
            cleaned[key] = sanitizeForFirestore(value);
        }
    }
    return cleaned;
};

export const meetingsAPI = {
    fetchAll: async (): Promise<Meeting[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy('date', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Convert Timestamps to ISO strings
            date: doc.data().date?.toDate().toISOString(),
            dateCreated: doc.data().dateCreated?.toDate().toISOString(),
            dateUpdated: doc.data().dateUpdated?.toDate().toISOString(),
        } as Meeting));
    },

    create: async (meeting: Omit<Meeting, 'id'>): Promise<Meeting> => {
        // Sanitize before creating
        const sanitizedMeeting = sanitizeForFirestore(meeting);
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...sanitizedMeeting,
            date: Timestamp.fromDate(new Date(meeting.date)),
            dateCreated: Timestamp.now(),
            dateUpdated: Timestamp.now(),
        });
        return { id: docRef.id, ...meeting } as Meeting;
    },

    update: async (id: string, updates: Partial<Meeting>): Promise<void> => {
        console.log('[DEBUG meetingsAPI.update] Starting update for id:', id);
        console.log('[DEBUG meetingsAPI.update] Updates received:', JSON.stringify(updates, null, 2));

        const docRef = doc(db, COLLECTION_NAME, id);

        let updatesWithTimestamp: any = {
            ...updates,
            dateUpdated: Timestamp.now(),
        };

        if (updates.date) {
            updatesWithTimestamp.date = Timestamp.fromDate(new Date(updates.date));
        }

        // CRITICAL: Sanitize to remove all undefined values
        updatesWithTimestamp = sanitizeForFirestore(updatesWithTimestamp);

        console.log('[DEBUG meetingsAPI.update] After sanitization:', JSON.stringify(updatesWithTimestamp, (_, v) => v === undefined ? '__UNDEFINED__' : v, 2));

        // Debug: Log first agenda item if present
        if (updatesWithTimestamp.agendaItems && updatesWithTimestamp.agendaItems.length > 0) {
            console.log('[DEBUG meetingsAPI.update] First agenda item after sanitization:', JSON.stringify(updatesWithTimestamp.agendaItems[0], null, 2));
        }

        try {
            console.log('[DEBUG meetingsAPI.update] Calling updateDoc...');
            await updateDoc(docRef, updatesWithTimestamp);
            console.log('[DEBUG meetingsAPI.update] updateDoc completed successfully');
        } catch (error: any) {
            console.error('[DEBUG meetingsAPI.update] ERROR calling updateDoc:', error);
            console.error('[DEBUG meetingsAPI.update] Error code:', error?.code);
            console.error('[DEBUG meetingsAPI.update] Error message:', error?.message);
            throw error;
        }
    },

    delete: async (id: string): Promise<void> => {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
    }
};
