import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallableContext } from "firebase-functions/v1/https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

// Standard initialization
try {
    admin.initializeApp();
} catch (e) {
    console.warn('Firebase Admin already initialized or failed init:', e);
}

interface TranscriptionRequest {
    meetingId: string;
    storagePath: string;
    mimeType: string;
}

export const transcribeAudio = functions
    .runWith({
        timeoutSeconds: 540,
        memory: "2GB"
    })
    .https.onCall(async (data: TranscriptionRequest, context: CallableContext) => {
        console.log('[Parallel Chunking] Function Start. Data:', JSON.stringify(data));

        try {
            if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

            const config = functions.config();
            const GEMINI_API_KEY = config.google?.api_key || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_AI_API;

            if (!GEMINI_API_KEY) throw new functions.https.HttpsError("failed-precondition", "API Key missing.");

            const { meetingId, storagePath, mimeType } = data;
            if (!meetingId || !storagePath || !mimeType) throw new functions.https.HttpsError("invalid-argument", "Missing params.");

            // 1. Download
            const bucket = admin.storage().bucket();
            const tempFilePath = path.join(os.tmpdir(), `audio-${meetingId}${path.extname(storagePath)}`);
            console.log(`[Chunking] Downloading ${storagePath}...`);
            await bucket.file(storagePath).download({ destination: tempFilePath });

            // 2. Upload to File API
            const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: mimeType,
                displayName: `Meeting ${meetingId}`
            });
            const file = uploadResult.file;
            console.log(`[Chunking] File uploaded: ${file.uri}`);

            // Wait for processing
            let processedFile = await fileManager.getFile(file.name);
            while (processedFile.state === FileState.PROCESSING) {
                console.log('[Chunking] Waiting for processing...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                processedFile = await fileManager.getFile(file.name);
            }
            if (processedFile.state === FileState.FAILED) throw new Error("File processing failed.");

            // 3. Define Chunks (20 minutes each)
            // 1h30 = 90 mins. 5 chunks of 20m covers 100m. Safe.
            const chunkDurationMins = 20;
            const totalChunks = 6; // Up to 2 hours coverage
            const chunks = [];

            for (let i = 0; i < totalChunks; i++) {
                chunks.push({
                    index: i,
                    start: i * chunkDurationMins,
                    end: (i + 1) * chunkDurationMins
                });
            }

            console.log(`[Chunking] Starting ${chunks.length} parallel requests...`);
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            // 4. Parallel Execution
            const promises = chunks.map(async (chunk) => {
                const prompt = `Tu es un secrétaire. Transcris EXCLUSIVEMENT la partie de l'audio comprise entre la minute ${chunk.start} et la minute ${chunk.end}.
            
RÈGLES :
1. Ignore tout ce qui est avant ${chunk.start}e minute ou après ${chunk.end}e minute.
2. Transcris fidèlement mot à mot.
3. Identifie les intervenants en gras (**Nom :**).
4. Si c'est la fin du fichier, arrête-toi simplement.
`;
                try {
                    const result = await model.generateContent({
                        contents: [{
                            role: "user",
                            parts: [
                                { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
                                { text: prompt }
                            ]
                        }],
                        generationConfig: { maxOutputTokens: 65536, temperature: 0.2 }
                    });
                    const text = result.response.text();
                    console.log(`[Chunk ${chunk.index}] Completed (${text.length} chars)`);
                    return { index: chunk.index, text: text };
                } catch (err) {
                    console.error(`[Chunk ${chunk.index}] Failed`, err);
                    return { index: chunk.index, text: `[Erreur transcription partie ${chunk.index + 1}]` };
                }
            });

            const results = await Promise.all(promises);

            // 5. Sort and Join
            const fullTranscription = results
                .sort((a, b) => a.index - b.index)
                .map(r => `\n\n--- PARTIE ${r.index + 1} (${r.index * 20}m - ${(r.index + 1) * 20}m) ---\n\n` + r.text)
                .join("");

            console.log(`[Chunking] All parts joined. Total length: ${fullTranscription.length}`);

            // 6. Cleanup
            await fileManager.deleteFile(file.name).catch(e => console.warn('Cleanup error', e));
            fs.unlinkSync(tempFilePath);

            // 7. Save
            await admin.firestore().doc(`meetings/${meetingId}`).update({
                'audioRecording.transcription': fullTranscription,
                'audioRecording.transcriptionStatus': 'completed',
                'audioRecording.transcribedAt': new Date().toISOString(),
                dateUpdated: new Date().toISOString()
            });

            return { success: true, transcription: fullTranscription };

        } catch (error) {
            console.error('[Plan B CRASH]', error);
            throw new functions.https.HttpsError("internal", error instanceof Error ? error.message : "Internal Error");
        }
    });
