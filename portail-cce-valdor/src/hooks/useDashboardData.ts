import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getRecentActivities } from '../services/activityLogService';
import { safeDate } from '../utils/dateUtils';
import { useToast } from './useToast';
import type { Project, Category } from '../types/project.types';
import type { Meeting } from '../types/meeting.types';
import type { ActivityLog } from '../types/activityLog.types';
import { getVoiceProfileAlerts, getVerificationQueueCount, getPendingPVCount, type VoiceAlert } from '../services/voiceAlertService';

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
        const fetchDashboardData = async () => {
            try {
                // ... (existing code) ...
                // 1. Fetch all projects
                const projectsSnapshot = await getDocs(collection(db, 'projects'));
                const projects = projectsSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Project[];

                // 2. Calculate stats
                const stats: DashboardStats = {
                    projectsCompleted: projects.filter(p => p.status === 'completed').length,
                    projectsInProgress: projects.filter(p => p.status === 'in_progress').length,
                    projectsNew: projects.filter(p => p.status === 'pending').length,
                    projectsUrgent: projects.filter(p => p.isUrgent || p.status === 'blocked').length
                };

                // 3. Calculate alerts (urgent or blocked projects)
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

                // 4. Calculate category distribution
                const categoryCount: Record<string, number> = {};
                projects.forEach(p => {
                    categoryCount[p.category] = (categoryCount[p.category] || 0) + 1;
                });
                const categoryData: CategoryData[] = Object.entries(categoryCount).map(([cat, count]) => ({
                    name: CATEGORY_LABELS[cat as Category] || cat,
                    value: count,
                    color: CATEGORY_COLORS[cat as Category] || '#64748b'
                }));

                // 5. Calculate monthly progress (last 6 months)
                const now = new Date();
                const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

                // Optimization: Pre-calculate buckets and iterate projects once (O(N)) instead of filtering inside loop (O(N*M))
                const buckets = Array(6).fill(null).map((_, index) => {
                    const i = 5 - index; // 5 down to 0
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
                    if (diff >= 0 && diff <= 5) {
                        return 5 - diff;
                    }
                    return -1;
                };

                projects.forEach(p => {
                    const completedIndex = getBucketIndex(p.dateCompleted);
                    if (completedIndex !== -1) {
                        buckets[completedIndex].completed++;
                    }

                    const createdIndex = getBucketIndex(p.dateCreated);
                    if (createdIndex !== -1) {
                        buckets[createdIndex].new++;
                    }
                });

                const progressData: ProgressData[] = buckets;

                // 6. Fetch next scheduled meeting
                let nextMeeting: Meeting | null = null;
                try {
                    const meetingsQuery = query(
                        collection(db, 'meetings'),
                        where('status', '==', 'scheduled'),
                        orderBy('date', 'asc'),
                        limit(1)
                    );
                    const meetingsSnapshot = await getDocs(meetingsQuery);
                    if (!meetingsSnapshot.empty) {
                        const doc = meetingsSnapshot.docs[0];
                        const meetingData = doc.data();
                        nextMeeting = {
                            id: doc.id,
                            ...meetingData,
                            date: safeDate(meetingData.date)?.toISOString() || meetingData.date
                        } as Meeting;
                    }
                } catch (e) {
                    // If query fails (e.g., missing index), try without orderBy
                    console.warn('Meetings query failed, trying fallback:', e);
                    const meetingsSnapshot = await getDocs(collection(db, 'meetings'));
                    const meetings = meetingsSnapshot.docs
                        .map(doc => ({
                            id: doc.id,
                            ...doc.data(),
                            date: safeDate(doc.data().date)?.toISOString() || doc.data().date
                        }))
                        .filter((m: any) => m.status === 'scheduled' && safeDate(m.date) && safeDate(m.date)! > new Date())
                        .sort((a: any, b: any) => {
                            const dateA = safeDate(a.date)?.getTime() || 0;
                            const dateB = safeDate(b.date)?.getTime() || 0;
                            return dateA - dateB;
                        });

                    if (meetings.length > 0) {
                        nextMeeting = meetings[0] as Meeting;
                    }
                }

                // 7. Fetch recent activities
                const activities = await getRecentActivities(10);

                // 8. Get recently modified projects (#1.2)
                const recentProjects = [...projects]
                    .sort((a, b) => {
                        const dateA = safeDate(a.dateUpdated)?.getTime() || 0;
                        const dateB = safeDate(b.dateUpdated)?.getTime() || 0;
                        return dateB - dateA;
                    })
                    .slice(0, 5);

                // 9. Fetch voice profile alerts & pending actions (parallel, non-blocking)
                const [voiceAlerts, pendingPVs, verificationCount] = await Promise.all([
                    getVoiceProfileAlerts().catch(() => [] as VoiceAlert[]),
                    getPendingPVCount().catch(() => 0),
                    getVerificationQueueCount().catch(() => 0),
                ]);

                setData({
                    stats,
                    alerts,
                    nextMeeting,
                    categoryData,
                    progressData,
                    activities,
                    recentProjects,
                    voiceAlerts,
                    pendingPVs,
                    verificationCount,
                    loading: false,
                    error: null
                });

            } catch (error) {
                console.error('Error fetching dashboard data:', error);

                // Show toast notification
                showError('Erreur lors du chargement du tableau de bord');

                setData(prev => ({
                    ...prev,
                    loading: false,
                    error: 'Erreur lors du chargement des données'
                }));
            }
        };

        fetchDashboardData();
    }, []);

    return data;
};
