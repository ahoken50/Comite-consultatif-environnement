import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getRecentActivities } from '../services/activityLogService';
import { safeDate } from '../utils/dateUtils';
import { useToast } from './useToast';
import type { Project, Category } from '../types/project.types';
import type { Meeting } from '../types/meeting.types';
import type { ActivityLog } from '../types/activityLog.types';
import { getVoiceProfileAlerts, type VoiceAlert } from '../services/voiceAlertService';

export interface DashboardStats {
    projectsCompleted: number;
    projectsInProgress: number;
    projectsNew: number;
    projectsUrgent: number;
}

export interface Alert {
    id: string;
    code: string;
    title: string;
    status: 'blocked' | 'urgent';
    label: string;
}

export interface CategoryData {
    name: string;
    value: number;
    color: string;
    [key: string]: string | number; // Index signature for Recharts compatibility
}

export interface ProgressData {
    name: string;
    completed: number;
    new: number;
}

export interface DashboardData {
    stats: DashboardStats;
    alerts: Alert[];
    nextMeeting: Meeting | null;
    categoryData: CategoryData[];
    progressData: ProgressData[];
    activities: ActivityLog[];
    recentProjects: Project[];  // #1.2 Recently modified projects
    voiceAlerts: VoiceAlert[];
    pendingPVs: number;
    verificationCount: number;
    loading: boolean;
    error: string | null;
}

// Category colors for the pie chart
const CATEGORY_COLORS: Record<Category, string> = {
    water: '#0ea5e9',
    biodiversity: '#22c55e',
    regulation: '#8b5cf6',
    waste: '#f97316',
    emergency: '#ef4444',
    innovation: '#06b6d4',
    operations: '#64748b',
    climate: '#eab308'
};

// Category French labels
const CATEGORY_LABELS: Record<Category, string> = {
    water: 'Eau',
    biodiversity: 'Biodiversité',
    regulation: 'Réglementation',
    waste: 'Déchets',
    emergency: 'Urgence',
    innovation: 'Innovation',
    operations: 'Opérations',
    climate: 'Climat'
};

