import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getRecentActivities } from '../services/activityLogService';
import type { Project, Category } from '../types/project.types';
import type { Meeting } from '../types/meeting.types';
import type { ActivityLog } from '../types/activityLog.types';

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
    const [data, setData] = useState<DashboardData>({
        stats: { projectsCompleted: 0, projectsInProgress: 0, projectsNew: 0, projectsUrgent: 0 },
        alerts: [],
        nextMeeting: null,
        categoryData: [],
        progressData: [],
        activities: [],
        loading: true,
        error: null
    });

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
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
                const progressData: ProgressData[] = [];

                for (let i = 5; i >= 0; i--) {
                    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
                    const monthName = monthNames[monthDate.getMonth()];

                    const completed = projects.filter(p => {
                        if (!p.dateCompleted) return false;
                        const completedDate = new Date(p.dateCompleted);
                        return completedDate >= monthDate && completedDate <= monthEnd;
                    }).length;

                    const newProjects = projects.filter(p => {
                        const createdDate = new Date(p.dateCreated);
                        return createdDate >= monthDate && createdDate <= monthEnd;
                    }).length;

                    progressData.push({ name: monthName, completed, new: newProjects });
                }

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
                            date: meetingData.date?.toDate ? meetingData.date.toDate().toISOString() : meetingData.date
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
                            date: doc.data().date?.toDate ? doc.data().date.toDate().toISOString() : doc.data().date
                        }))
                        .filter((m: any) => m.status === 'scheduled' && new Date(m.date) > new Date())
                        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    if (meetings.length > 0) {
                        nextMeeting = meetings[0] as Meeting;
                    }
                }

                // 7. Fetch recent activities
                const activities = await getRecentActivities(10);

                setData({
                    stats,
                    alerts,
                    nextMeeting,
                    categoryData,
                    progressData,
                    activities,
                    loading: false,
                    error: null
                });

            } catch (error) {
                console.error('Error fetching dashboard data:', error);
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
