import { useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useDispatch } from 'react-redux';
import { db } from '../services/firebase';
import { upsertMeeting } from '../features/meetings/meetingsSlice';
import type { Meeting } from '../types/meeting.types';

export const useMeetingSubscription = (meetingId?: string) => {
    const dispatch = useDispatch();

    useEffect(() => {
        if (!meetingId) return;

        const unsubscribe = onSnapshot(
            doc(db, 'meetings', meetingId),
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    const meeting = {
                        id: docSnapshot.id,
                        ...data,
                        // Convert Timestamps to ISO strings
                        date: (data.date?.toDate ? data.date.toDate().toISOString() : data.date),
                        dateCreated: (data.dateCreated?.toDate ? data.dateCreated.toDate().toISOString() : data.dateCreated),
                        dateUpdated: (data.dateUpdated?.toDate ? data.dateUpdated.toDate().toISOString() : data.dateUpdated),
                    } as Meeting;

                    dispatch(upsertMeeting(meeting));
                }
            },
            (error) => {
                console.error('Error in meeting subscription:', error);
            }
        );

        return () => unsubscribe();
    }, [meetingId, dispatch]);
};
