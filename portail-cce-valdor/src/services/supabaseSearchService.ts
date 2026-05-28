
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { aiService } from './ai/UnifiedAIService';
import { logger } from '../utils/logger';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
    if (supabaseInstance) return supabaseInstance;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase is not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
    }

    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return supabaseInstance;
};

// ============================================
// RRF FUSION HELPER FOR HYBRID SEARCH
// ============================================

function combineHitsRRF<T extends { id: string }>(
    vectorHits: Array<T>,
    ftsHits: Array<T>,
    matchCount: number
): Array<{ document: T; textMatch: number; vectorDistance?: number }> {
    const rrfScore: Record<string, number> = {};
    const docMap: Record<string, T> = {};
    const K = 60; // Reciprocal Rank Fusion constant

    vectorHits.forEach((doc, index) => {
        const id = doc.id;
        docMap[id] = doc;
        rrfScore[id] = (rrfScore[id] || 0) + 1 / (K + index);
    });

    ftsHits.forEach((doc, index) => {
        const id = doc.id;
        docMap[id] = doc;
        rrfScore[id] = (rrfScore[id] || 0) + 1 / (K + index);
    });

    const sortedIds = Object.keys(rrfScore).sort((a, b) => rrfScore[b] - rrfScore[a]);

    return sortedIds.slice(0, matchCount).map(id => {
        const doc = docMap[id];
        const vectorIndex = vectorHits.findIndex(h => h.id === id);
        const ftsIndex = ftsHits.findIndex(h => h.id === id);

        return {
            document: doc,
            textMatch: ftsIndex !== -1 ? 1 - ftsIndex / ftsHits.length : 0.5,
            vectorDistance: vectorIndex !== -1 ? 0.1 * vectorIndex : undefined
        };
    });
}

// ============================================
// TYPES
// ============================================

