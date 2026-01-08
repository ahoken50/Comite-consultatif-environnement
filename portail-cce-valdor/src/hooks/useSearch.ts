/**
 * Global Search Hook
 * Provides unified search across the application
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
    searchMeetings,
    searchProjects,
    searchAll,
    getTypesenseStatus,
    type SearchableMeeting,
    type SearchableProject,
    type SearchResult
} from '../services/typesenseService';
import { logger } from '../utils/logger';

// ============================================
// TYPES
// ============================================

export interface UseSearchOptions {
    debounceMs?: number;
    minQueryLength?: number;
    searchOnMount?: boolean;
}

export interface SearchState {
    query: string;
    isSearching: boolean;
    error: string | null;
    meetings: SearchResult<SearchableMeeting> | null;
    projects: SearchResult<SearchableProject> | null;
    totalResults: number;
    searchTimeMs: number;
}

export interface UseSearchReturn extends SearchState {
    setQuery: (query: string) => void;
    search: (query?: string) => Promise<void>;
    clearResults: () => void;
    isTypesenseConfigured: boolean;
}

const initialState: SearchState = {
    query: '',
    isSearching: false,
    error: null,
    meetings: null,
    projects: null,
    totalResults: 0,
    searchTimeMs: 0
};

// ============================================
// HOOK
// ============================================

export const useSearch = (options: UseSearchOptions = {}): UseSearchReturn => {
    const {
        debounceMs = 300,
        minQueryLength = 2,
        searchOnMount = false
    } = options;

    const [state, setState] = useState<SearchState>(initialState);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const { isConfigured } = getTypesenseStatus();

    // Perform the search
    const performSearch = useCallback(async (searchQuery: string) => {
        // Cancel any pending search
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        if (!searchQuery || searchQuery.length < minQueryLength) {
            setState(prev => ({
                ...prev,
                isSearching: false,
                meetings: null,
                projects: null,
                totalResults: 0,
                error: null
            }));
            return;
        }

        if (!isConfigured) {
            setState(prev => ({
                ...prev,
                isSearching: false,
                error: 'La recherche n\'est pas configurée. Veuillez contacter l\'administrateur.'
            }));
            return;
        }

        setState(prev => ({ ...prev, isSearching: true, error: null }));

        try {
            const startTime = performance.now();
            const { meetings, projects } = await searchAll(searchQuery);
            const searchTime = performance.now() - startTime;

            setState(prev => ({
                ...prev,
                isSearching: false,
                meetings,
                projects,
                totalResults: meetings.found + projects.found,
                searchTimeMs: searchTime,
                error: null
            }));

            logger.debug('Search', `Found ${meetings.found + projects.found} results`, {
                query: searchQuery,
                timeMs: Math.round(searchTime)
            });

        } catch (error) {
            // Ignore abort errors
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }

            logger.error('Search', 'Search failed', { error, query: searchQuery });
            setState(prev => ({
                ...prev,
                isSearching: false,
                error: 'Une erreur est survenue lors de la recherche.'
            }));
        }
    }, [isConfigured, minQueryLength]);

    // Debounced search
    const search = useCallback(async (queryOverride?: string) => {
        const searchQuery = queryOverride ?? state.query;
        await performSearch(searchQuery);
    }, [state.query, performSearch]);

    // Set query with debounce
    const setQuery = useCallback((newQuery: string) => {
        setState(prev => ({ ...prev, query: newQuery }));

        // Clear existing debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        // Debounce the search
        debounceRef.current = setTimeout(() => {
            performSearch(newQuery);
        }, debounceMs);
    }, [debounceMs, performSearch]);

    // Clear results
    const clearResults = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setState(initialState);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    // Search on mount if enabled
    useEffect(() => {
        if (searchOnMount && state.query) {
            performSearch(state.query);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchOnMount]);

    return {
        ...state,
        setQuery,
        search,
        clearResults,
        isTypesenseConfigured: isConfigured
    };
};

// ============================================
// SPECIALIZED HOOKS
// ============================================

/**
 * Hook for searching only meetings
 */
export const useMeetingSearch = (options: UseSearchOptions = {}) => {
    const [state, setState] = useState<{
        query: string;
        isSearching: boolean;
        error: string | null;
        results: SearchResult<SearchableMeeting> | null;
    }>({
        query: '',
        isSearching: false,
        error: null,
        results: null
    });

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { debounceMs = 300, minQueryLength = 2 } = options;

    const search = useCallback(async (query: string) => {
        if (query.length < minQueryLength) {
            setState(prev => ({ ...prev, results: null, isSearching: false }));
            return;
        }

        setState(prev => ({ ...prev, isSearching: true, error: null }));

        try {
            const results = await searchMeetings(query);
            setState(prev => ({ ...prev, isSearching: false, results }));
        } catch (error) {
            setState(prev => ({
                ...prev,
                isSearching: false,
                error: 'Erreur lors de la recherche'
            }));
        }
    }, [minQueryLength]);

    const setQuery = useCallback((newQuery: string) => {
        setState(prev => ({ ...prev, query: newQuery }));

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            search(newQuery);
        }, debounceMs);
    }, [debounceMs, search]);

    return { ...state, setQuery, search };
};

/**
 * Hook for searching only projects
 */
export const useProjectSearch = (options: UseSearchOptions = {}) => {
    const [state, setState] = useState<{
        query: string;
        isSearching: boolean;
        error: string | null;
        results: SearchResult<SearchableProject> | null;
    }>({
        query: '',
        isSearching: false,
        error: null,
        results: null
    });

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { debounceMs = 300, minQueryLength = 2 } = options;

    const search = useCallback(async (query: string) => {
        if (query.length < minQueryLength) {
            setState(prev => ({ ...prev, results: null, isSearching: false }));
            return;
        }

        setState(prev => ({ ...prev, isSearching: true, error: null }));

        try {
            const results = await searchProjects(query);
            setState(prev => ({ ...prev, isSearching: false, results }));
        } catch (error) {
            setState(prev => ({
                ...prev,
                isSearching: false,
                error: 'Erreur lors de la recherche'
            }));
        }
    }, [minQueryLength]);

    const setQuery = useCallback((newQuery: string) => {
        setState(prev => ({ ...prev, query: newQuery }));

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            search(newQuery);
        }, debounceMs);
    }, [debounceMs, search]);

    return { ...state, setQuery, search };
};

export default useSearch;
