import {
    collection,
    doc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy
} from 'firebase/firestore';
import { db } from '../../services/firebase'; // Updated from config/firebase to services/firebase based on other files usually or check
import type { CouncilRecommendation } from '../../types/recommendation.types';

const COLLECTION_NAME = 'council_recommendations';

export const governanceAPI = {
    // Fetch all recommendations
    fetchAllRecommendations: async (): Promise<CouncilRecommendation[]> => {
        try {
            const q = query(
                collection(db, COLLECTION_NAME),
                orderBy('updatedAt', 'desc')
            );

            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as CouncilRecommendation));
        } catch (error) {
            console.error('Error fetching recommendations:', error);
            throw error;
        }
    },

    // Fetch recommendations by project
    fetchRecommendationsByProject: async (projectId: string): Promise<CouncilRecommendation[]> => {
        try {
            const q = query(
                collection(db, COLLECTION_NAME),
                where('projectId', '==', projectId),
                orderBy('updatedAt', 'desc')
            );

            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as CouncilRecommendation));
        } catch (error) {
            console.error('Error fetching project recommendations:', error);
            throw error;
        }
    },

    // Add a new recommendation
    addRecommendation: async (recommendation: Omit<CouncilRecommendation, 'id'>): Promise<CouncilRecommendation> => {
        try {
            const docRef = await addDoc(collection(db, COLLECTION_NAME), recommendation);
            return {
                id: docRef.id,
                ...recommendation
            };
        } catch (error) {
            console.error('Error adding recommendation:', error);
            throw error;
        }
    },

    // Update a recommendation
    updateRecommendation: async (id: string, updates: Partial<CouncilRecommendation>): Promise<void> => {
        try {
            const docRef = doc(db, COLLECTION_NAME, id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error('Error updating recommendation:', error);
            throw error;
        }
    },

    // Delete a recommendation
    deleteRecommendation: async (id: string): Promise<void> => {
        try {
            await deleteDoc(doc(db, COLLECTION_NAME, id));
        } catch (error) {
            console.error('Error deleting recommendation:', error);
            throw error;
        }
    }
};
