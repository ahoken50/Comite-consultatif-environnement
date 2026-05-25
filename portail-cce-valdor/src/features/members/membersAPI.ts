import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { Member, MemberUpdateData } from '../../types/member.types';

const COLLECTION_NAME = 'members';

export const fetchMembers = async (): Promise<Member[]> => {
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    return querySnapshot.docs.map(doc => {
        const data = doc.data() as any;
        if (data.embedding) delete data.embedding;
        return { id: doc.id, ...data } as Member;
    });
};

export const fetchMemberById = async (id: string): Promise<Member | null> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data() as any;
        if (data.embedding) delete data.embedding;
        return { id: docSnap.id, ...data } as Member;
    }
    return null;
};

export const createMember = async (member: Member): Promise<Member> => {
    // We use setDoc with the Auth UID as the document ID
    await setDoc(doc(db, COLLECTION_NAME, member.id), member);
    return member;
};

// Helper to remove undefined values which cause Firestore crashes
const cleanUpdates = (updates: any) => {
    const cleaned: any = {};
    Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
            cleaned[key] = updates[key];
        }
    });
    return cleaned;
};

export const updateMember = async (id: string, updates: MemberUpdateData): Promise<MemberUpdateData> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const cleanedUpdates = cleanUpdates(updates);
    await updateDoc(docRef, cleanedUpdates);
    return updates;
};

export const deleteMember = async (id: string): Promise<string> => {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return id;
};

// Helper to check if a user profile exists in Firestore upon login
export const ensureMemberProfile = async (user: any): Promise<Member> => {
    // Handle both user.uid (Firebase Auth) and user.id (Redux state)
    const userId = user.uid || user.id;
    const userEmail = user.email;

    // 1. Try to find by Auth UID (standard case)
    const existingMember = await fetchMemberById(userId);
    if (existingMember) {
        return existingMember;
    }

    // 2. If not found by UID, try to find by Email (migration/admin-created case)
    if (userEmail) {
        const { query, where } = await import('firebase/firestore');
        const q = query(collection(db, COLLECTION_NAME), where('email', '==', userEmail));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            const data = doc.data() as any;
            if (data.embedding) delete data.embedding;
            const foundMember = { id: doc.id, ...data } as Member;

            return foundMember;
        }
    }

    const newMember: Member = {
        id: userId,
        displayName: user.displayName || 'Membre',
        email: userEmail || '',
        photoURL: user.photoURL || '',
        role: 'member', // Default role
        dateJoined: new Date().toISOString(),
        isActive: true
    };

    return await createMember(newMember);
};

export const uploadMemberSignature = async (file: File, memberId: string): Promise<string> => {
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('../../services/firebase');

    const storagePath = `signatures/${memberId}_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
};
