const admin = require('firebase-admin');

// Ensure we initialize admin properly
if (!admin.apps.length) {
    admin.initializeApp({
      projectId: "portail-cce-valdor" // Replace if you know the exact project id, but defaults usually work locally via emulator or default creds
    });
}

const db = admin.firestore();

async function checkMembers() {
    try {
        const snapshot = await db.collection('members').get();
        console.log(`Found ${snapshot.size} members.`);
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`Member: ${data.displayName || data.name} - voiceSampleCount: ${data.voiceSampleCount || 0}`);
        });
    } catch (e) {
        console.error("Error connecting to Firestore:", e);
    }
}

checkMembers();
