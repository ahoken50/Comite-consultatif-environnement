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
    limit,
    serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type { Meeting } from '../types/meeting.types';
import type { Member } from '../types/member.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Calculates the deadline for submitting agenda suggestions.
 * Rules:
 * 1. Default: 15 days before the meeting date.
 * 2. Minimum: 5 business days (jours ouvrables) from today.
 * If 15 days before the meeting is earlier than 5 business days from today,
 * we extend the deadline to exactly 5 business days from today.
 */
export const calculateDeadlineDate = (meetingDateStr: string): Date => {
    const meetingDate = new Date(meetingDateStr);
    
    // 1. Default deadline: 15 days before the meeting
    const defaultDeadline = new Date(meetingDate);
    defaultDeadline.setDate(defaultDeadline.getDate() - 15);
    
    // 2. Minimum deadline: 5 business days (jours ouvrables) from today
    const today = new Date();
    let minDeadline = new Date(today);
    let businessDaysAdded = 0;
    while (businessDaysAdded < 5) {
        minDeadline.setDate(minDeadline.getDate() + 1);
        const dayOfWeek = minDeadline.getDay();
        // 0 = Sunday, 6 = Saturday
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            businessDaysAdded++;
        }
    }
    
    // Set to end of day to give members as much time
    minDeadline.setHours(23, 59, 59, 999);
    
    // Return the further date
    return defaultDeadline > minDeadline ? defaultDeadline : minDeadline;
};

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
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
        const formattedDate = format(meetingDate, 'EEEE d MMMM yyyy', { locale: fr });
        const formattedTime = "17 h 00"; // CCE meetings are always at 17h00
        console.log('📅 [Convocation] Date debug:', {
            rawDate: meeting.date,
            parsedDate: meetingDate.toISOString(),
            localString: meetingDate.toString(),
            formattedDate,
            formattedTime,
            timezoneOffset: meetingDate.getTimezoneOffset()
        });

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
                    formattedDate: formattedDate,
                    formattedTime: formattedTime,
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

        // 2. Calculate deadline date (15 days before meeting, with min 5 business days from today)
        const meetingDate = new Date(meeting.date);
        const deadlineDate = calculateDeadlineDate(meeting.date);

        // 3. Format dates
        const formattedMeetingDate = format(meetingDate, 'EEEE d MMMM yyyy', { locale: fr });
        const formattedDeadline = format(deadlineDate, 'EEEE d MMMM yyyy', { locale: fr });

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
 * Get the latest convocation state (merging all previous convocations)
 * This ensures we don't lose members if they were invited in separate batches.
 */
