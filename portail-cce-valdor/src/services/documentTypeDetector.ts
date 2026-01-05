/**
 * Document Type Detector
 * Analyzes document content to automatically detect the type (agenda, minutes, resolution, etc.)
 */

export type DocumentType = 'agenda' | 'minutes' | 'resolution' | 'report' | 'correspondence' | 'unknown';

export interface DetectionResult {
    type: DocumentType;
    confidence: number; // 0-100
    matches: string[];  // Patterns that matched
    suggestedMeeting?: string; // If we can extract a meeting reference
    suggestedDate?: string;    // If we can extract a date
}

// Pattern definitions for each document type
const PATTERNS: Record<DocumentType, { keywords: string[]; weight: number }[]> = {
    agenda: [
        { keywords: ['ordre du jour', 'odj'], weight: 30 },
        { keywords: ['convocation', 'assemblée'], weight: 20 },
        { keywords: ['points à l\'ordre', 'projet d\'ordre'], weight: 25 },
        { keywords: ['heure d\'ouverture', 'levée de la séance'], weight: 15 },
        { keywords: ['1.', '2.', '3.', '4.'], weight: 10 }
    ],
    minutes: [
        { keywords: ['procès-verbal', 'pv', 'p.v.'], weight: 35 },
        { keywords: ['il est résolu', 'résolution adoptée'], weight: 25 },
        { keywords: ['proposé par', 'appuyé par', 'secondé par'], weight: 20 },
        { keywords: ['présences', 'membres présents'], weight: 15 },
        { keywords: ['adopté à l\'unanimité', 'adopté à la majorité'], weight: 20 }
    ],
    resolution: [
        { keywords: ['résolution', 'cce-'], weight: 30 },
        { keywords: ['considérant que', 'attendu que'], weight: 25 },
        { keywords: ['il est résolu'], weight: 30 },
        { keywords: ['proposé par', 'appuyé par'], weight: 15 },
        { keywords: ['extrait'], weight: 10 }
    ],
    report: [
        { keywords: ['rapport', 'bilan', 'annuel'], weight: 25 },
        { keywords: ['statistiques', 'données'], weight: 15 },
        { keywords: ['recommandations', 'conclusions'], weight: 20 },
        { keywords: ['analyse', 'évaluation'], weight: 15 }
    ],
    correspondence: [
        { keywords: ['lettre', 'correspondance', 'courriel'], weight: 30 },
        { keywords: ['objet:', 'de:', 'à:'], weight: 20 },
        { keywords: ['veuillez agréer', 'cordialement'], weight: 15 }
    ],
    unknown: []
};

// French month names for date extraction
const MONTHS_FR = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

/**
 * Detect document type from text content
 */
export const detectDocumentType = (content: string): DetectionResult => {
    const lowerContent = content.toLowerCase();
    const scores: Record<DocumentType, number> = {
        agenda: 0,
        minutes: 0,
        resolution: 0,
        report: 0,
        correspondence: 0,
        unknown: 0
    };
    const matchedPatterns: string[] = [];

    // Calculate scores for each document type
    (Object.entries(PATTERNS) as [DocumentType, { keywords: string[]; weight: number }[]][]).forEach(([type, patterns]) => {
        patterns.forEach(pattern => {
            const hasMatch = pattern.keywords.some(keyword => lowerContent.includes(keyword));
            if (hasMatch) {
                scores[type] += pattern.weight;
                matchedPatterns.push(...pattern.keywords.filter(k => lowerContent.includes(k)));
            }
        });
    });

    // Find the type with highest score
    let maxScore = 0;
    let detectedType: DocumentType = 'unknown';

    (Object.entries(scores) as [DocumentType, number][]).forEach(([type, score]) => {
        if (score > maxScore) {
            maxScore = score;
            detectedType = type;
        }
    });

    // Calculate confidence (0-100)
    const maxPossibleScore = 100; // Approximation
    const confidence = Math.min(100, Math.round((maxScore / maxPossibleScore) * 100));

    // Try to extract date
    const suggestedDate = extractDate(content);

    // Try to extract meeting reference
    const suggestedMeeting = extractMeetingReference(content);

    return {
        type: confidence >= 20 ? detectedType : 'unknown',
        confidence,
        matches: [...new Set(matchedPatterns)],
        suggestedDate,
        suggestedMeeting
    };
};

/**
 * Extract date from document content
 */
const extractDate = (content: string): string | undefined => {
    // Pattern: "15 janvier 2024" or "15 jan. 2024"
    const datePattern = /(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|jan\.|fév\.|mar\.|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.)\s+(\d{4})/i;

    const match = content.match(datePattern);
    if (match) {
        const day = match[1].padStart(2, '0');
        const monthStr = match[2].toLowerCase().replace('.', '');
        const year = match[3];

        // Convert month name to number
        let month = MONTHS_FR.findIndex(m => m.startsWith(monthStr)) + 1;
        if (month === 0) month = 1;

        return `${year}-${month.toString().padStart(2, '0')}-${day}`;
    }

    return undefined;
};

/**
 * Extract meeting reference from document content
 */
const extractMeetingReference = (content: string): string | undefined => {
    // Pattern: "Assemblée régulière" or "Réunion spéciale"
    const meetingPattern = /(assemblée|réunion)\s+(régulière|spéciale|extraordinaire)/i;

    const match = content.match(meetingPattern);
    if (match) {
        return `${match[1]} ${match[2]}`;
    }

    return undefined;
};

/**
 * Detect document type from file name
 */
export const detectTypeFromFileName = (fileName: string): DetectionResult => {
    const lowerName = fileName.toLowerCase();

    if (lowerName.includes('odj') || lowerName.includes('ordre')) {
        return { type: 'agenda', confidence: 80, matches: ['odj', 'ordre'] };
    }
    if (lowerName.includes('pv') || lowerName.includes('proces') || lowerName.includes('minute')) {
        return { type: 'minutes', confidence: 80, matches: ['pv', 'procès-verbal'] };
    }
    if (lowerName.includes('resol') || lowerName.includes('cce-')) {
        return { type: 'resolution', confidence: 80, matches: ['resolution'] };
    }
    if (lowerName.includes('rapport') || lowerName.includes('bilan')) {
        return { type: 'report', confidence: 70, matches: ['rapport'] };
    }

    return { type: 'unknown', confidence: 0, matches: [] };
};

/**
 * Get French label for document type
 */
export const getDocumentTypeLabel = (type: DocumentType): string => {
    const labels: Record<DocumentType, string> = {
        agenda: 'Ordre du jour',
        minutes: 'Procès-verbal',
        resolution: 'Résolution',
        report: 'Rapport',
        correspondence: 'Correspondance',
        unknown: 'Document'
    };
    return labels[type];
};

/**
 * Get icon name for document type
 */
export const getDocumentTypeIcon = (type: DocumentType): string => {
    const icons: Record<DocumentType, string> = {
        agenda: 'EventNote',
        minutes: 'Description',
        resolution: 'Gavel',
        report: 'Assessment',
        correspondence: 'Mail',
        unknown: 'InsertDriveFile'
    };
    return icons[type];
};
