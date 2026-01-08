/**
 * Date Utilities
 * Unified date handling for the application
 */

import { format, parseISO, isValid, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

// Type for Firestore Timestamp
interface FirestoreTimestamp {
    toDate: () => Date;
    seconds: number;
    nanoseconds: number;
}

/**
 * Parse any date format (Firestore Timestamp, ISO string, Date object)
 * @param date - Date in any format
 * @returns Date object or null if invalid
 */
export const parseAnyDate = (date: unknown): Date | null => {
    if (!date) return null;

    // Firestore Timestamp
    if (typeof date === 'object' && date !== null && 'toDate' in date) {
        return (date as FirestoreTimestamp).toDate();
    }

    // Already a Date object
    if (date instanceof Date) {
        return isValid(date) ? date : null;
    }

    // ISO string or other string format
    if (typeof date === 'string') {
        const parsed = parseISO(date);
        return isValid(parsed) ? parsed : null;
    }

    // Number (timestamp)
    if (typeof date === 'number') {
        const parsed = new Date(date);
        return isValid(parsed) ? parsed : null;
    }

    return null;
};

/**
 * Format date for display (French, full date)
 * @example "15 janvier 2024"
 */
export const formatDisplayDate = (date: unknown): string => {
    const parsed = parseAnyDate(date);
    return parsed ? format(parsed, 'd MMMM yyyy', { locale: fr }) : '-';
};

/**
 * Format date with time for display
 * @example "15 janvier 2024 à 14:30"
 */
export const formatDisplayDateTime = (date: unknown): string => {
    const parsed = parseAnyDate(date);
    return parsed ? format(parsed, "d MMMM yyyy 'à' HH:mm", { locale: fr }) : '-';
};

/**
 * Format short date
 * @example "15/01/2024"
 */
export const formatShortDate = (date: unknown): string => {
    const parsed = parseAnyDate(date);
    return parsed ? format(parsed, 'dd/MM/yyyy', { locale: fr }) : '-';
};

/**
 * Format short date with time
 * @example "15/01/2024 14:30"
 */
export const formatShortDateTime = (date: unknown): string => {
    const parsed = parseAnyDate(date);
    return parsed ? format(parsed, 'dd/MM/yyyy HH:mm', { locale: fr }) : '-';
};

/**
 * Format relative time (e.g., "il y a 2 heures")
 */
export const formatRelativeTime = (date: unknown): string => {
    const parsed = parseAnyDate(date);
    return parsed ? formatDistanceToNow(parsed, { addSuffix: true, locale: fr }) : '-';
};

/**
 * Format date for form input (datetime-local)
 * @example "2024-01-15T14:30"
 */
export const formatForInput = (date: unknown): string => {
    const parsed = parseAnyDate(date);
    return parsed ? format(parsed, "yyyy-MM-dd'T'HH:mm") : '';
};

/**
 * Format date for Firestore (ISO string)
 */
export const toISOString = (date?: Date): string => {
    return (date || new Date()).toISOString();
};

/**
 * Get current timestamp as ISO string
 */
export const nowISO = (): string => new Date().toISOString();

/**
 * Check if a date is in the past
 */
export const isPast = (date: unknown): boolean => {
    const parsed = parseAnyDate(date);
    return parsed ? parsed < new Date() : false;
};

/**
 * Check if a date is in the future
 */
export const isFuture = (date: unknown): boolean => {
    const parsed = parseAnyDate(date);
    return parsed ? parsed > new Date() : false;
};

/**
 * Check if a date is today
 */
export const isToday = (date: unknown): boolean => {
    const parsed = parseAnyDate(date);
    if (!parsed) return false;

    const today = new Date();
    return parsed.getDate() === today.getDate() &&
        parsed.getMonth() === today.getMonth() &&
        parsed.getFullYear() === today.getFullYear();
};

/**
 * Get the month name in French
 */
export const getMonthName = (month: number): string => {
    const monthNames = [
        'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];
    return monthNames[month] || '';
};

/**
 * Get short month name in French
 */
export const getShortMonthName = (month: number): string => {
    const monthNames = [
        'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
        'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'
    ];
    return monthNames[month] || '';
};

/**
 * Parse French date string from DOCX
 * @example "15 janvier 2024" -> Date
 */
export const parseFrenchDate = (dateStr: string): Date | null => {
    const months: Record<string, number> = {
        'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3,
        'mai': 4, 'juin': 5, 'juillet': 6, 'août': 7,
        'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11
    };

    const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = months[match[2].toLowerCase()];
    const year = parseInt(match[3], 10);

    if (month === undefined || isNaN(day) || isNaN(year)) return null;

    return new Date(year, month, day);
};

/**
 * Calculate the bucket index for monthly progress charts
 * Returns -1 if outside the 6-month window
 */
export const getMonthBucketIndex = (date: unknown, windowSize: number = 6): number => {
    const parsed = parseAnyDate(date);
    if (!parsed) return -1;

    const now = new Date();
    const diff = (now.getFullYear() - parsed.getFullYear()) * 12 +
        (now.getMonth() - parsed.getMonth());

    if (diff >= 0 && diff < windowSize) {
        return windowSize - 1 - diff;
    }
    return -1;
};
