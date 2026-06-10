import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Meeting, ApprovalSignature } from '../types/meeting.types';
import type { Member } from '../types/member.types';

/**
 * Pure calculation function to determine the approval status of a meeting.
 */
export function calculateApprovalStatus(
    meetingType: 'regular' | 'special' | 'circular' | string,
    signatures: ApprovalSignature[],
    approvedTokens: any[],
    activeMembers: Member[]
): 'draft' | 'waiting_approval' | 'approved' {
    const hasAdminBypass = signatures.some(s => s.role === 'admin_bypass') || 
                           approvedTokens.some(t => t.role === 'admin_bypass');
    if (hasAdminBypass) {
        return 'approved';
    }

    if (meetingType === 'circular') {
        const votingMembers = activeMembers.filter(m => 
            m.isActive && ['president', 'vice_president', 'member', 'elected_official'].includes(m.role)
        );
        const getMemberSignature = (memberId: string) => {
            const directSig = signatures.find(s => s.signedBy === memberId);
            if (directSig) return directSig;

            const member = votingMembers.find(m => m.id === memberId);
            const tokenSig = approvedTokens.find(t => 
                t.memberId === memberId || (member?.email && t.email === member.email)
            );
            return tokenSig;
        };

        const totalVoting = votingMembers.length;
        if (totalVoting === 0) return 'draft';
        const signedCount = votingMembers.filter(m => getMemberSignature(m.id)).length;

        if (signedCount === totalVoting) {
            return 'approved';
        } else if (signedCount > 0) {
            return 'waiting_approval';
        } else {
            return 'draft';
        }
    } else {
        // Regular / Special / Urgences
        const hasPresidentSigned = signatures.some(s => s.role === 'president' || s.role === 'vice_president') || 
                                   approvedTokens.some(t => t.role === 'president' || t.role === 'vice_president');
        const hasElectedSigned = signatures.some(s => s.role === 'elected_official') || 
                                 approvedTokens.some(t => t.role === 'elected_official');
        const hasCoordinatorSigned = signatures.some(s => s.role === 'coordinator') || 
                                     approvedTokens.some(t => t.role === 'coordinator');

        if ((hasPresidentSigned || hasElectedSigned) && hasCoordinatorSigned) {
            return 'approved';
        } else if (hasPresidentSigned || hasElectedSigned || hasCoordinatorSigned) {
            return 'waiting_approval';
        } else {
            return 'draft';
        }
    }
}

/**
 * Fetches current signatures, approval tokens and active members for a meeting
 * and synchronizes the computed approvalStatus in Firestore.
 */
export async function syncMeetingApprovalStatus(meetingId: string): Promise<string | null> {
    try {
        const meetingRef = doc(db, 'meetings', meetingId);
        const meetingSnap = await getDoc(meetingRef);

        if (!meetingSnap.exists()) {
            console.warn(`Meeting ${meetingId} not found during approval status sync.`);
            return null;
        }

        const meetingData = meetingSnap.data() as Meeting;
        
        // Fetch approved tokens
        const tokensRef = collection(db, 'meetings', meetingId, 'approval_tokens');
        const tokensSnap = await getDocs(tokensRef);
        const approvedTokens = tokensSnap.docs
            .map(d => d.data())
            .filter(t => t.status === 'approved');

        // Fetch active members
        const membersRef = collection(db, 'members');
        const membersSnap = await getDocs(membersRef);
        const activeMembers = membersSnap.docs.map(d => ({
            id: d.id,
            ...d.data()
        })) as Member[];

        const signatures = meetingData.approvalSignatures || [];
        const newStatus = calculateApprovalStatus(
            meetingData.type || 'regular',
            signatures,
            approvedTokens,
            activeMembers
        );

        if (meetingData.approvalStatus !== 'final' && meetingData.approvalStatus !== newStatus) {
            await updateDoc(meetingRef, {
                approvalStatus: newStatus
            });
            console.log(`Synced meeting ${meetingId} approvalStatus to: ${newStatus}`);
            return newStatus;
        }
        return meetingData.approvalStatus || null;
    } catch (error) {
        console.error(`Error syncing approval status for meeting ${meetingId}:`, error);
        throw error;
    }
}
