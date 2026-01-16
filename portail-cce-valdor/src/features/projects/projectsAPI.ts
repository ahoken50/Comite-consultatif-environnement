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
        // 1. Update project
        const docRef = doc(db, COLLECTION_NAME, projectId);
        await updateDoc(docRef, {
            linkedResolutions: arrayUnion(resolution),
            dateUpdated: Timestamp.now()
        });

        // 2. Update meeting agenda item
        try {
            const meetingRef = doc(db, 'meetings', resolution.meetingId);
            const meetingSnap = await getDoc(meetingRef);

            if (meetingSnap.exists()) {
                const meetingData = meetingSnap.data();
                const agendaItems = meetingData.agendaItems || [];

                // Find and update item
                const updatedItems = agendaItems.map((item: any) => {
                    if (item.id === resolution.agendaItemId) {
                        return { ...item, linkedProjectId: projectId };
                    }
                    return item;
                });

                await updateDoc(meetingRef, {
                    agendaItems: updatedItems
                });
            }
        } catch (error) {
            console.error('Failed to update meeting with linked project:', error);
            // Non-blocking error, but should track
        }
    },

    // Unlink a CCE resolution/comment from a project
    unlinkResolution: async (projectId: string, resolutionId: string): Promise<void> => {
        const docRef = doc(db, COLLECTION_NAME, projectId);
        // Need to fetch current array and filter
        const docSnap = await getDoc(docRef);

        let removedResolution: LinkedResolution | undefined;

        if (docSnap.exists()) {
            const data = docSnap.data();
            const linkedResolutions = (data.linkedResolutions || []).filter(
                (r: LinkedResolution) => {
                    if (r.id === resolutionId) {
                        removedResolution = r; // Capture for meeting update
                        return false;
                    }
                    return true;
                }
            );

            await updateDoc(docRef, {
                linkedResolutions,
                dateUpdated: Timestamp.now()
            });

            // 2. Update meeting agenda item (remove link)
            if (removedResolution) {
                try {
                    const meetingRef = doc(db, 'meetings', removedResolution.meetingId);
                    const meetingSnap = await getDoc(meetingRef);

                    if (meetingSnap.exists()) {
                        const meetingData = meetingSnap.data();
                        const agendaItems = meetingData.agendaItems || [];

                        // Find and update item
                        const updatedItems = agendaItems.map((item: any) => {
                            if (item.id === removedResolution!.agendaItemId) {
                                const { linkedProjectId, ...rest } = item; // Remove property
                                return rest;
                            }
                            return item;
                        });

                        await updateDoc(meetingRef, {
                            agendaItems: updatedItems
                        });
                    }
                } catch (error) {
                    console.error('Failed to update meeting to remove linked project:', error);
                }
            }
        }
    },

    // MERGE PROJECTS FEATURE
    // Merges sourceProject into targetProject and deletes sourceProject
    mergeProjects: async (sourceProjectId: string, targetProjectId: string, user: any): Promise<void> => {
        // Yield to UI thread to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
        console.log(`Starting merge: Source=${sourceProjectId} -> Target=${targetProjectId}`);

        // 1. Fetch Source Project Data
        const sourceRef = doc(db, COLLECTION_NAME, sourceProjectId);
        const sourceSnap = await getDoc(sourceRef);

        if (!sourceSnap.exists()) throw new Error("Source project not found");
        const sourceData = sourceSnap.data() as Project;

        // 2. Fetch Source Tasks
        const tasksQ = query(collection(db, COLLECTION_NAME, sourceProjectId, 'tasks'));
        const tasksSnap = await getDocs(tasksQ);
        const sourceTasks = tasksSnap.docs.map(t => t.data() as ProjectTask);

        // 3. Update Target Project (Merge Arrays)
        const targetRef = doc(db, COLLECTION_NAME, targetProjectId);

        await updateDoc(targetRef, {
            linkedResolutions: arrayUnion(...(sourceData.linkedResolutions || [])),

            caucusDecisions: arrayUnion(...(sourceData.caucusDecisions || [])),
            linkedMeetingIds: arrayUnion(...(sourceData.linkedMeetingIds || [])),
            linkedDocumentIds: arrayUnion(...(sourceData.linkedDocumentIds || [])),
            tags: arrayUnion(...(sourceData.tags || [])),
            // Append description if useful? Let's just update timestamp for now.
            dateUpdated: Timestamp.now(),
            // Merge comments AND Add a system comment about the merge
            comments: arrayUnion(
                ...(sourceData.comments || []),
                {
                    id: `merge-${Date.now()}`,
                    userId: user.uid,
                    userName: 'Système',
                    content: `Fusion du projet "${sourceData.name}" (${sourceData.code}) dans ce projet.`,
                    createdAt: new Date().toISOString()
                }
            )
        });

        // 4. Move Tasks to Target
        const targetTasksRef = collection(db, COLLECTION_NAME, targetProjectId, 'tasks');
        const batchPromises = sourceTasks.map(task => {
            return addDoc(targetTasksRef, {
                ...task,
                projectId: targetProjectId, // Update parent ID
                description: `[Fusion du ${sourceData.code}] ${task.description}`, // Tag origin
                dateCreated: Timestamp.now()
            });
        });
        await Promise.all(batchPromises);

        // 5. Update External Meeting References
        // For every resolution linked to Source, we must update the Meeting Agenda Item to point to Target
        if (sourceData.linkedResolutions) {
            for (const res of sourceData.linkedResolutions) {
                try {
                    const meetingRef = doc(db, 'meetings', res.meetingId);
                    const meetingSnap = await getDoc(meetingRef);
                    if (meetingSnap.exists()) {
                        const mData = meetingSnap.data();
                        const agendaItems = mData.agendaItems || [];
                        let changed = false;

                        const updatedItems = agendaItems.map((item: any) => {
                            if (item.id === res.agendaItemId && item.linkedProjectId === sourceProjectId) {
                                changed = true;
                                return { ...item, linkedProjectId: targetProjectId }; // UPDATE POINTER
                            }
                            return item;
                        });

                        if (changed) {
                            await updateDoc(meetingRef, { agendaItems: updatedItems });
                            console.log(`Updated meeting ${res.meetingId} agenda item ${res.agendaItemId} to new project.`);
                        }
                    }
                } catch (err) {
                    console.error(`Failed to update meeting ref during merge for ${res.meetingId}`, err);
                }
            }
        }

        // 6. Delete Source Project
        // Delete tasks subcollection first (manually, as Firestore doesn't cascade delete subcollections)
        const deleteTasksPromises = tasksSnap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deleteTasksPromises);

        // Delete document
        await deleteDoc(sourceRef);
        console.log("Merge completed successfully.");
    }
};
