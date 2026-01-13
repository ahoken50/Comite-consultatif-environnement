/**
 * Application Constants
 * Centralized magic strings and default values
 */

// ============================================
// STATUS CONSTANTS
// ============================================

/** Transcription status values */
export const TranscriptionStatus = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    ERROR: 'error'
} as const;

export type TranscriptionStatusType = typeof TranscriptionStatus[keyof typeof TranscriptionStatus];

/** Meeting status values */
export const MeetingStatus = {
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
} as const;

/** Meeting status display labels (French) */
export const MeetingStatusLabels: Record<string, string> = {
    scheduled: 'Planifiée',
    in_progress: 'En cours',
    completed: 'Terminée',
    cancelled: 'Annulée'
};

/** Project status values */
export const ProjectStatus = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    BLOCKED: 'blocked',
    CANCELLED: 'cancelled'
} as const;

/** Project status display labels (French) */
export const ProjectStatusLabels: Record<string, string> = {
    pending: 'En attente',
    in_progress: 'En cours',
    completed: 'Terminé',
    blocked: 'Bloqué',
    cancelled: 'Annulé'
};

/** Minutes draft status */
export const DraftStatus = {
    DRAFT: 'draft',
    REVIEWED: 'reviewed',
    FINAL: 'final'
} as const;

/** Approval status */
export const ApprovalStatus = {
    DRAFT: 'draft',
    WAITING_APPROVAL: 'waiting_approval',
    APPROVED: 'approved',
    FINAL: 'final'
} as const;

// ============================================
// DEFAULT VALUES
// ============================================

export const Defaults = {
    /** Default presenter name */
    PRESENTER: 'Coordonnateur',

    /** Default agenda item duration in minutes */
    DURATION_MINUTES: 15,

    /** API timeout in milliseconds (9 minutes for AI operations) */
    API_TIMEOUT_MS: 540000,

    /** Short API timeout in milliseconds (5 minutes) */
    API_TIMEOUT_SHORT_MS: 300000,

    /** Whisper transcription timeout (1 hour) */
    TRANSCRIPTION_TIMEOUT_MS: 3600000,

    /** Maximum output tokens for AI */
    MAX_OUTPUT_TOKENS: 32000,

    /** Default quorum for meetings */
    QUORUM_REQUIRED: 3,

    /** Toast notification duration in ms */
    TOAST_DURATION_MS: 5000,

    /** Error toast duration in ms */
    TOAST_ERROR_DURATION_MS: 6000
} as const;

// ============================================
// CATEGORY CONSTANTS
// ============================================

/** Project categories */
export const ProjectCategories = {
    WATER: 'water',
    BIODIVERSITY: 'biodiversity',
    REGULATION: 'regulation',
    WASTE: 'waste',
    EMERGENCY: 'emergency',
    INNOVATION: 'innovation',
    OPERATIONS: 'operations',
    CLIMATE: 'climate'
} as const;

/** Category display labels (French) */
export const CategoryLabels: Record<string, string> = {
    water: 'Eau',
    biodiversity: 'Biodiversité',
    regulation: 'Réglementation',
    waste: 'Déchets',
    emergency: 'Urgence',
    innovation: 'Innovation',
    operations: 'Opérations',
    climate: 'Climat'
};

/** Category colors for charts */
export const CategoryColors: Record<string, string> = {
    water: '#0ea5e9',
    biodiversity: '#22c55e',
    regulation: '#8b5cf6',
    waste: '#f97316',
    emergency: '#ef4444',
    innovation: '#06b6d4',
    operations: '#64748b',
    climate: '#eab308'
};

// ============================================
// ROLE CONSTANTS
// ============================================

export const Roles = {
    PRESIDENT: 'Président(e)',
    VICE_PRESIDENT: 'Vice-président(e)',
    SECRETARY: 'Secrétaire',
    COORDINATOR: 'Coordonnateur',
    MEMBER: 'Membre',
    ADVISOR: 'Conseiller responsable'
} as const;

/** Role labels for English keys to French display */
export const RoleLabels: Record<string, string> = {
    president: 'Président(e)',
    vice_president: 'Vice-président(e)',
    secretary: 'Secrétaire',
    coordinator: 'Coordonnateur',
    member: 'Membre',
    observer: 'Observateur',
    elected_official: 'Élu(e)',
    advisor: 'Conseiller responsable',
    guest: 'Invité(e)',
    // Fallback for already French values
    'Président(e)': 'Président(e)',
    'Vice-président(e)': 'Vice-président(e)',
    'Secrétaire': 'Secrétaire',
    'Coordonnateur': 'Coordonnateur',
    'Membre': 'Membre',
    'Invité': 'Invité(e)',
    'Élu(e)': 'Élu(e)'
};

/** Helper to get French role label */
export const getRoleLabel = (role: string): string => {
    return RoleLabels[role] || RoleLabels[role.toLowerCase()] || role;
};

// ============================================
// ERROR MESSAGES (User-friendly)
// ============================================

export const ErrorMessages = {
    // API & Configuration
    API_KEY_MISSING: 'La configuration de l\'API est incomplète. Veuillez contacter l\'administrateur.',
    API_ERROR: 'Une erreur s\'est produite lors de la communication avec le serveur.',

    // Transcription
    TRANSCRIPTION_FAILED: 'La transcription a échoué. Veuillez réessayer ou contacter le support.',
    TRANSCRIPTION_TIMEOUT: 'La transcription prend plus de temps que prévu. Elle continuera en arrière-plan.',

    // Documents
    DRAFT_NOT_FOUND: 'Aucun brouillon n\'existe pour cette réunion.',
    PARSE_ERROR: 'Erreur lors de l\'analyse du document. Vérifiez le format du fichier.',
    UPLOAD_FAILED: 'Échec du téléversement. Veuillez réessayer.',

    // Network
    NETWORK_ERROR: 'Erreur de connexion. Vérifiez votre accès internet.',
    TIMEOUT_ERROR: 'La requête a pris trop de temps. Veuillez réessayer.',

    // Authentication
    AUTH_REQUIRED: 'Vous devez être connecté pour effectuer cette action.',
    PERMISSION_DENIED: 'Vous n\'avez pas les permissions nécessaires.',

    // Generic
    UNKNOWN: 'Une erreur inattendue s\'est produite.',
    VALIDATION_ERROR: 'Les données saisies sont invalides.',
    NOT_FOUND: 'L\'élément demandé n\'existe pas ou a été supprimé.'
} as const;

// ============================================
// SUCCESS MESSAGES
// ============================================

export const SuccessMessages = {
    SAVED: 'Modifications enregistrées avec succès.',
    DELETED: 'Élément supprimé avec succès.',
    UPLOADED: 'Fichier téléversé avec succès.',
    TRANSCRIPTION_STARTED: 'Transcription démarrée. Vous serez notifié une fois terminée.',
    TRANSCRIPTION_COMPLETED: 'Transcription terminée avec succès.',
    DRAFT_GENERATED: 'Brouillon généré avec succès.',
    PDF_GENERATED: 'PDF généré avec succès.'
} as const;

// ============================================
// MINUTE ENTRY TYPES
// ============================================

export const MinuteEntryType = {
    RESOLUTION: 'resolution',
    COMMENT: 'comment'
} as const;

export const MinuteEntryLabels: Record<string, string> = {
    resolution: 'Résolution',
    comment: 'Commentaire'
};

// ============================================
// AGENDA OBJECTIVES
// ============================================

export const AgendaObjectives = {
    INFORMATION: 'Information',
    DECISION: 'Décision',
    CONSULTATION: 'Consultation',
    ADOPTION: 'Adoption'
} as const;
