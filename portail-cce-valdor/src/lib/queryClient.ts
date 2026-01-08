import { QueryClient } from '@tanstack/react-query';

/**
 * React Query client configuration
 * 
 * - staleTime: 5 minutes - data is considered fresh for 5 minutes
 * - gcTime: 30 minutes - cached data is garbage collected after 30 minutes
 * - retry: 1 - retry failed requests once
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            gcTime: 30 * 60 * 1000, // 30 minutes (previously cacheTime)
            retry: 1,
            refetchOnWindowFocus: false, // Don't refetch when window regains focus
        },
    },
});

export default queryClient;
