import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

interface SecureAudioDB extends DBSchema {
    recordings: {
        key: string;
        value: {
            id: string;
            timestamp: number;
            mimeType: string;
            status: 'recording' | 'completed';
            chunkCount: number;
        };
        indexes: { 'by-status': string };
    };
    chunks: {
        key: [string, number]; // [recordingId, chunkIndex]
        value: {
            recordingId: string;
            index: number;
            data: Blob;
        };
    };
}

export interface RecordingMetadata {
    id: string;
    timestamp: number;
    mimeType: string;
    chunkCount: number;
    status: 'recording' | 'completed';
}

class SecureRecordingManager {
    private dbName = 'cce-secure-audio-v1';
    private dbPromise: Promise<IDBPDatabase<SecureAudioDB>>;

    constructor() {
        this.dbPromise = openDB<SecureAudioDB>(this.dbName, 1, {
            upgrade(db) {
                const recordingStore = db.createObjectStore('recordings', { keyPath: 'id' });
                recordingStore.createIndex('by-status', 'status');

                // Composite key for chunks: [recordingId, index] ensures ordering
                db.createObjectStore('chunks', { keyPath: ['recordingId', 'index'] });
            },
        });
    }

    /**
     * Start a new recording session
     */
    async startRecording(mimeType: string): Promise<string> {
        const db = await this.dbPromise;
        const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        await db.put('recordings', {
            id,
            timestamp: Date.now(),
            mimeType,
            status: 'recording',
            chunkCount: 0
        });

        return id;
    }

    /**
     * Save a single chunk of audio
     */
    async saveChunk(recordingId: string, chunk: Blob, index: number): Promise<void> {
        const db = await this.dbPromise;

        // Save chunk
        await db.put('chunks', {
            recordingId,
            index,
            data: chunk
        });

        // Update metadata
        const metadata = await db.get('recordings', recordingId);
        if (metadata) {
            metadata.chunkCount = Math.max(metadata.chunkCount, index + 1);
            await db.put('recordings', metadata);
        }
    }

    /**
     * Mark recording as completed (safe to delete after upload)
     */
    async completeRecording(recordingId: string): Promise<void> {
        const db = await this.dbPromise;
        const metadata = await db.get('recordings', recordingId);
        if (metadata) {
            metadata.status = 'completed';
            await db.put('recordings', metadata);
        }
    }

    /**
     * List incomplete recordings (crashed sessions)
     */
    async listPendingRecordings(): Promise<RecordingMetadata[]> {
        const db = await this.dbPromise;
        return db.getAllFromIndex('recordings', 'by-status', 'recording');
    }

    /**
     * Reconstruct the full audio Blob from chunks
     */
    async recoverRecording(recordingId: string): Promise<Blob | null> {
        const db = await this.dbPromise;
        const metadata = await db.get('recordings', recordingId);

        if (!metadata) return null;

        // Get all chunks for this recording
        // Since we can't easily range query on composite keys in simple idb wrapper without range,
        // we'll get all chunks and filter. For huge DBs this is inefficient, but for local audio cache it's fine.
        // Optimization: Use cursor or range if needed.
        // Better approach: getAll with IDBKeyRange if possible, but 'chunks' store uses array key.
        // Let's iterate.

        const chunks: Blob[] = [];
        let index = 0;

        while (true) {
            const chunk = await db.get('chunks', [recordingId, index]);
            if (!chunk) break;
            chunks.push(chunk.data);
            index++;
        }

        if (chunks.length === 0) return null;

        return new Blob(chunks, { type: metadata.mimeType });
    }

    /**
     * Delete recording and its chunks
     */
    async deleteRecording(recordingId: string): Promise<void> {
        const db = await this.dbPromise;

        // Delete metadata
        await db.delete('recordings', recordingId);

        // Delete chunks - iterating and deleting
        let index = 0;
        while (true) {
            const key: [string, number] = [recordingId, index];
            const chunk = await db.get('chunks', key);
            if (!chunk) break;
            await db.delete('chunks', key);
            index++;
        }
    }
}

export const secureRecordingManager = new SecureRecordingManager();
