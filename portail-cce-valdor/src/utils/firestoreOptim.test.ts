import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchQuery } from './firestoreOptim';
import { where, getDocs } from 'firebase/firestore';

// Mock dependencies
vi.mock('firebase/firestore', () => {
    return {
        collection: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        getDocs: vi.fn(),
    };
});

// Mock db
vi.mock('../services/firebase', () => ({
    db: {}
}));

// Mock logger
vi.mock('./logger', () => ({
    logger: {
        time: vi.fn(() => ({ end: vi.fn() })),
        error: vi.fn(),
        debug: vi.fn()
    }
}));

describe('batchQuery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns an empty array when values is empty', async () => {
        const result = await batchQuery('test_collection', 'id', []);
        expect(result).toEqual([]);
        expect(getDocs).not.toHaveBeenCalled();
    });

    it('returns an empty array when values is null', async () => {
        const result = await batchQuery('test_collection', 'id', null as unknown as unknown[]);
        expect(result).toEqual([]);
        expect(getDocs).not.toHaveBeenCalled();
    });

    it('queries once if values has <= 30 items', async () => {
        const values = Array.from({ length: 25 }, (_, i) => i.toString());

        // Mock getDocs to return some fake docs
        const fakeDocs = values.map(v => ({ id: v, data: () => ({ value: v }) }));
        vi.mocked(getDocs).mockResolvedValueOnce({
            docs: fakeDocs,
        } as unknown as ReturnType<typeof getDocs>);

        const result = await batchQuery('test_collection', 'some_field', values);

        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(where).toHaveBeenCalledWith('some_field', 'in', values);

        // Should map result correctly
        expect(result).toHaveLength(25);
        expect(result[0]).toEqual({ id: '0', value: '0' });
    });

    it('chunks values into groups of 30 if values > 30 items', async () => {
        const values = Array.from({ length: 75 }, (_, i) => i.toString());

        // Mock getDocs sequentially
        vi.mocked(getDocs)
            .mockResolvedValueOnce({
                docs: values.slice(0, 30).map(v => ({ id: v, data: () => ({ value: v }) })),
            } as unknown as ReturnType<typeof getDocs>)
            .mockResolvedValueOnce({
                docs: values.slice(30, 60).map(v => ({ id: v, data: () => ({ value: v }) })),
            } as unknown as ReturnType<typeof getDocs>)
            .mockResolvedValueOnce({
                docs: values.slice(60, 75).map(v => ({ id: v, data: () => ({ value: v }) })),
            } as unknown as ReturnType<typeof getDocs>);

        const result = await batchQuery('test_collection', 'some_field', values);

        expect(getDocs).toHaveBeenCalledTimes(3);

        // Check exact chunking for 'where'
        expect(where).toHaveBeenNthCalledWith(1, 'some_field', 'in', values.slice(0, 30));
        expect(where).toHaveBeenNthCalledWith(2, 'some_field', 'in', values.slice(30, 60));
        expect(where).toHaveBeenNthCalledWith(3, 'some_field', 'in', values.slice(60, 75));

        expect(result).toHaveLength(75);
    });

    it('deduplicates results based on doc.id', async () => {
        const values = ['1', '2', '3']; // assume chunk size 30, so 1 query

        // Mock getDocs to return duplicated IDs
        const fakeDocs = [
            { id: '1', data: () => ({ value: '1' }) },
            { id: '1', data: () => ({ value: '1-duplicate' }) },
            { id: '2', data: () => ({ value: '2' }) }
        ];

        vi.mocked(getDocs).mockResolvedValueOnce({
            docs: fakeDocs,
        } as unknown as ReturnType<typeof getDocs>);

        const result = await batchQuery('test_collection', 'some_field', values);

        // Deduplication keeps the first occurrence based on the Map implementation
        expect(result).toHaveLength(2);
        const id1Doc = result.find((r: { id: string }) => r.id === '1');
        expect(id1Doc).toEqual({ id: '1', value: '1' });
    });

    it('throws error and logs it if a query fails', async () => {
        const values = ['1', '2', '3'];

        vi.mocked(getDocs).mockRejectedValueOnce(new Error('Firebase Error'));

        await expect(batchQuery('test_collection', 'some_field', values)).rejects.toThrow('Firebase Error');
    });
});
