/**
 * Resolution & Comment Numbering Utilities
 * 
 * Format:
 * - Resolutions: XX-1, XX-2, XX-3 (e.g., 10-1, 10-2, 10-3)
 * - Comments: XX-A, XX-B, XX-C (e.g., 10-A, 10-B, 10-C)
 * 
 * Where XX is the meeting number (e.g., 10, 11, 12 for CCE meetings)
 */

/**
 * Generate the next resolution number for a meeting
 * Format: XX-N where XX is meeting number and N is sequence (1, 2, 3...)
 * 
 * @param meetingNumber - The meeting number (e.g., 10, 11)
 * @param existingNumbers - Array of existing resolution numbers in this meeting
 */
export const generateNextResolutionNumber = (
    meetingNumber: number | string,
    existingNumbers: string[] = []
): string => {
    const prefix = String(meetingNumber).padStart(2, '0');

    // Find the highest sequence number for this meeting
    let maxSequence = 0;

    existingNumbers.forEach(num => {
        // Match pattern like "10-1", "10-2", etc.
        const match = num.match(/^(\d+)-(\d+)$/);
        if (match && match[1] === prefix) {
            const seq = parseInt(match[2], 10);
            if (!isNaN(seq) && seq > maxSequence) {
                maxSequence = seq;
            }
        }
    });

    const nextSequence = maxSequence + 1;
    return `${prefix}-${nextSequence}`;
};

/**
 * Generate the next comment number for a meeting
 * Format: XX-A where XX is meeting number and A is sequence (A, B, C...)
 * 
 * @param meetingNumber - The meeting number (e.g., 10, 11)
 * @param existingNumbers - Array of existing comment numbers in this meeting
 */
export const generateNextCommentNumber = (
    meetingNumber: number | string,
    existingNumbers: string[] = []
): string => {
    const prefix = String(meetingNumber).padStart(2, '0');

    // Find the highest letter sequence for this meeting
    let maxLetterIndex = -1; // -1 means no letters found yet

    existingNumbers.forEach(num => {
        // Match pattern like "10-A", "10-B", etc.
        const match = num.match(/^(\d+)-([A-Z])$/i);
        if (match && match[1] === prefix) {
            const letter = match[2].toUpperCase();
            const letterIndex = letter.charCodeAt(0) - 65; // A=0, B=1, C=2...
            if (letterIndex > maxLetterIndex) {
                maxLetterIndex = letterIndex;
            }
        }
    });

    const nextLetterIndex = maxLetterIndex + 1;
    const nextLetter = String.fromCharCode(65 + nextLetterIndex); // 0->A, 1->B, 2->C...
    return `${prefix}-${nextLetter}`;
};

/**
 * Extract the meeting number from a resolution or comment number
 */
export const extractMeetingNumber = (number: string): number | null => {
    const match = number.match(/^(\d+)-/);
    if (match) {
        return parseInt(match[1], 10);
    }
    return null;
};

/**
 * Check if a number is a resolution (XX-N format with number)
 */
export const isResolutionNumber = (number: string): boolean => {
    return /^\d+-\d+$/.test(number);
};

/**
 * Check if a number is a comment (XX-A format with letter)
 */
export const isCommentNumber = (number: string): boolean => {
    return /^\d+-[A-Z]$/i.test(number);
};

/**
 * Extract all resolution numbers from agenda items
 */
export const extractResolutionNumbers = (
    agendaItems: Array<{ minuteEntries?: Array<{ type: string; number: string }> }>
): string[] => {
    const numbers: string[] = [];

    agendaItems.forEach(item => {
        if (item.minuteEntries) {
            item.minuteEntries.forEach(entry => {
                if (entry.type === 'resolution' && entry.number) {
                    numbers.push(entry.number);
                }
            });
        }
    });

    return numbers;
};

/**
 * Extract all comment numbers from agenda items
 */
export const extractCommentNumbers = (
    agendaItems: Array<{ minuteEntries?: Array<{ type: string; number: string }> }>
): string[] => {
    const numbers: string[] = [];

    agendaItems.forEach(item => {
        if (item.minuteEntries) {
            item.minuteEntries.forEach(entry => {
                if (entry.type === 'comment' && entry.number) {
                    numbers.push(entry.number);
                }
            });
        }
    });

    return numbers;
};

/**
 * Compare two resolution numbers for sorting
 */
export const compareResolutionNumbers = (a: string, b: string): number => {
    const meetingA = extractMeetingNumber(a) || 0;
    const meetingB = extractMeetingNumber(b) || 0;

    if (meetingA !== meetingB) {
        return meetingA - meetingB;
    }

    // Same meeting, compare sequence
    const seqMatchA = a.match(/-(\d+)$/);
    const seqMatchB = b.match(/-(\d+)$/);

    const seqA = seqMatchA ? parseInt(seqMatchA[1], 10) : 0;
    const seqB = seqMatchB ? parseInt(seqMatchB[1], 10) : 0;

    return seqA - seqB;
};

/**
 * Compare two comment numbers for sorting
 */
export const compareCommentNumbers = (a: string, b: string): number => {
    const meetingA = extractMeetingNumber(a) || 0;
    const meetingB = extractMeetingNumber(b) || 0;

    if (meetingA !== meetingB) {
        return meetingA - meetingB;
    }

    // Same meeting, compare letters
    const letterMatchA = a.match(/-([A-Z])$/i);
    const letterMatchB = b.match(/-([A-Z])$/i);

    const letterA = letterMatchA ? letterMatchA[1].toUpperCase().charCodeAt(0) : 0;
    const letterB = letterMatchB ? letterMatchB[1].toUpperCase().charCodeAt(0) : 0;

    return letterA - letterB;
};

