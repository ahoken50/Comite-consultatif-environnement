import { useState, useEffect, useCallback, useRef } from 'react';

interface UseInfiniteScrollOptions {
    threshold?: number;  // How many pixels from bottom to trigger
    initialPage?: number;
    pageSize?: number;
}

interface UseInfiniteScrollResult<T> {
    items: T[];
    loading: boolean;
    hasMore: boolean;
    loadMore: () => void;
    reset: () => void;
    setItems: React.Dispatch<React.SetStateAction<T[]>>;
    observerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Custom hook for infinite scroll functionality (#8.7)
 * Uses Intersection Observer for efficient scroll detection
 */
export const useInfiniteScroll = <T>(
    fetchItems: (page: number, pageSize: number) => Promise<T[]>,
    options: UseInfiniteScrollOptions = {}
): UseInfiniteScrollResult<T> => {
    const { threshold = 100, initialPage = 0, pageSize = 20 } = options;

    const [items, setItems] = useState<T[]>([]);
    const [page, setPage] = useState(initialPage);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const observerRef = useRef<HTMLDivElement>(null);

    // Fetch more items
    const loadMore = useCallback(async () => {
        if (loading || !hasMore) return;

        setLoading(true);
        try {
            const newItems = await fetchItems(page, pageSize);

            if (newItems.length < pageSize) {
                setHasMore(false);
            }

            setItems(prev => [...prev, ...newItems]);
            setPage(prev => prev + 1);
        } catch (error) {
            console.error('Error loading more items:', error);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, loading, hasMore, fetchItems]);

    // Reset the list
    const reset = useCallback(() => {
        setItems([]);
        setPage(initialPage);
        setHasMore(true);
    }, [initialPage]);

    // Set up Intersection Observer
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loading) {
                    loadMore();
                }
            },
            { rootMargin: `${threshold}px` }
        );

        const currentRef = observerRef.current;
        if (currentRef) {
            observer.observe(currentRef);
        }

        return () => {
            if (currentRef) {
                observer.unobserve(currentRef);
            }
        };
    }, [hasMore, loading, loadMore, threshold]);

    // Initial load
    useEffect(() => {
        if (items.length === 0 && hasMore) {
            loadMore();
        }
    }, []); // Only on mount

    return {
        items,
        loading,
        hasMore,
        loadMore,
        reset,
        setItems,
        observerRef
    };
};

export default useInfiniteScroll;
