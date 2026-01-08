import {
    collection,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    addDoc,
    arrayUnion,
    Timestamp,
    getDoc
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { Project, LinkedResolution } from '../../types/project.types';
import type { ProjectTask } from '../../types/task.types';

const COLLECTION_NAME = 'projects';

export const projectsAPI = {
    fetchAll: async (): Promise<Project[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy('dateUpdated', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Convert Timestamps to ISO strings for Redux serialization
            dateCreated: doc.data().dateCreated?.toDate ? doc.data().dateCreated.toDate().toISOString() : doc.data().dateCreated,
            dateUpdated: doc.data().dateUpdated?.toDate ? doc.data().dateUpdated.toDate().toISOString() : doc.data().dateUpdated,
            dateCompleted: (doc.data().dateCompleted?.toDate ? doc.data().dateCompleted.toDate().toISOString() : doc.data().dateCompleted) || null,
            estimatedCompletionDate: (doc.data().estimatedCompletionDate?.toDate ? doc.data().estimatedCompletionDate.toDate().toISOString() : doc.data().estimatedCompletionDate) || null,
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
    },

    // Tasks Sub-collection
    fetchTasks: async (projectId: string): Promise<ProjectTask[]> => {
        const q = query(
            collection(db, COLLECTION_NAME, projectId, 'tasks'),
            orderBy('dateCreated', 'asc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            projectId,
            ...doc.data(),
            dateCreated: doc.data().dateCreated?.toDate ? doc.data().dateCreated.toDate().toISOString() : doc.data().dateCreated,
            dateCompleted: (doc.data().dateCompleted?.toDate ? doc.data().dateCompleted.toDate().toISOString() : doc.data().dateCompleted) || undefined,
        } as ProjectTask));
    },

    addTask: async (projectId: string, task: Omit<ProjectTask, 'id' | 'projectId' | 'dateCreated'>): Promise<ProjectTask> => {
        const docRef = await addDoc(collection(db, COLLECTION_NAME, projectId, 'tasks'), {
            ...task,
            projectId,
            dateCreated: Timestamp.now(),
        });
        return {
            id: docRef.id,
            projectId,
            ...task,
            dateCreated: new Date().toISOString()
        } as ProjectTask;
    },

    updateTask: async (projectId: string, taskId: string, updates: Partial<ProjectTask>): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, projectId, 'tasks', taskId);
        await updateDoc(docRef, updates);
    },

    deleteTask: async (projectId: string, taskId: string): Promise<void> => {
        await deleteDoc(doc(db, COLLECTION_NAME, projectId, 'tasks', taskId));
    },

    addComment: async (projectId: string, comment: any): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, projectId);
        await updateDoc(docRef, {
            comments: arrayUnion(comment)
        });
    },

    addCaucusDecision: async (projectId: string, decision: any): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, projectId);
        await updateDoc(docRef, {
            caucusDecisions: arrayUnion(decision)
        });
    },

    // Link a CCE resolution/comment to a project
    linkResolution: async (projectId: string, resolution: LinkedResolution): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, projectId);
        await updateDoc(docRef, {
            linkedResolutions: arrayUnion(resolution),
            dateUpdated: Timestamp.now()
        });
    },

    // Unlink a CCE resolution/comment from a project
    unlinkResolution: async (projectId: string, resolutionId: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, projectId);
        // Need to fetch current array and filter
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const linkedResolutions = (data.linkedResolutions || []).filter(
                (r: LinkedResolution) => r.id !== resolutionId
            );
            await updateDoc(docRef, {
                linkedResolutions,
                dateUpdated: Timestamp.now()
            });
        }
    }
};
