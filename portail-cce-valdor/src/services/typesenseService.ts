/**
 * Typesense Search Service
 * Full-text search using Typesense Cloud
 * 
 * SETUP INSTRUCTIONS:
 * 1. Add to your .env file:
 *    VITE_TYPESENSE_HOST=your-cluster.typesense.net
 *    VITE_TYPESENSE_API_KEY=your-search-only-api-key
 *    VITE_TYPESENSE_ADMIN_KEY=your-admin-api-key (only for indexing, keep secure!)
 * 
 * 2. Create collections in Typesense Cloud dashboard or via admin API
 */

import { logger } from '../utils/logger';
import { aiService } from './ai/UnifiedAIService';

// ============================================
// CONFIGURATION
// ============================================

// Helper to clean host string (remove protocol, port, whitespace, copy-paste artifacts)
const cleanHost = (host: string): string => {
    if (!host) return '';
    return host
        .replace(/^https?:\/\//, '') // Remove protocol
        .replace(/:443$/, '')        // Remove port 443
        .replace(/\s*\[.*?\]\s*/g, '') // Remove brackets like [https:443]
        .trim();                     // Remove whitespace
};

const TYPESENSE_CONFIG = {
    host: cleanHost(import.meta.env.VITE_TYPESENSE_HOST || ''),
    port: 443,
    protocol: 'https' as const,
    apiKey: import.meta.env.VITE_TYPESENSE_API_KEY || '',
    adminKey: import.meta.env.VITE_TYPESENSE_ADMIN_KEY || ''
};

// ============================================
// TYPES
// ============================================

export interface SearchableMeeting {
    id: string;
    title: string;
    date: string;
    dateTimestamp: number; // Unix timestamp for sorting
    type: string;
    status: string;
    minutes: string;
    agendaItemTitles: string[];
    resolutions: string[];
    attendeeNames: string[];
    embedding?: number[];
}

export interface SearchableProject {
    id: string;
    code: string;
    name: string;
    description: string;
    category: string;
    status: string;
    priority: string;
    notes: string;
}

export interface SearchResult<T> {
    hits: Array<{
        document: T;
        highlight?: Record<string, { snippet: string }>;
        textMatch: number;
        vectorDistance?: number;
    }>;
    found: number;
    page: number;
    totalPages: number;
    searchTimeMs: number;
}

export interface SearchOptions {
    page?: number;
    perPage?: number;
    filterBy?: string;
    sortBy?: string;
    highlightFields?: string[];
}

// ============================================
// COLLECTION SCHEMAS
// ============================================

export const COLLECTIONS = {
    meetings: {
        name: 'meetings',
        fields: [
            { name: 'id', type: 'string' as const },
            { name: 'title', type: 'string' as const },
            { name: 'date', type: 'string' as const, facet: true },
            { name: 'dateTimestamp', type: 'int64' as const },
            { name: 'type', type: 'string' as const, facet: true },
            { name: 'status', type: 'string' as const, facet: true },
            { name: 'minutes', type: 'string' as const },
            { name: 'agendaItemTitles', type: 'string[]' as const },
            { name: 'resolutions', type: 'string[]' as const },
            { name: 'attendeeNames', type: 'string[]' as const },
            { name: 'embedding', type: 'float[]' as const, num_dim: 768, optional: true }
        ],
        defaultSortingField: 'dateTimestamp'
    },
    projects: {
        name: 'projects',
        fields: [
            { name: 'id', type: 'string' as const },
            { name: 'code', type: 'string' as const },
            { name: 'name', type: 'string' as const },
            { name: 'description', type: 'string' as const },
            { name: 'category', type: 'string' as const, facet: true },
            { name: 'status', type: 'string' as const, facet: true },
            { name: 'priority', type: 'string' as const, facet: true },
            { name: 'notes', type: 'string' as const }
        ],
        defaultSortingField: 'name'
    },
    regulations: {
        name: 'regulations',
        fields: [
            { name: 'id', type: 'string' as const },
            { name: 'title', type: 'string' as const },
            { name: 'content', type: 'string' as const },
            { name: 'category', type: 'string' as const, facet: true },
            { name: 'year', type: 'int32' as const, facet: true },
            { name: 'status', type: 'string' as const, facet: true },
            { name: 'embedding', type: 'float[]' as const, num_dim: 768, optional: true }
        ],
        defaultSortingField: 'year'
    }
};

// ============================================
// API HELPERS
// ============================================

const isConfigured = (): boolean => {
    return !!(TYPESENSE_CONFIG.host && TYPESENSE_CONFIG.apiKey);
};

const getApiUrl = (path: string): string => {
    return `${TYPESENSE_CONFIG.protocol}://${TYPESENSE_CONFIG.host}:${TYPESENSE_CONFIG.port}${path}`;
};

const fetchTypesense = async <T>(
    path: string,
    options: RequestInit = {},
    useAdminKey = false
): Promise<T> => {
    if (!isConfigured()) {
        throw new Error('Typesense is not configured. Please add VITE_TYPESENSE_HOST and VITE_TYPESENSE_API_KEY to your .env file.');
    }

    const apiKey = useAdminKey ? TYPESENSE_CONFIG.adminKey : TYPESENSE_CONFIG.apiKey;

    const response = await fetch(getApiUrl(path), {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-TYPESENSE-API-KEY': apiKey,
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Typesense API error: ${response.status} - ${errorText}`);
    }

    return response.json();
};

// ============================================
// SEARCH FUNCTIONS
// ============================================

/**
 * Search meetings
 */
export const searchMeetings = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<SearchableMeeting>> => {
    const timer = logger.time('Typesense', 'Search meetings');

    try {
        const {
            page = 1,
            perPage = 10,
            filterBy,
            sortBy = 'date:desc',
            highlightFields = ['title', 'minutes', 'resolutions']
        } = options;

        const useVectorSearch = !!query && query.length > 3; // Only vector search for substantial queries

        let vectorQuery = '';
        if (useVectorSearch) {
            try {
                // Generate embedding for the query itself (very cheap)
                const queryVector = await aiService.generateEmbedding(query);
                vectorQuery = `embedding:([${queryVector.join(',')}], k:10)`;
            } catch (e) {
                logger.warn('Typesense', 'Failed to generate query embedding', { error: e instanceof Error ? e.message : String(e) });
            }
        }

        const searchParams = new URLSearchParams({
            q: query,
            query_by: 'title,minutes,agendaItemTitles,resolutions',
            page: page.toString(),
            per_page: perPage.toString(),
            sort_by: sortBy,
            highlight_fields: highlightFields.join(','),
            highlight_full_fields: 'title'
        });

        if (vectorQuery) {
            searchParams.append('vector_query', vectorQuery);
        }

        if (filterBy) {
            searchParams.append('filter_by', filterBy);
        }

        const response = await fetchTypesense<{
            hits: Array<{
                document: SearchableMeeting;
                highlights?: Array<{ field: string; snippet: string }>;
                text_match: number;
                vector_distance?: number;
            }>;
            found: number;
            page: number;
            out_of: number;
            search_time_ms: number;
        }>(`/collections/meetings/documents/search?${searchParams}`);

        timer.end({ found: response.found });

        return {
            hits: response.hits.map(hit => ({
                document: hit.document,
                highlight: hit.highlights?.reduce((acc, h) => {
                    acc[h.field] = { snippet: h.snippet };
                    return acc;
                }, {} as Record<string, { snippet: string }>),
                textMatch: hit.text_match,
                vectorDistance: hit.vector_distance
            })),
            found: response.found,
            page: response.page,
            totalPages: Math.ceil(response.found / perPage),
            searchTimeMs: response.search_time_ms
        };

    } catch (error) {
        logger.error('Typesense', 'Search meetings failed', { error, query });
        timer.end({ error: true });
        throw error;
    }
};

/**
 * Search projects
 */
export const searchProjects = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<SearchableProject>> => {
    const timer = logger.time('Typesense', 'Search projects');

    try {
        const {
            page = 1,
            perPage = 10,
            filterBy,
            sortBy = '_text_match:desc',
            highlightFields = ['name', 'description', 'notes']
        } = options;

        const searchParams = new URLSearchParams({
            q: query,
            query_by: 'name,description,notes,code',
            page: page.toString(),
            per_page: perPage.toString(),
            sort_by: sortBy,
            highlight_fields: highlightFields.join(',')
        });

        if (filterBy) {
            searchParams.append('filter_by', filterBy);
        }

        const response = await fetchTypesense<{
            hits: Array<{
                document: SearchableProject;
                highlights?: Array<{ field: string; snippet: string }>;
                text_match: number;
            }>;
            found: number;
            page: number;
            out_of: number;
            search_time_ms: number;
        }>(`/collections/projects/documents/search?${searchParams}`);

        timer.end({ found: response.found });

        return {
            hits: response.hits.map(hit => ({
                document: hit.document,
                highlight: hit.highlights?.reduce((acc, h) => {
                    acc[h.field] = { snippet: h.snippet };
                    return acc;
                }, {} as Record<string, { snippet: string }>),
                textMatch: hit.text_match
            })),
            found: response.found,
            page: response.page,
            totalPages: Math.ceil(response.found / perPage),
            searchTimeMs: response.search_time_ms
        };

    } catch (error) {
        logger.error('Typesense', 'Search projects failed', { error: error instanceof Error ? error.message : String(error), query });
        timer.end({ error: true });
        throw error;
    }
};

/**
 * Universal search across all collections
 */
export const searchAll = async (
    query: string,
    options: SearchOptions = {}
): Promise<{
    meetings: SearchResult<SearchableMeeting>;
    projects: SearchResult<SearchableProject>;
}> => {
    const [meetings, projects] = await Promise.all([
        searchMeetings(query, { ...options, perPage: 5 }),
        searchProjects(query, { ...options, perPage: 5 })
    ]);

    return { meetings, projects };
};

// ============================================
// INDEXING FUNCTIONS (Admin only)
// ============================================

/**
 * Index a meeting document (requires admin key)
 * @param meeting - The meeting data to index
 * @param generateEmbedding - Whether to generate vector embedding (costs AI tokens)
 */
export const indexMeeting = async (meeting: SearchableMeeting, generateEmbedding = false): Promise<void> => {
    try {
        const meetingToIndex = { ...meeting };

        if (generateEmbedding) {
            // Generate semantic text from relevant fields
            const semanticText = `
                Titre: ${meeting.title}
                Type: ${meeting.type}
                Résolutions: ${meeting.resolutions.join(' ')}
                Points Ordre du jour: ${meeting.agendaItemTitles.join(' ')}
                Contenu: ${meeting.minutes.substring(0, 1000)}
            `.trim();

            try {
                const vector = await aiService.generateEmbedding(semanticText);
                meetingToIndex.embedding = vector;
                logger.debug('Typesense', 'Generated embedding for meeting', { id: meeting.id });
            } catch (e) {
                logger.warn('Typesense', 'Failed to generate embedding, indexing without vector', { error: e });
            }
        }

        await fetchTypesense(
            `/collections/meetings/documents?action=upsert`,
            {
                method: 'POST',
                body: JSON.stringify(meetingToIndex)
            },
            true // Use admin key
        );

        logger.debug('Typesense', `Indexed meeting ${meeting.id}`);

    } catch (error) {
        logger.error('Typesense', 'Failed to index meeting', { error, meetingId: meeting.id });
        throw error;
    }
};

/**
 * Index a project document (requires admin key)
 */
export const indexProject = async (project: SearchableProject): Promise<void> => {
    try {
        await fetchTypesense(
            `/collections/projects/documents?action=upsert`,
            {
                method: 'POST',
                body: JSON.stringify(project)
            },
            true
        );

        logger.debug('Typesense', `Indexed project ${project.id}`);

    } catch (error) {
        logger.error('Typesense', 'Failed to index project', { error, projectId: project.id });
        throw error;
    }
};

/**
 * Delete a document from the index
 */
export const deleteFromIndex = async (
    collectionName: 'meetings' | 'projects' | 'regulations',
    documentId: string
): Promise<void> => {
    try {
        await fetchTypesense(
            `/collections/${collectionName}/documents/${documentId}`,
            { method: 'DELETE' },
            true
        );

        logger.debug('Typesense', `Deleted ${documentId} from ${collectionName}`);

    } catch (error) {
        logger.error('Typesense', 'Failed to delete from index', { error, collectionName, documentId });
        // Don't throw - deletion failures are not critical
    }
};

/**
 * Ensure all required collections exist in Typesense
 * Creates them if they are missing
 */
export const ensureCollectionsExist = async (): Promise<void> => {
    try {
        const collectionsToCheck = Object.values(COLLECTIONS);

        for (const collectionSchema of collectionsToCheck) {
            try {
                // Check if collection exists
                await fetchTypesense(`/collections/${collectionSchema.name}`);
                logger.debug('Typesense', `Collection ${collectionSchema.name} exists`);
            } catch (e: any) {
                // If 404, create it
                if (e.message && e.message.includes('404')) {
                    logger.info('Typesense', `Collection ${collectionSchema.name} not found, creating...`);
                    await fetchTypesense(
                        '/collections',
                        {
                            method: 'POST',
                            body: JSON.stringify(collectionSchema)
                        },
                        true // Use admin key
                    );
                    logger.info('Typesense', `Created collection ${collectionSchema.name}`);
                } else {
                    throw e;
                }
            }
        }
    } catch (error) {
        logger.error('Typesense', 'Failed to ensure collections exist', { error });
        throw error;
    }
};

// ============================================
// UTILITIES
// ============================================

/**
 * Check if Typesense is configured and accessible
 */
export const checkTypesenseHealth = async (): Promise<{
    configured: boolean;
    accessible: boolean;
    error?: string;
}> => {
    if (!isConfigured()) {
        return { configured: false, accessible: false };
    }

    try {
        await fetchTypesense('/health');
        return { configured: true, accessible: true };
    } catch (error) {
        return {
            configured: true,
            accessible: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

/**
 * Get Typesense configuration status
 */
export const getTypesenseStatus = (): {
    isConfigured: boolean;
    host: string;
} => ({
    isConfigured: isConfigured(),
    host: TYPESENSE_CONFIG.host || 'Not configured'
});



// ============================================
// REGULATION FUNCTIONS
// ============================================

export interface SearchableRegulation {
    id: string;
    title: string;
    content: string;
    category: string;
    year: number;
    status: string;
    embedding?: number[];
}

export const searchRegulations = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<SearchableRegulation>> => {
    const timer = logger.time('Typesense', 'Search regulations');

    try {
        const {
            page = 1,
            perPage = 10,
            filterBy,
            sortBy = '_text_match:desc',
            highlightFields = ['title', 'content']
        } = options;

        const useVectorSearch = !!query && query.length > 3;

        let vectorQuery = '';
        if (useVectorSearch) {
            try {
                const queryVector = await aiService.generateEmbedding(query);
                vectorQuery = `embedding:([${queryVector.join(',')}], k:10)`;
            } catch (e) {
                logger.warn('Typesense', 'Failed to generate query embedding', { error: e instanceof Error ? e.message : String(e) });
            }
        }

        const searchParams = new URLSearchParams({
            q: query,
            query_by: 'title,content',
            page: page.toString(),
            per_page: perPage.toString(),
            sort_by: sortBy,
            highlight_fields: highlightFields.join(','),
            highlight_full_fields: 'title,content' // Highlight in content too
        });

        if (vectorQuery) {
            searchParams.append('vector_query', vectorQuery);
        }

        if (filterBy) {
            searchParams.append('filter_by', filterBy);
        }

        const response = await fetchTypesense<{
            hits: Array<{
                document: SearchableRegulation;
                highlights?: Array<{ field: string; snippet: string }>;
                text_match: number;
                vector_distance?: number;
            }>;
            found: number;
            page: number;
            out_of: number;
            search_time_ms: number;
        }>(`/collections/regulations/documents/search?${searchParams}`);

        timer.end({ found: response.found });

        return {
            hits: response.hits.map(hit => ({
                document: hit.document,
                highlight: hit.highlights?.reduce((acc, h) => {
                    acc[h.field] = { snippet: h.snippet };
                    return acc;
                }, {} as Record<string, { snippet: string }>),
                textMatch: hit.text_match,
                vectorDistance: hit.vector_distance
            })),
            found: response.found,
            page: response.page,
            totalPages: Math.ceil(response.found / perPage),
            searchTimeMs: response.search_time_ms
        };

    } catch (error) {
        logger.error('Typesense', 'Search regulations failed', { error, query });
        timer.end({ error: true });
        throw error;
    }
};

export const indexRegulation = async (regulation: SearchableRegulation, generateEmbedding = false): Promise<void> => {
    try {
        const regToIndex = { ...regulation };

        if (generateEmbedding) {
            // Include content in embedding for semantic search
            const semanticText = `
                Titre: ${regulation.title}
                Catégorie: ${regulation.category}
                Contenu: ${regulation.content.substring(0, 1500)}
            `.trim();

            try {
                const vector = await aiService.generateEmbedding(semanticText);
                regToIndex.embedding = vector;
                logger.debug('Typesense', 'Generated embedding for regulation', { id: regulation.id });
            } catch (e) {
                logger.warn('Typesense', 'Failed to generate embedding for regulation', { error: e });
            }
        }

        await fetchTypesense(
            `/collections/regulations/documents?action=upsert`,
            {
                method: 'POST',
                body: JSON.stringify(regToIndex)
            },
            true // Use admin key
        );

        logger.debug('Typesense', `Indexed regulation ${regulation.id}`);

    } catch (error) {
        logger.error('Typesense', 'Failed to index regulation', { error, regId: regulation.id });
        throw error;
    }
};

export default {
    searchMeetings,
    searchProjects,
    searchRegulations,
    searchAll,
    indexMeeting,
    indexProject,
    indexRegulation,
    deleteFromIndex,
    ensureCollectionsExist,
    checkTypesenseHealth,
    getTypesenseStatus,
    COLLECTIONS
};
