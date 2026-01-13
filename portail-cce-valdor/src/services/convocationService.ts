/**
 * Convocation Service
 * Handles sending meeting convocations to CCE members
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type { Meeting } from '../types/meeting.types';
import type { Member } from '../types/member.types';

// Types
export interface ConvocationRecipient {
    memberId: string;
    email: string;
    name: string;
    token: string;
    status: 'pending' | 'confirmed' | 'declined';
    sentAt?: string;
    respondedAt?: string;
}

export interface Convocation {
    id?: string;
    meetingId: string;
    sentAt: string;
    sentBy: string;
    sentByName: string;
    pdfUrl?: string;
    recipients: ConvocationRecipient[];
    emailSubject: string;
    emailBody: string;
}

export interface ConvocationStats {
    total: number;
    pending: number;
    confirmed: number;
    declined: number;
}

// Type of convocation email
export type ConvocationType = 'avis' | 'confirmation';

// Avis de convocation (Phase 1)
export interface AvisConvocation {
    id?: string;
    meetingId: string;
    sentAt: string;
    sentBy: string;
    sentByName: string;
    senderEmail: string;
    deadlineDate: string; // Date limite pour suggestions (15 jours avant réunion)
    recipients: { memberId: string; email: string; name: string }[];
    avisLetterPdfUrl?: string;
}

/**
 * Generate a unique RSVP token
 */
const generateToken = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Get all active members to send convocations to
 */
export const getActiveMembers = async (): Promise<Member[]> => {
    const membersRef = collection(db, 'members');
    const q = query(membersRef, where('isActive', '==', true));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as Member));
};

import { generateAgendaPDFBase64 } from './pdfServiceAgenda';

/**
 * Send convocations to selected members (or all active members if none specified)
 */