export const getLatestConvocation = async (meetingId: string): Promise<Convocation | null> => {
    const convocationsRef = collection(db, 'meetings', meetingId, 'convocations');
    // Get all convocations ordered by date
    const q = query(convocationsRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    // Map to store unique recipients by email (or memberId)
    // We use email as key to handle potential duplicate invites by overwriting with latest status
    const recipientsMap = new Map<string, ConvocationRecipient>();
    let latestDoc: any = null;

    // Iterate through all convocations (oldest to newest)
    snapshot.docs.forEach(doc => {
        const data = doc.data() as Convocation;
        latestDoc = { id: doc.id, ...data }; // Keep track of the latest document details

        if (data.recipients) {
            data.recipients.forEach(recipient => {
                recipientsMap.set(recipient.email, recipient);
            });
        }
    });

    if (!latestDoc) return null;

    // Return a synthetic convocation object with merged recipients
    return {
        ...latestDoc,
        recipients: Array.from(recipientsMap.values())
    };
};

/**
 * Check if ANY convocation (Avis or Regular) has been sent
 * Used for the checklist status
 */
export const hasAnyConvocation = async (meetingId: string): Promise<boolean> => {
    try {
        // Check for regular convocations (limit 1 is sufficient and faster)
        const convocationsRef = collection(db, 'meetings', meetingId, 'convocations');
        const convSnapshot = await getDocs(query(convocationsRef, limit(1)));

        if (!convSnapshot.empty) return true;

        // Check for avis convocations (Phase 1)
        const avisRef = collection(db, 'meetings', meetingId, 'avis_convocations');
        const avisSnapshot = await getDocs(query(avisRef, limit(1)));

        return !avisSnapshot.empty;
    } catch (error) {
        console.error('Error checking convocation status:', error);
        return false;
    }
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
        // Find convocation containing this token
        // Use a broad search across all convocations for this meeting
        const convocationsRef = collection(db, 'meetings', meetingId, 'convocations');
        const snapshot = await getDocs(convocationsRef);

        let targetConvocation: Convocation | null = null;
        let recipientIndex = -1;

        for (const doc of snapshot.docs) {
            const data = doc.data() as Convocation;
            const idx = data.recipients.findIndex(r => r.token === token);
            if (idx !== -1) {
                targetConvocation = { ...data, id: doc.id };
                recipientIndex = idx;
                break;
            }
        }

        if (!targetConvocation || recipientIndex === -1) {
            return { success: false, error: 'Token invalide ou expiré' };
        }

        // Update the recipient's response
        const updatedRecipients = [...targetConvocation.recipients];
        updatedRecipients[recipientIndex] = {
            ...updatedRecipients[recipientIndex],
            status: response,
            respondedAt: new Date().toISOString()
        };

        await updateDoc(
            doc(db, 'meetings', meetingId, 'convocations', targetConvocation.id!),
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

        // Find convocation containing this token
        const convocationsRef = collection(db, 'meetings', meetingId, 'convocations');
        const snapshot = await getDocs(convocationsRef);

        let targetRecipient: ConvocationRecipient | null = null;

        for (const doc of snapshot.docs) {
            const data = doc.data() as Convocation;
            const found = data.recipients.find(r => r.token === token);
            if (found) {
                targetRecipient = found;
                break;
            }
        }

        if (!targetRecipient) {
            return { success: false, error: 'Invitation invalide' };
        }

        return {
            success: true,
            meeting: {
                title: meeting.title,
                date: meeting.date,
                location: meeting.location || 'Ville de Val-d\'Or'
            },
            recipientName: targetRecipient.name,
            currentStatus: targetRecipient.status
        };
    } catch (error) {
        console.error('Error getting RSVP details:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
    }
};

/**
 * Resend convocation emails to specific recipients (reminders)
 * This calls the cloud function directly without creating a new convocation record
 */
export const resendConvocationEmails = async (
    meeting: Meeting,
    convocationId: string,
    recipients: ConvocationRecipient[],
    senderMember: Member
): Promise<{ success: boolean; error?: string }> => {
    try {
        console.log('📨 Resending convocation emails (reminder)...', {
            meetingId: meeting.id,
            recipientsCount: recipients.length
        });

        const functions = getFunctions();
        const sendConvocationEmails = httpsCallable(functions, 'send_convocation');

        // Regenerate PDF if needed
        let pdfBase64 = null;
        try {
            pdfBase64 = await generateAgendaPDFBase64(meeting);
        } catch (e) {
            console.warn("Could not regenerate PDF for reminder", e);
        }

        const meetingDate = new Date(meeting.date);
        const formattedDate = format(meetingDate, 'EEEE d MMMM yyyy', { locale: fr });
        const formattedTime = "17 h 00"; // CCE meetings are always at 17h00
        console.log('📅 [Resend Convocation] Date debug:', {
            rawDate: meeting.date,
            formattedDate,
            formattedTime
        });

        await sendConvocationEmails({
            meetingId: meeting.id,
            convocationId: convocationId,
            meeting: {
                title: meeting.title,
                date: meeting.date,
                formattedDate: formattedDate,
                formattedTime: formattedTime,
                location: meeting.location,
                agendaItems: meeting.agendaItems
            },
            recipients: recipients.map(r => ({
                email: r.email,
                name: r.name,
                token: r.token, // Reuse existing token
                memberId: r.memberId
            })),
            sender: {
                name: senderMember.displayName,
                email: senderMember.email
            },
            agendaPdf: pdfBase64
        });

        console.log('✅ Resend success');
        return { success: true };

    } catch (error) {
        console.error('Error resending convocations:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erreur lors du renvoi'
        };
    }
};
