import { useState, useEffect } from 'react';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import { PresentationMeeting, AgendaItem, Attachment } from '../types';
import { Meeting } from '../../../types/meeting.types';

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
                        attachments: attachments
                    };
                });

                // 4. Set State
                setMeeting({
                    id: meetingData.id,
                    title: meetingData.title,
                    date: new Date(meetingData.date).toLocaleDateString('fr-CA', {
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

    return { meeting, loading, error };
};