export const sendConvocations = async (
    meeting: Meeting,
    senderMember: Member,
    selectedMembers?: Member[]
): Promise<{ success: boolean; convocationId?: string; error?: string; sentCount?: number }> => {
    try {
        // 1. Use provided members or get all active members
        const members = selectedMembers && selectedMembers.length > 0
            ? selectedMembers
            : await getActiveMembers();

        if (members.length === 0) {
            return { success: false, error: 'Aucun membre sélectionné' };
        }

        // 1.1 Generate Agenda PDF as Base64
        console.log('📄 Generating Agenda PDF for attachment...');
        let pdfBase64 = null;
        try {
            pdfBase64 = await generateAgendaPDFBase64(meeting);
        } catch (pdfError) {
            console.error("⚠️ Failed to generate agenda PDF, sending without attachment:", pdfError);
        }

        // 2. Prepare recipients with tokens
        const recipients: ConvocationRecipient[] = members.map(member => ({
            memberId: member.id,
            email: member.email,
            name: member.displayName,
            token: generateToken(),
            status: 'pending' as const
        }));

        // 3. Format meeting date
        const meetingDate = new Date(meeting.date);
        const dateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        const formattedDate = meetingDate.toLocaleDateString('fr-CA', dateOptions);
        const formattedTime = meetingDate.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

        // 4. Create convocation record in Firestore
        const convocationData: Omit<Convocation, 'id'> = {
            meetingId: meeting.id,
            sentAt: new Date().toISOString(),
            sentBy: senderMember.id,
            sentByName: senderMember.displayName,
            recipients,
            emailSubject: `Ordre du jour du CCE – ${formattedDate}`,
            emailBody: `Bonjour,

Vous êtes convoqué(e) à la prochaine assemblée du Comité consultatif en environnement de la Ville de Val-d'Or.

📅 Date : ${formattedDate}
🕐 Heure : ${formattedTime}
📍 Lieu : ${meeting.location || 'Ville de Val-d\'Or'}

L'ordre du jour est joint à ce courriel.

Merci de confirmer votre présence en cliquant sur le lien ci-dessous.

Cordialement,
${senderMember.displayName}
Ville de Val-d'Or`
        };

        const convocationsRef = collection(db, 'meetings', meeting.id, 'convocations');
        const docRef = await addDoc(convocationsRef, {
            ...convocationData,
            createdAt: serverTimestamp()
        });

        // 5. Call Cloud Function to send emails
        console.log('📨 Calling send_convocation cloud function...', {
            meetingId: meeting.id,
            recipientsCount: recipients.length,
            recipients: recipients.map(r => r.email),
            hasAttachment: !!pdfBase64
        });

        const functions = getFunctions();
        const sendConvocationEmails = httpsCallable(functions, 'send_convocation');

        try {
            const result = await sendConvocationEmails({
                meetingId: meeting.id,
                convocationId: docRef.id,
                meeting: {
                    title: meeting.title,
                    date: meeting.date,
                    location: meeting.location,
                    agendaItems: meeting.agendaItems
                },
                recipients: recipients.map(r => ({
                    email: r.email,
                    name: r.name,
                    token: r.token,
                    memberId: r.memberId
                })),
                sender: {
                    name: senderMember.displayName,
                    email: senderMember.email
                },
                agendaPdf: pdfBase64 // Attachment
            });
            console.log('✅ send_convocation success:', result.data);
        } catch (cloudFnError) {
            console.error('❌ Cloud Function error detailed:', cloudFnError);
            // Update convocation with error status but don't fail completely
            await updateDoc(doc(db, 'meetings', meeting.id, 'convocations', docRef.id), {
                emailError: String(cloudFnError)
            });
        }

        return {
            success: true,
            convocationId: docRef.id,
            sentCount: recipients.length
        };

    } catch (error) {
        console.error('Error sending convocations:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
    }
};

/**
 * Send Avis de Convocation (Phase 1)
 * Simple email with meeting date and 15-day deadline for agenda suggestions
 */
export const sendAvisConvocation = async (
    meeting: Meeting,
    senderMember: Member,
    selectedMembers?: Member[]
): Promise<{ success: boolean; avisId?: string; error?: string; sentCount?: number }> => {
    try {
        // 1. Use provided members or get all active members
        const members = selectedMembers && selectedMembers.length > 0
            ? selectedMembers
            : await getActiveMembers();

        if (members.length === 0) {
            return { success: false, error: 'Aucun membre sélectionné' };
        }

        // 2. Calculate deadline date (15 days before meeting)
        const meetingDate = new Date(meeting.date);
        const deadlineDate = new Date(meetingDate);
        deadlineDate.setDate(deadlineDate.getDate() - 15);

        // 3. Format dates
        const dateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        const formattedMeetingDate = meetingDate.toLocaleDateString('fr-CA', dateOptions);
        const formattedDeadline = deadlineDate.toLocaleDateString('fr-CA', dateOptions);

        // 4. Prepare recipients (no tokens needed for avis)
        const recipients = members.map(member => ({
            memberId: member.id,
            email: member.email,
            name: member.displayName
        }));

        // 5. Create avis record in Firestore
        const avisData: Omit<AvisConvocation, 'id'> = {
            meetingId: meeting.id,
            sentAt: new Date().toISOString(),
            sentBy: senderMember.id,
            sentByName: senderMember.displayName,
            senderEmail: senderMember.email,
            deadlineDate: deadlineDate.toISOString(),
            recipients
        };

        const avisRef = collection(db, 'meetings', meeting.id, 'avis_convocations');
        const docRef = await addDoc(avisRef, {
            ...avisData,
            createdAt: serverTimestamp()
        });

        // 6. Call Cloud Function to send avis emails
        console.log('📨 Calling send_avis_convocation cloud function...', {
            meetingId: meeting.id,
            recipientsCount: recipients.length
        });

        const functions = getFunctions();
        const sendAvisEmails = httpsCallable(functions, 'send_avis_convocation');

        try {
            await sendAvisEmails({
                meetingId: meeting.id,
                avisId: docRef.id,
                meeting: {
                    title: meeting.title,
                    date: meeting.date,
                    formattedDate: formattedMeetingDate,
                    location: meeting.location
                },
                deadline: {
                    date: deadlineDate.toISOString(),
                    formattedDate: formattedDeadline
                },
                recipients,
                sender: {
                    name: senderMember.displayName,
                    email: senderMember.email,
                    signatureUrl: senderMember.signatureUrl || null,
                    role: senderMember.role
                }
            });
            console.log('✅ send_avis_convocation success');
        } catch (cloudFnError) {
            console.error('❌ Cloud Function error:', cloudFnError);
            await updateDoc(doc(db, 'meetings', meeting.id, 'avis_convocations', docRef.id), {
                emailError: String(cloudFnError)
            });
        }

        return {
            success: true,
            avisId: docRef.id,
            sentCount: recipients.length
        };

    } catch (error) {
        console.error('Error sending avis convocation:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
    }
};

/**
 * Get the latest convocation for a meeting
 */
export const getLatestConvocation = async (meetingId: string): Promise<Convocation | null> => {
    const convocationsRef = collection(db, 'meetings', meetingId, 'convocations');
    const q = query(convocationsRef, orderBy('sentAt', 'desc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return {
        id: doc.id,
        ...doc.data()
    } as Convocation;
};

/**
 * Get convocation statistics
 */
export const getConvocationStats = async (meetingId: string): Promise<ConvocationStats | null> => {
    const convocation = await getLatestConvocation(meetingId);
    if (!convocation) return null;

    const stats: ConvocationStats = {
        total: convocation.recipients.length,
        pending: 0,
        confirmed: 0,
        declined: 0
    };

    for (const recipient of convocation.recipients) {
        stats[recipient.status]++;
    }

    return stats;
};

/**
 * Update RSVP response (called from public RSVP page)
 */
export const updateRSVP = async (
    meetingId: string,
    token: string,
    response: 'confirmed' | 'declined'
): Promise<{ success: boolean; error?: string }> => {
    try {
        const convocation = await getLatestConvocation(meetingId);
        if (!convocation || !convocation.id) {
            return { success: false, error: 'Convocation non trouvée' };
        }

        const recipientIndex = convocation.recipients.findIndex(r => r.token === token);
        if (recipientIndex === -1) {
            return { success: false, error: 'Token invalide' };
        }

        // Update the recipient's response
        const updatedRecipients = [...convocation.recipients];
        updatedRecipients[recipientIndex] = {
            ...updatedRecipients[recipientIndex],
            status: response,
            respondedAt: new Date().toISOString()
        };

        await updateDoc(
            doc(db, 'meetings', meetingId, 'convocations', convocation.id),
            { recipients: updatedRecipients }
        );

        return { success: true };
    } catch (error) {
        console.error('Error updating RSVP:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
    }
};

/**
 * Get RSVP details by token (for public page)
 */
export const getRSVPDetails = async (
    meetingId: string,
    token: string
): Promise<{
    success: boolean;
    meeting?: { title: string; date: string; location: string };
    recipientName?: string;
    currentStatus?: 'pending' | 'confirmed' | 'declined';
    error?: string
}> => {
    try {
        // Get meeting
        const meetingDoc = await getDoc(doc(db, 'meetings', meetingId));
        if (!meetingDoc.exists()) {
            return { success: false, error: 'Réunion non trouvée' };
        }
        const meeting = meetingDoc.data() as Meeting;

        // Get convocation
        const convocation = await getLatestConvocation(meetingId);
        if (!convocation) {
            return { success: false, error: 'Convocation non trouvée' };
        }

        const recipient = convocation.recipients.find(r => r.token === token);
        if (!recipient) {
            return { success: false, error: 'Token invalide' };
        }

        return {
            success: true,
            meeting: {
                title: meeting.title,
                date: meeting.date,
                location: meeting.location || 'Ville de Val-d\'Or'
            },
            recipientName: recipient.name,
            currentStatus: recipient.status
        };
    } catch (error) {
        console.error('Error getting RSVP details:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
    }
};
