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

        const docRef = doc(db, COLLECTION_NAME, id);

        let updatesWithTimestamp: any = {
            ...updates,
            dateUpdated: Timestamp.now(),
        };

        if (updates.date) {
            updatesWithTimestamp.date = Timestamp.fromDate(new Date(updates.date));
        }

        // Crutial: Sanitize to remove all undefined values
        updatesWithTimestamp = sanitizeForFirestore(updatesWithTimestamp);


        try {
            await updateDoc(docRef, updatesWithTimestamp);
        } catch (error: any) {
            console.error('Error calling updateDoc:', error);
            throw error;
        }
    },

    delete: async (id: string): Promise<void> => {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
    }
};
