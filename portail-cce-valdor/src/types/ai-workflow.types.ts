export interface ExtractedLaw {
    reference: string; // e.g., "Article 22 LQE"
    description: string;
    context: string; // The sentence in the PV
}

export interface ExtractedDeadline {
    date: string;
    task: string;
    responsible: string;
}

export interface PVStructure {
    summary: string;
    agendaItems: {
        id: string;
        title: string;
        resolutionNumber?: string;
        content: string;
    }[];
    resolutions: {
        number: string;
        text: string;
    }[];
    deadlines: ExtractedDeadline[];
    departments: string[];
    laws: ExtractedLaw[];
}

export interface VerificationResult {
    claim: string;
    status: 'verified' | 'warning' | 'info';
    analysis: string;
    source?: string;
    sourceUrl?: string;
}

export interface DraftRecommendation {
    id: string;
    title: string;
    description: string;
    priority: 'Haute' | 'Moyenne' | 'Basse';
    rationale: string; // Why this recommendation?
    sourceResolutionNumber?: string; // Link back to PV
    resolutions?: {
        number: string;
        title: string;
        text: string;
    }[];
}
