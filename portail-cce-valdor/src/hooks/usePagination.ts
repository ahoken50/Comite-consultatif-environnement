/**
 * Firestore Pagination Hook
 * Provides cursor-based pagination for Firestore queries
 */

import { useState, useCallback, useEffect } from 'react';
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    endBefore,
    limitToLast,
    getDocs,
    getCountFromServer,
    QueryConstraint,
    type DocumentData,
    QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { logger } from '../utils/logger';

export interface PaginationState<T> {
    items: T[];
    loading: boolean;
    error: string | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    currentPage: number;
    totalPages: number;
    totalItems: number;
}

export interface PaginationActions {
    nextPage: () => Promise<void>;
    previousPage: () => Promise<void>;
    goToPage: (page: number) => Promise<void>;
    refresh: () => Promise<void>;
}

export interface UsePaginationOptions {
    collectionName: string;
    pageSize?: number;
    orderByField?: string;
    orderDirection?: 'asc' | 'desc';
    constraints?: QueryConstraint[];
}

export const usePagination = <T extends DocumentData>(
    options: UsePaginationOptions
): [PaginationState<T>, PaginationActions] => {
    const {
        collectionName,
        pageSize = 10,
        orderByField = 'dateCreated',
        orderDirection = 'desc',
        constraints = []
    } = options;

    const [state, setState] = useState<PaginationState<T>>({
        items: [],
        loading: true,
        error: null,
        hasNextPage: false,
        hasPreviousPage: false,
        currentPage: 1,
        totalPages: 1,
        totalItems: 0
    });

    // Store cursors for pagination
    const [cursors, setCursors] = useState<{
        firstDoc: QueryDocumentSnapshot | null;
        lastDoc: QueryDocumentSnapshot | null;
        pageFirstDocs: Map<number, QueryDocumentSnapshot>;
    }>({
        firstDoc: null,
        lastDoc: null,
        pageFirstDocs: new Map()
    });

    // Fetch total count
    const fetchTotalCount = useCallback(async (): Promise<number> => {
        try {
            const countQuery = query(
                collection(db, collectionName),
                ...constraints
            );
            const snapshot = await getCountFromServer(countQuery);
            return snapshot.data().count;
        } catch (error) {
            logger.warn('Pagination', 'Count query failed, using estimate', { error });
            return 0;
        }
    }, [collectionName, constraints]);

    // Fetch a page of data
    const fetchPage = useCallback(async (
        direction: 'first' | 'next' | 'previous' | 'specific',
        targetPage?: number
    ) => {
        setState(prev => ({ ...prev, loading: true, error: null }));

        try {
            let queryConstraints: QueryConstraint[] = [
                ...constraints,
                orderBy(orderByField, orderDirection),
            ];

            if (direction === 'first' || direction === 'specific') {
                queryConstraints.push(limit(pageSize));
            } else if (direction === 'next' && cursors.lastDoc) {
                queryConstraints.push(startAfter(cursors.lastDoc), limit(pageSize));
            } else if (direction === 'previous' && cursors.firstDoc) {
                queryConstraints.push(endBefore(cursors.firstDoc), limitToLast(pageSize));
            }

            const q = query(collection(db, collectionName), ...queryConstraints);
            const snapshot = await getDocs(q);

            const items = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as unknown as T));

            // Get total count for pagination info
            const totalItems = await fetchTotalCount();
            const totalPages = Math.ceil(totalItems / pageSize);

            // Calculate new page number
            let newPage = state.currentPage;
            if (direction === 'first') newPage = 1;
            else if (direction === 'next') newPage = state.currentPage + 1;
            else if (direction === 'previous') newPage = state.currentPage - 1;
            else if (direction === 'specific' && targetPage) newPage = targetPage;

            // Update cursors
            if (snapshot.docs.length > 0) {
                const newPageFirstDocs = new Map(cursors.pageFirstDocs);
                newPageFirstDocs.set(newPage, snapshot.docs[0]);

                setCursors({
                    firstDoc: snapshot.docs[0],
                    lastDoc: snapshot.docs[snapshot.docs.length - 1],
                    pageFirstDocs: newPageFirstDocs
                });
            }

            setState({
                items,
                loading: false,
                error: null,
                hasNextPage: newPage < totalPages,
                hasPreviousPage: newPage > 1,
                currentPage: newPage,
                totalPages,
                totalItems
            });

            logger.debug('Pagination', `Fetched page ${newPage}/${totalPages}`, {
                itemCount: items.length,
                totalItems
            });

        } catch (error) {
            const err = error as Error;
            logger.error('Pagination', 'Failed to fetch page', { error: err.message });
            setState(prev => ({
                ...prev,
                loading: false,
                error: 'Erreur lors du chargement des données'
            }));
        }
    }, [
        collectionName,
        constraints,
        orderByField,
        orderDirection,
        pageSize,
        cursors,
        state.currentPage,
        fetchTotalCount
    ]);

    // Initial load
    useEffect(() => {
        fetchPage('first');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionName, pageSize]);

    // Actions
    const actions: PaginationActions = {
        nextPage: async () => {
            if (state.hasNextPage) {
                await fetchPage('next');
            }
        },
        previousPage: async () => {
            if (state.hasPreviousPage) {
                await fetchPage('previous');
            }
        },
        goToPage: async (page: number) => {
            if (page >= 1 && page <= state.totalPages && page !== state.currentPage) {
                // For now, go to first page and iterate (can be optimized with stored cursors)
                await fetchPage('specific', page);
            }
        },
        refresh: async () => {
            setCursors({
                firstDoc: null,
                lastDoc: null,
                pageFirstDocs: new Map()
            });
            await fetchPage('first');
        }
    };

    return [state, actions];
};

export default usePagination;
