import { z } from 'zod';
import { MeetingType, MeetingStatus } from '../types/meeting.types';

// ==========================================
// Base Enums & Types
// ==========================================

export const MeetingTypeSchema = z.enum([
    MeetingType.REGULAR,
    MeetingType.SPECIAL,
    MeetingType.URGENT,
    MeetingType.CIRCULAR
]);

export const MeetingStatusSchema = z.enum([
    MeetingStatus.SCHEDULED,
    MeetingStatus.IN_PROGRESS,
    MeetingStatus.COMPLETED,
    MeetingStatus.CANCELLED
]);

// ==========================================
// Minute Entries (Resolutions / Comments)
// ==========================================

export const MinuteEntrySchema = z.object({
    type: z.enum(['resolution', 'comment']),
    number: z.string().default(''),
    content: z.string(),
    proposer: z.string().optional(),
    seconder: z.string().optional()
});

// ==========================================
// Agenda Items
// ==========================================

export const AgendaItemSchema = z.object({
    id: z.string(),
    order: z.number().optional(),
    title: z.string(),
    description: z.string().default(''),
    duration: z.number().default(0),
    presenter: z.string().default(''),
    objective: z.string().default('Information'),
    agendaNote: z.string().optional(),

    // Legacy / Compat
    decision: z.string().optional(),
    minuteType: z.enum(['resolution', 'comment', 'other']).optional(),
    minuteNumber: z.string().optional(),
    proposer: z.string().optional(),
    seconder: z.string().optional(),
    minuteContent: z.string().optional(),

    // New Structured Entries
    minuteEntries: z.array(MinuteEntrySchema).optional().default([]),
    linkedProjectId: z.string().optional()
});

// ==========================================
// Attendees & Signatures
// ==========================================

export const AttendeeSchema = z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    isPresent: z.boolean()
});

export const ApprovalSignatureSchema = z.object({
    role: z.enum(['president', 'elected_official', 'coordinator', 'admin_bypass', 'member', 'vice_president']),
    signedBy: z.string(),
    signedByName: z.string(),
    signedAt: z.string(), // ISO Date
    consentType: z.enum(['digital', 'email']).optional(),
    emailConsentText: z.string().optional()
});

// ==========================================
// Meeting
// ==========================================

export const AudioRecordingSchema = z.object({
    fileUrl: z.string(),
    fileName: z.string(),
    storagePath: z.string(),
    fileSize: z.number(),
    duration: z.number(),
    mimeType: z.string(),
    uploadedAt: z.string(),
    transcription: z.string().optional(),
    transcriptionStatus: z.enum(['pending', 'processing', 'completed', 'error']),
    transcriptionError: z.string().optional(),
    transcribedAt: z.string().optional()
});

export const MinutesDraftSchema = z.object({
    content: z.string(),
    generatedAt: z.string(),
    status: z.enum(['draft', 'reviewed', 'final']),
    version: z.number(),
    userFeedback: z.string().optional(),
    finalizedAt: z.string().optional()
});

export const MeetingSchema = z.object({
    id: z.string(),
    title: z.string(),
    date: z.string(),
    location: z.string(),
    type: MeetingTypeSchema,
    status: MeetingStatusSchema,

    isConfidential: z.boolean().optional(),

    attendees: z.array(AttendeeSchema),
    agendaItems: z.array(AgendaItemSchema),

    // Simplification: Not validating RSVPs deeply here as it's not core to PV
    quorumRequired: z.number().optional(),
    projectedQuorum: z.number().optional(),

    minutes: z.string(), // HTML Content
    minutesFileUrl: z.string().optional(),
    minutesFileName: z.string().optional(),
    minutesFileStoragePath: z.string().optional(),
    minutesFileDocumentId: z.string().optional(),

    audioRecording: AudioRecordingSchema.optional(),
    minutesDraft: MinutesDraftSchema.optional(),

    approvalStatus: z.enum(['draft', 'waiting_approval', 'approved', 'final']).optional(),
    approvalSignatures: z.array(ApprovalSignatureSchema).optional(),
    consignedMeetingId: z.string().optional(),

    dateCreated: z.string(),
    dateUpdated: z.string()
});

// ==========================================
// AI / Sanitization Payload Schemas
// ==========================================

// Schema for the sanitized JSON returned by Claude
export const ClaudeSanitizedResponseSchema = z.object({
    minutes: z.string(),
    attendees: z.array(z.object({
        id: z.string(),
        name: z.string()
    })).optional(),
    agendaItems: z.array(z.object({
        id: z.string(),
        title: z.string(),
        decision: z.string().optional(),
        proposer: z.string().optional(),
        seconder: z.string().optional(),
        minuteEntries: z.array(z.object({
            type: z.enum(['resolution', 'comment']),
            content: z.string(),
            number: z.string().optional()
        })).optional()
    })).optional()
});

export type ClaudeSanitizedResponse = z.infer<typeof ClaudeSanitizedResponseSchema>;