export const useDashboardData = (): DashboardData => {
    const { showError } = useToast();
    const [data, setData] = useState<DashboardData>({
        stats: { projectsCompleted: 0, projectsInProgress: 0, projectsNew: 0, projectsUrgent: 0 },
        alerts: [],
        nextMeeting: null,
        categoryData: [],
        progressData: [],
        activities: [],
        recentProjects: [],
        voiceAlerts: [],
        pendingPVs: 0,
        verificationCount: 0,
        loading: true,
        error: null
    });

    useEffect(() => {
        let isMounted = true;
        let unsubscribeAllScheduled: (() => void) | null = null;

        // One-time load for non-reactive or cross-db data
        const loadInitialData = async () => {
            try {
                const [voiceAlerts, activities] = await Promise.all([
                    getVoiceProfileAlerts().catch(() => [] as VoiceAlert[]),
                    getRecentActivities(10).catch(() => [] as ActivityLog[])
                ]);
                if (isMounted) {
                    setData(prev => ({
                        ...prev,
                        voiceAlerts,
                        activities
                    }));
                }
            } catch (e) {
                console.error('[useDashboardData] Initial fetch error:', e);
            }
        };

        loadInitialData();

        // 1. Real-time Projects Listener
        const unsubscribeProjects = onSnapshot(collection(db, 'projects'), (snapshot) => {
            const projects = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Project[];

            const stats: DashboardStats = {
                projectsCompleted: projects.filter(p => p.status === 'completed').length,
                projectsInProgress: projects.filter(p => p.status === 'in_progress').length,
                projectsNew: projects.filter(p => p.status === 'pending').length,
                projectsUrgent: projects.filter(p => p.isUrgent || p.status === 'blocked').length
            };

            const alerts: Alert[] = projects
                .filter(p => p.isUrgent || p.status === 'blocked')
                .slice(0, 5)
                .map(p => ({
                    id: p.id,
                    code: p.code,
                    title: p.name,
                    status: p.status === 'blocked' ? 'blocked' : 'urgent',
                    label: p.status === 'blocked' ? 'Bloqué' : 'Urgent'
                }));

            const categoryCount: Record<string, number> = {};
            projects.forEach(p => {
                categoryCount[p.category] = (categoryCount[p.category] || 0) + 1;
            });
            const categoryData: CategoryData[] = Object.entries(categoryCount).map(([cat, count]) => ({
                name: CATEGORY_LABELS[cat as Category] || cat,
                value: count,
                color: CATEGORY_COLORS[cat as Category] || '#64748b'
            }));

            const now = new Date();
            const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
            const buckets = Array(6).fill(null).map((_, index) => {
                const i = 5 - index;
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                return {
                    name: monthNames[d.getMonth()],
                    completed: 0,
                    new: 0,
                };
            });

            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();

            const getBucketIndex = (dateField: any) => {
                const date = safeDate(dateField);
                if (!date) return -1;
                const diff = (currentYear - date.getFullYear()) * 12 + (currentMonth - date.getMonth());
                if (diff >= 0 && diff <= 5) return 5 - diff;
                return -1;
            };

            projects.forEach(p => {
                const completedIndex = getBucketIndex(p.dateCompleted);
                if (completedIndex !== -1) buckets[completedIndex].completed++;
                const createdIndex = getBucketIndex(p.dateCreated);
                if (createdIndex !== -1) buckets[createdIndex].new++;
            });

            const recentProjects = [...projects]
                .sort((a, b) => {
                    const dateA = safeDate(a.dateUpdated)?.getTime() || 0;
                    const dateB = safeDate(b.dateUpdated)?.getTime() || 0;
                    return dateB - dateA;
                })
                .slice(0, 5);

            if (isMounted) {
                setData(prev => ({
                    ...prev,
                    stats,
                    alerts,
                    categoryData,
                    progressData: buckets,
                    recentProjects,
                    loading: false
                }));
            }
        }, (error) => {
            console.error('[useDashboardData] Projects listener error:', error);
            showError('Erreur de chargement en direct des projets');
            if (isMounted) {
                setData(prev => ({ ...prev, loading: false, error: 'Erreur projets' }));
            }
        });

        // 2. Real-time Pending PVs Listener
        const meetingsQuery = query(
            collection(db, 'meetings'),
            where('status', '==', 'completed')
        );
        const unsubscribeMeetings = onSnapshot(meetingsQuery, (snapshot) => {
            const count = snapshot.docs.filter(doc => {
                const data = doc.data();
                return data.pvStatus !== 'finalized' && data.pvStatus !== 'approved';
            }).length;
            if (isMounted) {
                setData(prev => ({
                    ...prev,
                    pendingPVs: count
                }));
            }
        }, (error) => {
            console.error('[useDashboardData] Meetings listener error:', error);
        });

        // 3. Real-time Next Meeting Listener
        const nextMeetingQuery = query(
            collection(db, 'meetings'),
            where('status', '==', 'scheduled'),
            orderBy('date', 'asc'),
            limit(1)
        );
        const unsubscribeNextMeeting = onSnapshot(nextMeetingQuery, (snapshot) => {
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const meetingData = doc.data();
                if (isMounted) {
                    setData(prev => ({
                        ...prev,
                        nextMeeting: {
                            id: doc.id,
                            ...meetingData,
                            date: safeDate(meetingData.date)?.toISOString() || meetingData.date
                        } as Meeting
                    }));
                }
            } else {
                if (isMounted) {
                    setData(prev => ({ ...prev, nextMeeting: null }));
                }
            }
        }, (error) => {
            console.warn('[useDashboardData] Real-time next meeting query failed, falling back to all:', error);
            // Fallback: list all scheduled meetings and sort client-side
            const allMeetingsQuery = query(
                collection(db, 'meetings'),
                where('status', '==', 'scheduled')
            );
            unsubscribeAllScheduled = onSnapshot(allMeetingsQuery, (snapshot) => {
                const sorted = snapshot.docs
                    .map(doc => ({
                        id: doc.id,
                        ...doc.data(),
                        date: safeDate(doc.data().date)?.toISOString() || doc.data().date
                    }))
                    .filter((m: any) => safeDate(m.date) && safeDate(m.date)! > new Date())
                    .sort((a: any, b: any) => {
                        const dateA = safeDate(a.date)?.getTime() || 0;
                        const dateB = safeDate(b.date)?.getTime() || 0;
                        return dateA - dateB;
                    });
                if (isMounted) {
                    setData(prev => ({
                        ...prev,
                        nextMeeting: sorted.length > 0 ? (sorted[0] as Meeting) : null
                    }));
                }
            });
        });

        // 4. Real-time Verification Queue Listener
        const verificationQuery = query(
            collection(db, 'verification_queue'),
            where('status', '==', 'pending')
        );
        const unsubscribeVerification = onSnapshot(verificationQuery, (snapshot) => {
            if (isMounted) {
                setData(prev => ({
                    ...prev,
                    verificationCount: snapshot.size
                }));
            }
        }, (error) => {
            console.error('[useDashboardData] Verification queue listener error:', error);
        });

        return () => {
            isMounted = false;
            unsubscribeProjects();
            unsubscribeMeetings();
            unsubscribeNextMeeting();
            unsubscribeVerification();
            if (unsubscribeAllScheduled) {
                unsubscribeAllScheduled();
            }
        };
    }, []);

    return data;
};
