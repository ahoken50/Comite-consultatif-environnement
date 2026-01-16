/// <reference types="node" />

/**
 * Migration Script: Update Document agendaItemId to use stable IDs
 * 
 * Purpose: Update all documents' agendaItemId from old unstable format 
 * (patched-{timestamp}-{index}) to new stable format ({meetingId}-item-{index})
 * 
 * How to run:
 * 1. npm install -g ts-node (if not installed)
 * 2. ts-node scripts/migrate-agenda-item-ids.ts
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';

// Firebase config - IMPORTANT: Update with your actual config
const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

interface AgendaItem {
    id: string;
    title: string;
    [key: string]: any;
}

interface Meeting {
    id: string;
    agendaItems?: AgendaItem[];
    [key: string]: any;
}

interface Document {
    id: string;
    agendaItemId?: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
    name: string;
    [key: string]: any;
}

async function migrateAgendaItemIds() {
    console.log('🚀 Starting migration of agendaItemId...\n');

    try {
        // Step 1: Fetch all meetings
        console.log('📋 Fetching all meetings...');
        const meetingsSnapshot = await getDocs(collection(db, 'meetings'));
        const meetings: Meeting[] = meetingsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Meeting));
        console.log(`✅ Found ${meetings.length} meetings\n`);

        // Step 2: Build mapping of old IDs to new IDs
        console.log('🔄 Building ID mapping...');
        const idMapping = new Map<string, { newId: string; meetingId: string; index: number; title: string }>();

        for (const meeting of meetings) {
            if (!meeting.agendaItems || meeting.agendaItems.length === 0) {
                continue;
            }

            meeting.agendaItems.forEach((item, index) => {
                const oldId = item.id;
                const newId = `${meeting.id}-item-${index}`;

                // Only map if the old ID is a "patched" ID
                if (oldId && oldId.startsWith('patched-')) {
                    idMapping.set(oldId, {
                        newId,
                        meetingId: meeting.id,
                        index,
                        title: item.title
                    });
                    console.log(`  📍 ${oldId} → ${newId} (${item.title})`);
                }
            });
        }
        console.log(`✅ Created ${idMapping.size} ID mappings\n`);

        // Step 3: Fetch all documents
        console.log('📄 Fetching all documents...');
        const documentsSnapshot = await getDocs(collection(db, 'documents'));
        const documents: Document[] = documentsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Document));
        console.log(`✅ Found ${documents.length} documents\n`);

        // Step 4: Find documents that need updating
        console.log('🔍 Finding documents to update...');
        const documentsToUpdate: Array<{ docId: string; oldAgendaItemId: string; newAgendaItemId: string; docName: string }> = [];

        for (const document of documents) {
            if (document.agendaItemId && idMapping.has(document.agendaItemId)) {
                const mapping = idMapping.get(document.agendaItemId)!;
                documentsToUpdate.push({
                    docId: document.id,
                    oldAgendaItemId: document.agendaItemId,
                    newAgendaItemId: mapping.newId,
                    docName: document.name
                });
                console.log(`  🔗 "${document.name}" → ${mapping.title}`);
            }
        }
        console.log(`✅ Found ${documentsToUpdate.length} documents to update\n`);

        if (documentsToUpdate.length === 0) {
            console.log('✨ No documents need updating. Migration complete!');
            return;
        }

        // Step 5: Confirm before proceeding
        console.log('⚠️  READY TO UPDATE:');
        console.log(`   - ${documentsToUpdate.length} documents will be updated`);
        console.log(`   - This will change their agendaItemId to the new stable format\n`);

        // In a real script, you might want to add a confirmation prompt here
        // For now, we'll proceed automatically

        // Step 6: Update documents in batches (Firestore batch limit is 500)
        console.log('💾 Updating documents...');
        const batchSize = 500;
        let updatedCount = 0;

        for (let i = 0; i < documentsToUpdate.length; i += batchSize) {
            const batch = writeBatch(db);
            const batchDocs = documentsToUpdate.slice(i, i + batchSize);

            for (const { docId, newAgendaItemId } of batchDocs) {
                const docRef = doc(db, 'documents', docId);
                batch.update(docRef, { agendaItemId: newAgendaItemId });
            }

            await batch.commit();
            updatedCount += batchDocs.length;
            console.log(`  ✅ Updated ${updatedCount} / ${documentsToUpdate.length} documents`);
        }

        console.log('\n🎉 Migration completed successfully!');
        console.log(`   - Updated ${updatedCount} documents`);
        console.log(`   - Document-agenda associations have been restored\n`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

// Run migration
migrateAgendaItemIds()
    .then(() => {
        console.log('✅ Script finished successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
