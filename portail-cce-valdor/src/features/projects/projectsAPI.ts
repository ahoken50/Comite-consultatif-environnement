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
import { Project } from '../../types/project.types';

const COLLECTION_NAME = 'projects';

export const projectsAPI = {
    fetchAll: async (): Promise<Project[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy('dateUpdated', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Convert Timestamps to ISO strings for Redux serialization
            dateCreated: doc.data().dateCreated?.toDate().toISOString(),
            dateUpdated: doc.data().dateUpdated?.toDate().toISOString(),
            dateCompleted: doc.data().dateCompleted?.toDate().toISOString() || null,
            estimatedCompletionDate: doc.data().estimatedCompletionDate?.toDate().toISOString() || null,
        } as Project));
    },

    create: async (project: Omit<Project, 'id'>): Promise<Project> => {
        const docRef = await addDoc(collection(db, COLLECTION_NAME), {
            ...project,
            dateCreated: Timestamp.now(),
            dateUpdated: Timestamp.now(),
        });
        return { id: docRef.id, ...project } as Project;
    },

    update: async (id: string, updates: Partial<Project>): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, {
            ...updates,
            dateUpdated: Timestamp.now(),
        });
    },

    delete: async (id: string): Promise<void> => {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
    }
};
