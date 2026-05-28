/**
 * Voice Alert Service
 * Monitors voice profile quality for members and provides alerts for the dashboard.
 */

import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VoiceAlert {
    memberId: string;
    memberName: string;
    sampleCount: number;
    quality: 'robuste' | 'acceptable' | 'faible' | 'inexistant';
    percentComplete: number;
    lastUpdate: string | null;
}

export interface MLLoopResult {
    timestamp: string;
    autoLearned: number;
    queuedForReview: number;
    suggestionsGenerated: number;
    mode: string;
    type?: string;
}

// ─── Quality Helpers ─────────────────────────────────────────────────────────

const SAMPLE_TARGET = 10;

export function getQualityBadge(sampleCount: number): VoiceAlert['quality'] {
    if (sampleCount >= 10) return 'robuste';
    if (sampleCount >= 5) return 'acceptable';
    if (sampleCount >= 1) return 'faible';
    return 'inexistant';
}

export function getQualityColor(quality: VoiceAlert['quality']): string {
    switch (quality) {
        case 'robuste': return '#22c55e';
        case 'acceptable': return '#eab308';
        case 'faible': return '#f97316';
        case 'inexistant': return '#ef4444';
    }
}

export function getQualityLabel(quality: VoiceAlert['quality']): string {
    switch (quality) {
        case 'robuste': return 'Robuste';
        case 'acceptable': return 'Acceptable';
        case 'faible': return 'Faible';
        case 'inexistant': return 'Inexistant';
    }
}

// ─── Firestore Queries ───────────────────────────────────────────────────────

/**
 * Get voice profile quality alerts for all members
 */
import { getSupabase } from './supabaseSearchService';

export async function getVoiceProfileAlerts(): Promise<VoiceAlert[]> {
    try {
        const [membersSnapshot, supabaseRes] = await Promise.allSettled([
            getDocs(collection(db, 'members')),
            getSupabase().from('speaker_embeddings').select('speaker_name')
        ]);

        const counts: Record<string, number> = {};
        if (supabaseRes.status === 'fulfilled' && supabaseRes.value.data) {
            supabaseRes.value.data.forEach((row: any) => {
                const name = row.speaker_name?.trim().toLowerCase();
                if (name) {
                    counts[name] = (counts[name] || 0) + 1;
                }
            });
        }

        if (membersSnapshot.status === 'rejected') {
            throw membersSnapshot.reason;
        }

        const alerts: VoiceAlert[] = membersSnapshot.value.docs.map(doc => {
            const data = doc.data();
            const displayName = data.displayName || data.name || '';
            const normalizedName = displayName.trim().toLowerCase();
            
            // Primary count from Supabase speaker_embeddings table, fallback to Firestore cached value
            const sampleCount = counts[normalizedName] !== undefined 
                ? counts[normalizedName] 
                : (data.voiceSampleCount || 0);

            const quality = getQualityBadge(sampleCount);
            return {
                memberId: doc.id,
                memberName: displayName || 'Membre inconnu',
                sampleCount,
                quality,
                percentComplete: Math.min(100, Math.round((sampleCount / SAMPLE_TARGET) * 100)),
                lastUpdate: data.lastVoiceUpdate || null,
            };
        });

        // Sort: worst profiles first
        return alerts.sort((a, b) => a.sampleCount - b.sampleCount);
    } catch (error) {
        console.error('[VoiceAlertService] Error fetching voice alerts:', error);
        return [];
    }
}

/**
 * Get members that need profile improvement (below acceptable threshold)
 */
export async function getMembersNeedingImprovement(): Promise<VoiceAlert[]> {
    const all = await getVoiceProfileAlerts();
    return all.filter(a => a.quality !== 'robuste');
}

/**
 * Get the last ML loop run result
 */
export async function getLastMLLoopResult(): Promise<MLLoopResult | null> {
    try {
        const q = query(
            collection(db, 'ml_metrics'),
            orderBy('timestamp', 'desc'),
            limit(1)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;

        const data = snapshot.docs[0].data();
        return {
            timestamp: data.timestamp || '',
            autoLearned: data.autoLearned || 0,
            queuedForReview: data.queuedForReview || 0,
            suggestionsGenerated: data.suggestionsGenerated || 0,
            mode: data.mode || 'unknown',
            type: data.type,
        };
    } catch (error) {
        console.error('[VoiceAlertService] Error fetching ML loop result:', error);
        return null;
    }
}

/**
 * Count pending items in verification queue
 */
export async function getVerificationQueueCount(): Promise<number> {
    try {
        const q = query(
            collection(db, 'verification_queue'),
            where('status', '==', 'pending')
        );
        const snapshot = await getDocs(q);
        return snapshot.size;
    } catch (error) {
        console.error('[VoiceAlertService] Error fetching verification queue:', error);
        return 0;
    }
}

/**
 * Count meetings that need PV finalization
 */
export async function getPendingPVCount(): Promise<number> {
    try {
        const q = query(
            collection(db, 'meetings'),
            where('status', '==', 'completed')
        );
        const snapshot = await getDocs(q);
        // Filter meetings where PV is not finalized
        return snapshot.docs.filter(doc => {
            const data = doc.data();
            return data.pvStatus !== 'finalized' && data.pvStatus !== 'approved';
        }).length;
    } catch (error) {
        console.error('[VoiceAlertService] Error fetching pending PVs:', error);
        return 0;
    }
}
