
/**
 * Safely converts various date formats (Firestore Timestamp, ISO string, Date object) to a standard Date object.
 * Returns null if the input is invalid or null/undefined.
 */
export const safeDate = (date: any): Date | null => {
    if (!date) return null;

    // Handle Firestore Timestamp (has toDate method)
    if (date.toDate && typeof date.toDate === 'function') {
        const d = date.toDate();
        return isNaN(d.getTime()) ? null : d;
    }

    // Handle standard Date object
    if (date instanceof Date) {
        return isNaN(date.getTime()) ? null : date;
    }

    // Handle ISO string or timestamp number
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d;
};

/**
 * Same as safeDate but returns a fallback date (default: now) instead of null if invalid.
 */
export const safeDateOrNow = (date: any): Date => {
    return safeDate(date) || new Date();
};

/**
 * Alias for safeDate to maintain compatibility with existing code (SearchIndexManager, MeetingsPage)
 */
export const parseAnyDate = safeDate;
