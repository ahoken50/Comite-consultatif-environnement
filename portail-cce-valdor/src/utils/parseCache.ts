/**
 * Parse Cache Utility
 * Caches parsing results to avoid re-parsing identical files
 */

import { logger } from './logger';

const CACHE_KEY_PREFIX = 'cce_parse_cache_';
const CACHE_EXPIRY_MS = 1000 * 60 * 60; // 1 hour

interface CacheEntry<T> {
    hash: string;
    result: T;
    timestamp: number;
    fileName: string;
    fileSize: number;
}

/**
 * Generate a hash for a file using Web Crypto API
 */
export const generateFileHash = async (file: File): Promise<string> => {
    try {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        // Fallback for environments without crypto.subtle
        logger.warn('ParseCache', 'crypto.subtle not available, using fallback hash');
        return `${file.name}-${file.size}-${file.lastModified}`;
    }
};

/**
 * Generate a simple hash for text content
 */
export const generateTextHash = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
};

/**
 * Get cached parse result for a file
 */
export const getCachedParse = async <T>(
    file: File,
    cacheType: string
): Promise<T | null> => {
    try {
        const hash = await generateFileHash(file);
        const cacheKey = `${CACHE_KEY_PREFIX}${cacheType}`;
        const cached = localStorage.getItem(cacheKey);

        if (!cached) return null;

        const entry: CacheEntry<T> = JSON.parse(cached);

        // Check if hash matches
        if (entry.hash !== hash) {
            logger.debug('ParseCache', 'Hash mismatch, cache invalid');
            return null;
        }

        // Check if expired
        if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
            logger.debug('ParseCache', 'Cache expired');
            localStorage.removeItem(cacheKey);
            return null;
        }

        logger.info('ParseCache', `Cache hit for ${file.name}`, {
            cacheType,
            age: Math.round((Date.now() - entry.timestamp) / 1000) + 's'
        });

        return entry.result;

    } catch (error) {
        logger.warn('ParseCache', 'Error reading cache', { error });
        return null;
    }
};

/**
 * Cache a parse result for a file
 */
export const setCachedParse = async <T>(
    file: File,
    cacheType: string,
    result: T
): Promise<void> => {
    try {
        const hash = await generateFileHash(file);
        const cacheKey = `${CACHE_KEY_PREFIX}${cacheType}`;

        const entry: CacheEntry<T> = {
            hash,
            result,
            timestamp: Date.now(),
            fileName: file.name,
            fileSize: file.size
        };

        localStorage.setItem(cacheKey, JSON.stringify(entry));
        logger.debug('ParseCache', `Cached result for ${file.name}`, { cacheType });

    } catch (error) {
        // Cache write failures are non-critical
        logger.warn('ParseCache', 'Error writing cache', { error });
    }
};

/**
 * Clear specific cache type
 */
export const clearParseCache = (cacheType?: string): void => {
    if (cacheType) {
        localStorage.removeItem(`${CACHE_KEY_PREFIX}${cacheType}`);
    } else {
        // Clear all parse caches
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CACHE_KEY_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    }
    logger.info('ParseCache', 'Cache cleared', { cacheType: cacheType || 'all' });
};

/**
 * Get cache statistics
 */
export const getCacheStats = (): { count: number; totalSize: number; entries: string[] } => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_KEY_PREFIX));
    let totalSize = 0;

    keys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) totalSize += value.length * 2; // UTF-16 = 2 bytes per char
    });

    return {
        count: keys.length,
        totalSize,
        entries: keys.map(k => k.replace(CACHE_KEY_PREFIX, ''))
    };
};

/**
 * Wrapper to add caching to any parse function
 */
export const withCache = <T>(
    cacheType: string,
    parseFn: (file: File) => Promise<T>
): (file: File) => Promise<T> => {
    return async (file: File): Promise<T> => {
        // Try cache first
        const cached = await getCachedParse<T>(file, cacheType);
        if (cached) return cached;

        // Parse and cache
        const result = await parseFn(file);
        await setCachedParse(file, cacheType, result);

        return result;
    };
};
