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
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
};

export const fetchMemberById = async (id: string): Promise<Member | null> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Member;
    }
    return null;
};

export const createMember = async (member: Member): Promise<Member> => {
    // We use setDoc with the Auth UID as the document ID
    await setDoc(doc(db, COLLECTION_NAME, member.id), member);
    return member;
};

export const updateMember = async (id: string, updates: MemberUpdateData): Promise<MemberUpdateData> => {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, updates as any);
    return updates;
};

export const deleteMember = async (id: string): Promise<string> => {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    return id;
};

// Helper to check if a user profile exists in Firestore upon login
export const ensureMemberProfile = async (user: any): Promise<Member> => {
    const existingMember = await fetchMemberById(user.uid);
    if (existingMember) {
        return existingMember;
    }

    const newMember: Member = {
        id: user.uid,
        displayName: user.displayName || 'Membre',
        email: user.email || '',
        photoURL: user.photoURL || '',
        role: 'member', // Default role
        dateJoined: new Date().toISOString(),
        isActive: true
    };

    return await createMember(newMember);
};
