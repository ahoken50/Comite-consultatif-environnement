import { useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useDispatch } from 'react-redux';
import { db } from '../services/firebase';
import { upsertMeeting } from '../features/meetings/meetingsSlice';
import type { Meeting } from '../types/meeting.types';

const THROTTLE_MS = 2000; // Only process one snapshot per 2 seconds

export const useMeetingSubscription = (meetingId?: string) => {
    const dispatch = useDispatch();
    const lastDispatchRef = useRef(0);
    const pendingRef = useRef<Meeting | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

                    const now = Date.now();
                    const elapsed = now - lastDispatchRef.current;

                    if (elapsed >= THROTTLE_MS) {
                        // Enough time has passed, dispatch immediately
                        lastDispatchRef.current = now;
                        dispatch(upsertMeeting(meeting));
                    } else {
                        // Too soon — store the latest and schedule a deferred dispatch
                        pendingRef.current = meeting;
                        if (!timerRef.current) {
                            timerRef.current = setTimeout(() => {
                                if (pendingRef.current) {
                                    lastDispatchRef.current = Date.now();
                                    dispatch(upsertMeeting(pendingRef.current));
                                    pendingRef.current = null;
                                }
                                timerRef.current = null;
                            }, THROTTLE_MS - elapsed);
                        }
                    }
                }
            },
            (error) => {
                console.error('Error in meeting subscription:', error);
            }
        );

        return () => {
            unsubscribe();
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [meetingId, dispatch]);
};
