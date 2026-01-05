import { useState, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getRecentActivities } from '../services/activityLogService';
import type { Project, Category } from '../types/project.types';
import type { Meeting } from '../types/meeting.types';
import type { ActivityLog } from '../types/activityLog.types';
import type { RootState } from '../store/rootReducer';
import { fetchProjects } from '../features/projects/projectsSlice';
import { fetchMeetings } from '../features/meetings/meetingsSlice';
import type { ThunkDispatch } from '@reduxjs/toolkit';

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
    const dispatch = useDispatch<ThunkDispatch<any, any, any>>();

    // Selectors
    const { items: projects, loading: projectsLoading } = useSelector((state: RootState) => state.projects);
    const { items: meetings, loading: meetingsLoading } = useSelector((state: RootState) => state.meetings);

    const [activities, setActivities] = useState<ActivityLog[]>([]);
    const [activitiesLoading, setActivitiesLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Initial fetch if data is missing
    useEffect(() => {
        if (projects.length === 0) {
            dispatch(fetchProjects());
        }
        if (meetings.length === 0) {
            dispatch(fetchMeetings());
        }
    }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch activities (not in Redux)
    useEffect(() => {
        const fetchActivities = async () => {
            try {
                const recent = await getRecentActivities(10);
                setActivities(recent);
            } catch (err) {
                console.error('Error fetching activities:', err);
                setError('Erreur lors du chargement des activités');
            } finally {
                setActivitiesLoading(false);
            }
        };
        fetchActivities();
    }, []);

    // Derived State using useMemo
    const dashboardStats = useMemo(() => {
        // 1. Stats
        const stats: DashboardStats = {
            projectsCompleted: projects.filter(p => p.status === 'completed').length,
            projectsInProgress: projects.filter(p => p.status === 'in_progress').length,
            projectsNew: projects.filter(p => p.status === 'pending').length,
            projectsUrgent: projects.filter(p => p.isUrgent || p.status === 'blocked').length
        };

        // 2. Alerts (urgent or blocked projects)
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

        // 3. Category distribution
        const categoryCount: Record<string, number> = {};
        projects.forEach(p => {
            categoryCount[p.category] = (categoryCount[p.category] || 0) + 1;
        });
        const categoryData: CategoryData[] = Object.entries(categoryCount).map(([cat, count]) => ({
            name: CATEGORY_LABELS[cat as Category] || cat,
            value: count,
            color: CATEGORY_COLORS[cat as Category] || '#64748b'
        }));

        // 4. Monthly progress (last 6 months)
        const now = new Date();
        const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

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

        // Helper to safely parse dates (handles Strings and Firestore Timestamps)
        const getDate = (dateField: any): Date | null => {
            if (!dateField) return null;
            if (dateField.toDate) return dateField.toDate();
            return new Date(dateField);
        };

        const getBucketIndex = (dateField: any) => {
            const date = getDate(dateField);
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

        // 5. Next scheduled meeting
        let nextMeeting: Meeting | null = null;
        const nowTime = now.getTime();

        // Filter upcoming scheduled meetings
        const upcoming = meetings
            .filter(m => m.status === 'scheduled')
            .map(m => ({
                 ...m,
                 _dateObj: getDate(m.date)
            }))
            .filter(m => m._dateObj && m._dateObj.getTime() > nowTime)
            .sort((a, b) => a._dateObj!.getTime() - b._dateObj!.getTime());

        if (upcoming.length > 0) {
            // Remove the temporary _dateObj
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { _dateObj, ...rest } = upcoming[0];
            nextMeeting = rest as Meeting;
        }

        return { stats, alerts, categoryData, progressData: buckets, nextMeeting };
    }, [projects, meetings]);

    return {
        ...dashboardStats,
        activities,
        // Only show loading if we have NO data and are fetching
        loading: (projectsLoading && projects.length === 0) || (meetingsLoading && meetings.length === 0) || activitiesLoading,
        error
    };
};
