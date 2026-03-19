export type RecommendationStatus = 'pending' | 'accepted' | 'rejected' | 'modified' | 'deferred';

export interface CouncilRecommendation {
    id: string;
    projectId?: string; // Optional link to a project
    projectName?: string; // Denormalized for easier display
    meetingId?: string; // Optional link to a CCE meeting
    meetingDate?: string; // Date of the CCE meeting
    description: string; // The legacy combined text representation
    resolutions?: {
        number: string;
        title: string;
        text: string;
    }[]; // The new structured representation for multiple resolutions
    dateSent: string; // ISO Date string
    councilMeetingDate?: string; // ISO Date string
    councilResolutionNumber?: string;
    sourceResolutionNumber?: string; // from CCE minutes
    sourceResolutionContent?: string; // from CCE minutes
    status: RecommendationStatus;
    notes?: string;
    councilFeedbackAttachment?: {
        url: string;
        name: string;
        uploadedAt: string;
    };
    attachments?: {
        url: string;
        name: string;
        uploadedAt: string;
        resolutionNumber?: string;
    }[];
    createdBy: string;
    createdAt: string;
    updatedAt: string;

    // Advisory Content (Aide à la Décision)
    impactAnalysis?: {
        financial?: string; // Estimated cost or impact
        social?: 'low' | 'medium' | 'high';
        implementationEffort?: 'low' | 'medium' | 'high';
        environmentalImpact?: 'positive' | 'neutral' | 'negative';
    };

    strategicLinks?: {
        policyId?: string; // Link to a strategic policy
        policyName?: string; // e.g. "Politique de l'Arbre 2023"
        regulationArticle?: string; // e.g. "Article 4.3"
    }[];
}
