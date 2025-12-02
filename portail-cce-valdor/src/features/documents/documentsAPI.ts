import {
    collection,
    getDocs,
    addDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    where,
    Timestamp
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import type { Document } from '../../types/document.types';

const COLLECTION_NAME = 'documents';

export const documentsAPI = {
    fetchAll: async (): Promise<Document[]> => {
        const q = query(collection(db, COLLECTION_NAME), orderBy('dateUploaded', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            dateUploaded: doc.data().dateUploaded?.toDate().toISOString(),
        } as Document));
    },

    fetchByEntity: async (entityId: string, entityType: 'project' | 'meeting'): Promise<Document[]> => {
        const q = query(
            collection(db, COLLECTION_NAME),
            where('linkedEntityId', '==', entityId),
            where('linkedEntityType', '==', entityType),
            orderBy('dateUploaded', 'desc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            dateUploaded: doc.data().dateUploaded?.toDate().toISOString(),
        } as Document));
    },

    upload: async (file: File, linkedEntityId?: string, linkedEntityType?: 'project' | 'meeting', uploadedBy?: string, agendaItemId?: string): Promise<Document> => {
        // 1. Upload file to Firebase Storage
        const storagePath = `documents/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        // 2. Save metadata to Firestore
        const docData: Record<string, any> = {
            name: file.name,
            type: file.type,
            size: file.size,
            url,
            storagePath,
            uploadedBy: uploadedBy || 'unknown',
            dateUploaded: new Date().toISOString(), // Placeholder, will be converted to Timestamp
        };

        if (linkedEntityId) docData.linkedEntityId = linkedEntityId;
        if (linkedEntityType) docData.linkedEntityType = linkedEntityType;
        if (agendaItemId) docData.agendaItemId = agendaItemId;

        const finalData = {
            ...docData,
            dateUploaded: Timestamp.now(),
        };

        // Paranoid check: Remove any undefined keys from finalData
        Object.keys(finalData).forEach(key => {
            if ((finalData as any)[key] === undefined) {
                delete (finalData as any)[key];
            }
        });

        const docRef = await addDoc(collection(db, COLLECTION_NAME), finalData);

        return { id: docRef.id, ...docData } as Document;
    },

    delete: async (id: string, storagePath: string): Promise<void> => {
        // 1. Delete from Firestore
        await deleteDoc(doc(db, COLLECTION_NAME, id));

        // 2. Delete from Storage
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
    }
};
