import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, collection, getDocs, query, where, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import type { PresentationMeeting, AgendaItem, Attachment } from '../types';
import type { Meeting } from '../../../types/meeting.types';

export const usePresentationData = (meetingId?: string) => {
    const [meeting, setMeeting] = useState<PresentationMeeting | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!meetingId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                // 1. Fetch Meeting
                const meetingRef = doc(db, 'meetings', meetingId);
                const meetingSnap = await getDoc(meetingRef);

                if (!meetingSnap.exists()) {
                    setError("Réunion introuvable");
                    return;
                }

                const meetingData = { id: meetingSnap.id, ...meetingSnap.data() } as Meeting;

                // 2. Fetch Linked Documents
                // Query documents where linkedEntityId == meetingId OR linkedEntityType == 'meeting'
                // Actually, documentsAPI links via linkedEntityId which is meetingId.
                const docsRef = collection(db, 'documents');
                const q = query(docsRef, where('linkedEntityId', '==', meetingId));
                const docsSnap = await getDocs(q);

                const documents = docsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // 3. Map Data to Presentation Format
                const mappedAgenda: AgendaItem[] = (meetingData.agendaItems || []).map(item => {
                    // Find attachments for this item
                    const itemDocs = documents.filter((d: any) => d.agendaItemId === item.id);

                    const attachments: Attachment[] = itemDocs.map((d: any) => ({
                        id: d.id,
                        name: d.name,
                        url: d.url,
                        type: d.type?.includes('image') ? 'image' : 'pdf', // Simple detection
                        pageCount: undefined // API doesn't store this yet
                    }));

                    return {
                        id: item.id,
                        title: item.title,
                        description: item.description || '',
                        presenter: item.presenter || '',
                        durationInMinutes: item.duration || 10, // Default duration if missing
                        actualDuration: item.actualDuration || 0,
                        attachments: attachments,
                        objective: item.objective,
                        agendaNote: item.agendaNote,
                        decision: item.decision,
                        audioSegment: item.audioSegment || null
                    };
                });

                const getDate = (d: any) => {
                    if (!d) return new Date();
                    if (d.toDate) return d.toDate(); // Firestore Timestamp
                    return new Date(d);
                };

                // 4. Set State
                setMeeting({
                    id: meetingData.id,
                    title: meetingData.title,
                    date: getDate(meetingData.date).toLocaleDateString('fr-CA', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                    }),
                    agenda: mappedAgenda
                });

            } catch (err: any) {
                console.error("Error fetching presentation data:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [meetingId]);

    const saveItemDuration = useCallback(async (itemId: string, additionalSeconds: number) => {
        if (!meeting) return;

        try {
            // We need to update the specific item in the array. 
            // Since Firestore array updates are basic, we read-modify-write the whole array.
            // Optimized later with a subcollection if needed.

            const updatedAgenda = meeting.agenda.map(item => {
                if (item.id === itemId) {
                    return { ...item, actualDuration: (item.actualDuration || 0) + additionalSeconds };
                }
                return item;
            });

            // Update local state immediately for UI responsiveness
            setMeeting(prev => prev ? { ...prev, agenda: updatedAgenda } : null);

            // Update Firestore
            // Note: We need to map back to the original Firestore data structure if it differs.
            // Assuming 'agendaItems' in Firestore matches structure mostly.
            // We fetch fresh to avoid overwriting other concurrent changes if possible, 
            // but for now we use local knowledge for speed.
            const meetingRef = doc(db, 'meetings', meeting.id);
            // We only want to update the 'agendaItems' field.
            // We need to reconstruct the simplified AgendaItem tomatch Firestore expectation if it has extra UI fields.
            // Based on types, it looks compatible.

            // CAUTION: writing the whole array. In a multi-user app, this is risky. 
            // For this single-presenter mode, it's acceptable.
            await updateDoc(meetingRef, {
                agendaItems: updatedAgenda.map(item => ({
                    id: item.id,
                    title: item.title,
                    description: item.description,
                    duration: item.durationInMinutes,
                    presenter: item.presenter,
                    actualDuration: item.actualDuration || 0,
                    // Preserve other fields
                    objective: item.objective || '',
                    agendaNote: item.agendaNote || '',
                    decision: item.decision || ''
                }))
            });

        } catch (err) {
            console.error("Error saving duration:", err);
        }
    }, [meeting]);

    const saveItemAudioSegment = useCallback(async (itemId: string, segment: { start: number; end?: number; audioUrl?: string }) => {
        if (!meeting) return;

        try {
            const updatedAgenda = meeting.agenda.map(item => {
                if (item.id === itemId) {
                    return { ...item, audioSegment: segment };
                }
                return item;
            });

            // Update local state immediately for UI responsiveness
            setMeeting(prev => prev ? { ...prev, agenda: updatedAgenda } : null);

            // Update Firestore
            const meetingRef = doc(db, 'meetings', meeting.id);
            await updateDoc(meetingRef, {
                agendaItems: updatedAgenda.map(item => ({
                    id: item.id,
                    title: item.title,
                    description: item.description,
                    duration: item.durationInMinutes,
                    presenter: item.presenter,
                    actualDuration: item.actualDuration || 0,
                    objective: item.objective || '',
                    agendaNote: item.agendaNote || '',
                    decision: item.decision || '',
                    audioSegment: item.audioSegment || null
                }))
            });

        } catch (err) {
            console.error("Error saving audio segment:", err);
        }
    }, [meeting]);

    const saveNote = useCallback(async (itemId: string, content: string) => {
        if (!meeting) return;
        try {
            // Save to a subcollection 'notes' under the meeting document
            // Structure: meetings/{meetingId}/notes/{itemId}
            const noteRef = doc(db, 'meetings', meeting.id, 'notes', itemId);
            await setDoc(noteRef, {
                content,
                timestamp: Date.now()
            }, { merge: true });
        } catch (err) {
            console.error("Error saving note:", err);
        }
    }, [meeting]);

    return { meeting, loading, error, saveItemDuration, saveNote, saveItemAudioSegment };
};
