/**
 * Firestore Query Optimization Utilities
 * Helpers for optimizing Firestore queries
 */

import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getCountFromServer,
    QueryConstraint,
    type DocumentData,
    Query,
    AggregateField,
    getAggregateFromServer,
    sum,
    average,
    count
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { logger } from '../utils/logger';

// ============================================
// AGGREGATE QUERIES
// ============================================

export interface AggregateResult {
    count: number;
    sum?: number;
    average?: number;
}

/**
 * Get count without fetching documents (efficient for large collections)
 */
export const getCollectionCount = async (
    collectionName: string,
    constraints: QueryConstraint[] = []
): Promise<number> => {
    try {
        const q = query(collection(db, collectionName), ...constraints);
        const snapshot = await getCountFromServer(q);
        return snapshot.data().count;
    } catch (error) {
        logger.error('FirestoreOptim', 'Count query failed', { collectionName, error });
        throw error;
    }
};

/**
 * Get aggregates (count, sum, average) without fetching documents
 */
export const getAggregates = async (
    collectionName: string,
    options: {
        constraints?: QueryConstraint[];
        sumField?: string;
        averageField?: string;
    } = {}
): Promise<AggregateResult> => {
    const { constraints = [], sumField, averageField } = options;

    try {
        const q = query(collection(db, collectionName), ...constraints);

        // Build aggregate spec
        const aggregateSpec: Record<string, AggregateField<number>> = {
            count: count()
        };

        if (sumField) {
            aggregateSpec.sum = sum(sumField);
        }
        if (averageField) {
            aggregateSpec.average = average(averageField);
        }

        const snapshot = await getAggregateFromServer(q, aggregateSpec);

        return {
            count: snapshot.data().count,
            sum: sumField ? snapshot.data().sum : undefined,
            average: averageField ? snapshot.data().average : undefined
        };
    } catch (error) {
        logger.error('FirestoreOptim', 'Aggregate query failed', { collectionName, error });
        throw error;
    }
};

// ============================================
// BATCH QUERIES
// ============================================

/**
 * Fetch documents in parallel batches for better performance
 * Useful when you need to query multiple conditions that can't be combined
 */
export const batchQuery = async <T extends DocumentData>(
    collectionRef: import('firebase/firestore').CollectionReference | string,
    fieldPath: string,
    values: unknown[]
): Promise<T[]> => {
    const timer = logger.time('FirestoreOptim', 'Batch query');

    try {
        if (!values || values.length === 0) return [];

        // Firestore 'in' queries are limited to 30 values
        const BATCH_SIZE = 30;
        const chunks = [];
        for (let i = 0; i < values.length; i += BATCH_SIZE) {
            chunks.push(values.slice(i, i + BATCH_SIZE));
        }

        const promises = chunks.map(chunk => {
            const ref = typeof collectionRef === 'string'
                ? collection(db, collectionRef)
                : collectionRef;
            return getDocs(query(ref, where(fieldPath, 'in', chunk)));
        });

        const snapshots = await Promise.all(promises);

        // Merge results, dedupe by ID
        const resultsMap = new Map<string, T>();
        snapshots.forEach(snapshot => {
            snapshot.docs.forEach(doc => {
                if (!resultsMap.has(doc.id)) {
                    resultsMap.set(doc.id, { id: doc.id, ...doc.data() } as unknown as T);
                }
            });
        });

        timer.end({ batchCount: chunks.length, resultCount: resultsMap.size });
        return Array.from(resultsMap.values());

    } catch (error) {
        logger.error('FirestoreOptim', 'Batch query failed', { error });
        throw error;
    }
};

// ============================================
// SELECTIVE FIELD LOADING
// ============================================

/**
 * Project only needed fields from documents (reduces bandwidth)
 * Note: Firestore doesn't support field projection in queries,
 * but we can filter fields client-side after fetch
 */
export const projectFields = <T extends DocumentData>(
    documents: T[],
    fields: (keyof T)[]
): Partial<T>[] => {
    return documents.map(doc => {
        const projected: Partial<T> = { id: (doc as { id?: string }).id } as unknown as Partial<T>;
        fields.forEach(field => {
            if (field in doc) {
                projected[field] = doc[field];
            }
        });
        return projected;
    });
};

// ============================================
// QUERY BUILDERS
// ============================================

export interface QueryBuilderOptions<T> {
    collectionName: string;
    filters?: {
        field: keyof T;
        operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains' | 'in';
        value: unknown;
    }[];
    orderByField?: keyof T;
    orderDirection?: 'asc' | 'desc';
    limitCount?: number;
}

/**
 * Build optimized query from options
 */
export const buildOptimizedQuery = <T extends DocumentData>(
    options: QueryBuilderOptions<T>
): Query => {
    const constraints: QueryConstraint[] = [];

    // Add filters
    options.filters?.forEach(filter => {
        constraints.push(where(filter.field as string, filter.operator, filter.value));
    });

    // Add ordering
    if (options.orderByField) {
        constraints.push(orderBy(options.orderByField as string, options.orderDirection || 'asc'));
    }

    // Add limit
    if (options.limitCount) {
        constraints.push(limit(options.limitCount));
    }

    return query(collection(db, options.collectionName), ...constraints);
};

// ============================================
// CACHE HELPERS
// ============================================

const queryCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Execute query with short-term caching
 */
export const cachedQuery = async <T extends DocumentData>(
    cacheKey: string,
    queryFn: () => Promise<T[]>,
    ttlMs: number = CACHE_TTL_MS
): Promise<T[]> => {
    const cached = queryCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < ttlMs) {
        logger.debug('FirestoreOptim', `Cache hit for ${cacheKey}`);
        return cached.data as T[];
    }

    const data = await queryFn();
    queryCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
};

/**
 * Invalidate cache entry or all entries
 */
export const invalidateCache = (cacheKey?: string): void => {
    if (cacheKey) {
        queryCache.delete(cacheKey);
    } else {
        queryCache.clear();
    }
};

// ============================================
// STATS HELPERS FOR DASHBOARD
// ============================================

export interface ProjectStats {
    total: number;
    byStatus: Record<string, number>;
    urgent: number;
}

/**
 * Get project statistics efficiently using aggregates
 */
export const getProjectStats = async (): Promise<ProjectStats> => {
    const timer = logger.time('FirestoreOptim', 'Project stats');

    try {
        // Use cached query for stats
        return await cachedQuery('project_stats', async () => {
            const [total, pending, inProgress, completed, blocked, urgent] = await Promise.all([
                getCollectionCount('projects'),
                getCollectionCount('projects', [where('status', '==', 'pending')]),
                getCollectionCount('projects', [where('status', '==', 'in_progress')]),
                getCollectionCount('projects', [where('status', '==', 'completed')]),
                getCollectionCount('projects', [where('status', '==', 'blocked')]),
                getCollectionCount('projects', [where('isUrgent', '==', true)])
            ]);

            timer.end();

            return [{
                total,
                byStatus: { pending, in_progress: inProgress, completed, blocked },
                urgent
            }];
        }) as unknown as ProjectStats;
    } catch (error) {
        timer.end({ error: true });
        throw error;
    }
};