export interface SearchableMeeting {
    id: string;
    title: string;
    date: string;
    dateTimestamp: number;
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

export interface SearchableRegulation {
    id: string;
    title: string;
    content: string;
    category: string;
    year: number;
    status: string;
    embedding?: number[];
}

export interface SearchResult<T> {
    hits: Array<{
        document: T;
        textMatch: number;
        vectorDistance?: number;
    }>;
    found: number;
    searchTimeMs: number;
}

export interface SearchOptions {
    matchThreshold?: number; // Similarity threshold (0 to 1)
    matchCount?: number;     // Number of results to return
    filterBy?: any;         // Additional PostgREST filters
}

// ============================================
// SEARCH FUNCTIONS
// ============================================

/**
 * Hybrid Search for Meetings (Vector + Keyword)
 * Uses the `hybrid_search_meetings` RPC function we defined in SQL.
 */
export const searchMeetings = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<SearchableMeeting>> => {
    const timer = logger.time('Supabase', 'Search meetings');
    const supabase = getSupabase();

    try {
        const { matchThreshold = 0.5, matchCount = 10 } = options;

        // 1. Generate Embedding for the query
        let queryEmbedding: number[] = [];
        try {
            queryEmbedding = await aiService.generateEmbedding(query);
        } catch (e) {
            console.warn("Failed to generate embedding for query, falling back to text search", e);
        }

        // 2. Perform parallel hybrid search and fuse with RRF
        let data: any[] = [];

        if (queryEmbedding.length > 0) {
            const [vectorRes, ftsRes] = await Promise.allSettled([
                supabase.rpc('hybrid_search_meetings', {
                    query_text: query,
                    query_embedding: queryEmbedding,
                    match_threshold: matchThreshold,
                    match_count: matchCount * 2
                }),
                supabase
                    .from('meetings')
                    .select('*')
                    .textSearch('fts', query, { type: 'websearch', config: 'french' })
                    .limit(matchCount * 2)
            ]);

            let vectorDocs: any[] = [];
            let ftsDocs: any[] = [];

            if (vectorRes.status === 'fulfilled' && vectorRes.value.data) {
                vectorDocs = vectorRes.value.data;
            }
            if (ftsRes.status === 'fulfilled' && ftsRes.value.data) {
                ftsDocs = ftsRes.value.data;
            }

            if (vectorDocs.length > 0 || ftsDocs.length > 0) {
                const combined = combineHitsRRF(vectorDocs, ftsDocs, matchCount);
                timer.end({ found: combined.length });
                return {
                    hits: combined.map(c => ({
                        document: {
                            id: c.document.id,
                            title: c.document.title,
                            date: c.document.date,
                            dateTimestamp: c.document.date_timestamp || c.document.dateTimestamp,
                            type: c.document.type,
                            status: c.document.status,
                            minutes: c.document.minutes,
                            agendaItemTitles: c.document.agenda_item_titles || c.document.agendaItemTitles || [],
                            resolutions: c.document.resolutions || [],
                            attendeeNames: c.document.attendee_names || c.document.attendeeNames || [],
                        },
                        textMatch: c.textMatch,
                        vectorDistance: c.vectorDistance
                    })),
                    found: combined.length,
                    searchTimeMs: 0
                };
            }
        }

        // Fallback FTS search if no embeddings
        const result = await supabase
            .from('meetings')
            .select('*')
            .textSearch('fts', query, { type: 'websearch', config: 'french' })
            .limit(matchCount);
        data = result.data || [];

        timer.end({ found: data.length });

        return {
            hits: data.map((row: any) => ({
                document: {
                    id: row.id,
                    title: row.title,
                    date: row.date,
                    dateTimestamp: row.date_timestamp || row.dateTimestamp,
                    type: row.type,
                    status: row.status,
                    minutes: row.minutes,
                    agendaItemTitles: row.agenda_item_titles || row.agendaItemTitles || [],
                    resolutions: row.resolutions || [],
                    attendeeNames: row.attendee_names || row.attendeeNames || [],
                },
                textMatch: 1,
                vectorDistance: undefined
            })),
            found: data.length,
            searchTimeMs: 0
        };

    } catch (error) {
        logger.error('Supabase', 'Search meetings failed', { error, query });
        timer.end({ error: true });
        throw error;
    }
};

/**
 * Search specifically for Resolutions (by searching meetings and filtering)
 * Returns a format compatible with the ResolutionsPage
 */
export const searchResolutions = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<{
    id: string;
    meetingId: string;
    meetingTitle: string;
    date: string;
    number: string;
    content: string;
    topicTitle: string;
}>> => {
    // 1. Find meetings containing the text/meaning
    const meetingResults = await searchMeetings(query, options);

    // 2. Extract relevant resolutions from the hits
    // Since Supabase FTS matches the whole meeting, we need to find which resolution matched.
    // For semantic search (vector), it's harder to pinpoint without Per-Resolution Embeddings.
    // GUIDANCE: We will perform client-side filtering on the returned meetings to find the best matching resolutions.

    const hits: any[] = [];
    const lowerQuery = query.toLowerCase();

    for (const hit of meetingResults.hits) {
        const m = hit.document;

        // Check legacy array of strings structure (if we only have raw strings)
        // OR check structured data if available (we might need to fetch full object if search result is partial)
        // Currently 'searchMeetings' returns 'resolutions: string[]'

        if (m.resolutions && m.resolutions.length > 0) {
            m.resolutions.forEach((resContent, idx) => {
                // Simple Matcher: specific keywords or fuzzy
                if (resContent.toLowerCase().includes(lowerQuery)) {
                    hits.push({
                        document: {
                            id: `${m.id}-${idx}`, // Synthetic ID
                            meetingId: m.id,
                            meetingTitle: m.title,
                            date: m.date,
                            number: 'N/A', // We might lose the number in the string-only array. Ideally specific resolution objects should be indexed.
                            content: resContent,
                            topicTitle: "Résolution trouvée"
                        },
                        textMatch: hit.textMatch,
                        vectorDistance: hit.vectorDistance
                    });
                }
            });
        }
    }

    return {
        hits,
        found: hits.length,
        searchTimeMs: meetingResults.searchTimeMs
    };
};

/**
 * Text Search for Projects
 * Projects table doesn't have an RPC in our setup yet, so we use standard PostgREST FTS.
 */
export const searchProjects = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<SearchableProject>> => {
    const timer = logger.time('Supabase', 'Search projects');
    const supabase = getSupabase();

    try {
        const { matchCount = 10 } = options;

        // Perform Text Search on FTS index (name + description + notes)
        // We constructed the index in SQL: to_tsvector('french', name || ' ' || description || ' ' || notes)
        // PostgREST syntax for FTS across multiple columns is tricky without a generated column or stored procedure.
        // Simplest approach: Use 'or' with ilike or textSearch if columns are indexed individually.

        // Better: We added a GIN index on expression, but PostgREST only exposes columns.
        // We should probably rely on a simple 'ilike' for now or a proper textSearch on 'name'.

        // Let's use a simple ilike on name for now, or textSearch if we had a TSVECTOR column.
        // Since we didn't create a generated TSVECTOR column in the SQL (we created an INDEX on expression), 
        // Supabase/PostgREST can't directly query that index via API unless we use a function or mapped column.

        // FALLBACK: 'ilike' filter (less performant but works out of the box)
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
            .limit(matchCount);

        if (error) throw error;

        timer.end({ found: data?.length || 0 });

        return {
            hits: (data || []).map((row: any) => ({
                document: {
                    id: row.id,
                    code: row.code,
                    name: row.name,
                    description: row.description,
                    category: row.category,
                    status: row.status,
                    priority: row.priority,
                    notes: row.notes
                },
                textMatch: 1
            })),
            found: data?.length || 0,
            searchTimeMs: 0
        };

    } catch (error) {
        logger.error('Supabase', 'Search projects failed', { error, query });
        timer.end({ error: true });
        throw error;
    }
};

/**
 * Hybrid Search for Regulations (Vector + Keyword)
 * Uses the `hybrid_search_regulations` RPC function.
 */
export const searchRegulations = async (
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult<SearchableRegulation>> => {
    const timer = logger.time('Supabase', 'Search regulations');
    const supabase = getSupabase();

    try {
        const { matchThreshold = 0.5, matchCount = 10 } = options;

        let data: any[] = [];

        // If query is empty, just fetch all regulations without search
        if (!query || query.trim() === '') {
            const result = await supabase
                .from('regulations')
                .select('*')
                .order('year', { ascending: false })
                .limit(matchCount);
            data = result.data || [];
            timer.end({ found: data.length });
            return {
                hits: data.map((row: any) => ({
                    document: {
                        id: row.id,
                        title: row.title,
                        content: row.content,
                        category: row.category,
                        year: row.year,
                        status: row.status,
                    },
                    textMatch: 1,
                    vectorDistance: undefined
                })),
                found: data.length,
                searchTimeMs: 0
            };
        }

        // Generate embedding for semantic search
        let queryEmbedding: number[] = [];
        try {
            queryEmbedding = await aiService.generateEmbedding(query);
        } catch (e) {
            console.warn("Failed to generate embedding for query", e);
        }

        // Perform parallel hybrid search and fuse with RRF
        if (queryEmbedding.length > 0) {
            const [vectorRes, ftsRes] = await Promise.allSettled([
                supabase.rpc('hybrid_search_regulations', {
                    query_text: query,
                    query_embedding: queryEmbedding,
                    match_threshold: matchThreshold,
                    match_count: matchCount * 2
                }),
                supabase
                    .from('regulations')
                    .select('*')
                    .textSearch('content', query, { type: 'websearch', config: 'french' })
                    .limit(matchCount * 2)
            ]);

            let vectorDocs: any[] = [];
            let ftsDocs: any[] = [];

            if (vectorRes.status === 'fulfilled' && vectorRes.value.data) {
                vectorDocs = vectorRes.value.data;
            }
            if (ftsRes.status === 'fulfilled' && ftsRes.value.data) {
                ftsDocs = ftsRes.value.data;
            }

            if (vectorDocs.length > 0 || ftsDocs.length > 0) {
                const combined = combineHitsRRF(vectorDocs, ftsDocs, matchCount);
                timer.end({ found: combined.length });
                return {
                    hits: combined.map(c => ({
                        document: {
                            id: c.document.id,
                            title: c.document.title,
                            content: c.document.content,
                            category: c.document.category,
                            year: c.document.year,
                            status: c.document.status,
                        },
                        textMatch: c.textMatch,
                        vectorDistance: c.vectorDistance
                    })),
                    found: combined.length,
                    searchTimeMs: 0
                };
            }
        }

        // Fallback: Text search
        const result = await supabase
            .from('regulations')
            .select('*')
            .textSearch('content', query, { type: 'websearch', config: 'french' })
            .limit(matchCount);
        data = result.data || [];
        
        timer.end({ found: data.length });

        return {
            hits: data.map((row: any) => ({
                document: {
                    id: row.id,
                    title: row.title,
                    content: row.content,
                    category: row.category,
                    year: row.year,
                    status: row.status,
                },
                textMatch: 1,
                vectorDistance: undefined
            })),
            found: data.length,
            searchTimeMs: 0
        };
    } catch (error) {
        logger.error('Supabase', 'Search regulations failed', { error, query });
        timer.end({ error: true });
        throw error;
    }
};

export const getRegulationsByIds = async (ids: string[]): Promise<SearchableRegulation[]> => {
    if (!ids || ids.length === 0) return [];

    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('regulations')
        .select('*')
        .in('id', ids);

    if (error) {
        console.error('Error fetching regulations by IDs:', error);
        return [];
    }

    return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        category: row.category,
        year: row.year,
        status: row.status,
    }));
};

/**
 * Universal Search (Parallel)
 */
export const searchAll = async (
    query: string,
    options: SearchOptions = {}
): Promise<{
    meetings: SearchResult<SearchableMeeting>;
    projects: SearchResult<SearchableProject>;
    regulations: SearchResult<SearchableRegulation>;
}> => {
    const [meetings, projects, regulations] = await Promise.all([
        searchMeetings(query, options),
        searchProjects(query, options),
        searchRegulations(query, options)
    ]);

    return { meetings, projects, regulations: (regulations as any) }; // fast fix for type mismatch if interface not updated yet
};

export const checkSupabaseHealth = async () => {
    try {
        const supabase = getSupabase();
        const { error } = await supabase.from('meetings').select('id').limit(1);
        return { configured: true, accessible: !error, error: error?.message };
    } catch (e: any) {
        return { configured: false, accessible: false, error: e.message };
    }
}

export default {
    searchMeetings,
    searchProjects,
    searchRegulations,
    getRegulationsByIds,
    searchAll,
    checkSupabaseHealth
};
