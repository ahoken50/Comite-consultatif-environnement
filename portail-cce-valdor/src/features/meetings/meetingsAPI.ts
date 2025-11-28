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
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...meeting,
            date: Timestamp.fromDate(new Date(meeting.date)),
            dateCreated: Timestamp.now(),
            dateUpdated: Timestamp.now(),
        });
        return { id: docRef.id, ...meeting } as Meeting;
    },

    update: async (id: string, updates: Partial<Meeting>): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        const updatesWithTimestamp = {
            ...updates,
            dateUpdated: Timestamp.now(),
        };

        if (updates.date) {
            // @ts-ignore - handling the specific date conversion
            updatesWithTimestamp.date = Timestamp.fromDate(new Date(updates.date));
        }

        await updateDoc(docRef, updatesWithTimestamp);
    },

    delete: async (id: string): Promise<void> => {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
    }
};
