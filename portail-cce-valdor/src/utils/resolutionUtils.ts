/**
 * Resolution Numbering Utilities
 * Handles automatic resolution number generation with reset per meeting
 */

import { format } from 'date-fns';

export interface ResolutionNumber {
    full: string;      // e.g., "CCE-2024-01-05"
    prefix: string;    // e.g., "CCE"
    year: string;      // e.g., "2024"
    sequence: string;  // e.g., "05"
}

/**
 * Generate the next resolution number for a meeting
 * Format: PREFIX-YYYY-MM-NN where NN resets to 01 for each new meeting
 * 
 * @param meetingDate - Date of the meeting
 * @param existingNumbers - Array of existing resolution numbers in this meeting
 * @param prefix - Organization prefix (default: "CCE")
 */
export const generateNextResolutionNumber = (
    meetingDate: Date | string,
    existingNumbers: string[] = [],
    prefix: string = 'CCE'
): string => {
    const date = typeof meetingDate === 'string' ? new Date(meetingDate) : meetingDate;
    const year = format(date, 'yyyy');
    const month = format(date, 'MM');

    // Find the highest sequence number for this meeting
    let maxSequence = 0;

    const meetingPrefix = `${prefix}-${year}-${month}`;

    existingNumbers.forEach(num => {
        if (num.startsWith(meetingPrefix)) {
            const parts = num.split('-');
            const seq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(seq) && seq > maxSequence) {
                maxSequence = seq;
            }
        }
    });

    const nextSequence = (maxSequence + 1).toString().padStart(2, '0');
    return `${meetingPrefix}-${nextSequence}`;
};

/**
 * Parse a resolution number string
 */
export const parseResolutionNumber = (number: string): ResolutionNumber | null => {
    // Pattern: PREFIX-YYYY-MM-NN or PREFIX-YYYY-NN
    const pattern = /^([A-Z]+)-(\d{4})-(\d{2})(?:-(\d{2}))?$/;
    const match = number.match(pattern);

    if (!match) return null;

    return {
        full: number,
        prefix: match[1],
        year: match[2],
        sequence: match[4] || match[3]
    };
};

/**
 * Extract all resolution numbers from agenda items
 */
export const extractResolutionNumbers = (agendaItems: Array<{ minuteEntries?: Array<{ type: string; number: string }> }>): string[] => {
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
 * Validate resolution number format
 */
export const isValidResolutionNumber = (number: string): boolean => {
    const pattern = /^[A-Z]+-\d{4}-\d{2}(-\d{2})?$/;
    return pattern.test(number);
};

/**
 * Compare two resolution numbers for sorting
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export const compareResolutionNumbers = (a: string, b: string): number => {
    const parsedA = parseResolutionNumber(a);
    const parsedB = parseResolutionNumber(b);

    if (!parsedA && !parsedB) return 0;
    if (!parsedA) return 1;
    if (!parsedB) return -1;

    // Compare by year first
    if (parsedA.year !== parsedB.year) {
        return parseInt(parsedA.year) - parseInt(parsedB.year);
    }

    // Then by sequence
    return parseInt(parsedA.sequence) - parseInt(parsedB.sequence);
};

/**
 * Get all resolution numbers from a meeting year
 * Useful for generating annual reports
 */
export const getResolutionsByYear = (
    resolutions: Array<{ number: string; date: string }>,
    year: number
): Array<{ number: string; date: string }> => {
    return resolutions
        .filter(r => {
            const parsed = parseResolutionNumber(r.number);
            return parsed && parseInt(parsed.year) === year;
        })
        .sort((a, b) => compareResolutionNumbers(a.number, b.number));
};

/**
 * Generate a comment number (same format but with different prefix)
 */
export const generateNextCommentNumber = (
    meetingDate: Date | string,
    existingNumbers: string[] = [],
    prefix: string = 'COM'
): string => {
    return generateNextResolutionNumber(meetingDate, existingNumbers, prefix);
};
