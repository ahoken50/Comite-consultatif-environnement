import { openDB, type IDBPDatabase } from 'idb';
import { db } from './firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

const DB_NAME = 'cce-offline-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export const getDB = (): Promise<IDBPDatabase> | null => {
  if (typeof window === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('regulations')) {
          db.createObjectStore('regulations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meetings')) {
          db.createObjectStore('meetings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
};

export interface SyncQueueItem {
  id?: number;
  action: 'set' | 'delete';
  collection: string;
  docId: string;
  data?: any;
  timestamp: number;
}

// Regulations Cache
export const cacheRegulationsOffline = async (regulations: any[]): Promise<void> => {
  const idb = await getDB();
  if (!idb) return;
  const tx = idb.transaction('regulations', 'readwrite');
  const store = tx.objectStore('regulations');
  await store.clear();
  for (const reg of regulations) {
    await store.put(reg);
  }
  await tx.done;
  console.log(`[OfflineService] Cached ${regulations.length} regulations locally`);
};

export const getRegulationsOffline = async (): Promise<any[]> => {
  const idb = await getDB();
  if (!idb) return [];
  return idb.getAll('regulations');
};

// Meetings Cache
export const cacheMeetingsOffline = async (meetings: any[]): Promise<void> => {
  const idb = await getDB();
  if (!idb) return;
  const tx = idb.transaction('meetings', 'readwrite');
  const store = tx.objectStore('meetings');
  await store.clear();
  for (const m of meetings) {
    await store.put(m);
  }
  await tx.done;
  console.log(`[OfflineService] Cached ${meetings.length} meetings locally`);
};

export const getMeetingsOffline = async (): Promise<any[]> => {
  const idb = await getDB();
  if (!idb) return [];
  return idb.getAll('meetings');
};

// Sync Queue management
export const queueOfflineSync = async (
  action: 'set' | 'delete',
  collectionName: string,
  docId: string,
  data?: any
): Promise<void> => {
  const idb = await getDB();
  if (!idb) return;
  
  const queueItem: SyncQueueItem = {
    action,
    collection: collectionName,
    docId,
    data,
    timestamp: Date.now()
  };

  await idb.add('sync_queue', queueItem);
  console.log(`[OfflineService] Queued offline sync: ${action} on ${collectionName}/${docId}`);
  
  // Try to sync immediately if we happen to be online
  if (navigator.onLine) {
    processOfflineSyncQueue();
  }
};

// Process Queue
export const processOfflineSyncQueue = async (): Promise<void> => {
  if (!navigator.onLine) return;
  
  const idb = await getDB();
  if (!idb) return;

  const queue: SyncQueueItem[] = await idb.getAll('sync_queue');
  if (queue.length === 0) return;

  console.log(`[OfflineService] Processing offline sync queue: ${queue.length} items`);

  for (const item of queue) {
    try {
      const docRef = doc(db, item.collection, item.docId);
      
      if (item.action === 'set') {
        await setDoc(docRef, item.data, { merge: true });
        console.log(`[OfflineService] Synchronized set on ${item.collection}/${item.docId}`);
      } else if (item.action === 'delete') {
        await deleteDoc(docRef);
        console.log(`[OfflineService] Synchronized delete on ${item.collection}/${item.docId}`);
      }

      // Remove from IndexedDB queue
      if (item.id !== undefined) {
        await idb.delete('sync_queue', item.id);
      }
    } catch (err) {
      console.error(`[OfflineService] Sync failed for queue item ${item.id}:`, err);
      // Skip it to avoid blocking the entire queue, or retry later
    }
  }
};

// Automatically process queue when connection is restored
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineService] Connection recovered. Triggering synchronization...');
    processOfflineSyncQueue();
  });
}
