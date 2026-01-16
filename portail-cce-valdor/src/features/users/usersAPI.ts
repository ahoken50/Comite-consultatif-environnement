import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { UserProfile, UserRole } from '../../types/auth.types';

export const fetchAllUsers = async (): Promise<UserProfile[]> => {
    try {
        const snapshot = await getDocs(collection(db, 'users'));
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as UserProfile));
    } catch (error) {
        console.error("Error fetching users:", error);
        throw error;
    }
};

export const updateUserRole = async (userId: string, newRole: UserRole): Promise<void> => {
    try {
        await updateDoc(doc(db, 'users', userId), {
            role: newRole
        });
    } catch (error) {
        console.error("Error updating user role:", error);
        throw error;
    }
};

export const deleteUser = async (userId: string): Promise<void> => {
    // Note: This only deletes the Firestore document.
    // Deleting the Auth user requires Cloud Functions or Admin SDK.
    try {
        await deleteDoc(doc(db, 'users', userId));
    } catch (error) {
        console.error("Error deleting user profile:", error);
        throw error;
    }
};
