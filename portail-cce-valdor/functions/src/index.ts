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
        console.log('[Plan B] Function Start (File API Mode). Data:', JSON.stringify(data));

        try {
            // 1. Auth Check
            if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

            // 2. Config Check
            const config = functions.config();
            const GEMINI_API_KEY = config.google?.api_key || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_AI_API;

            if (!GEMINI_API_KEY) throw new functions.https.HttpsError("failed-precondition", "API Key missing.");

            const { meetingId, storagePath, mimeType } = data;
            if (!meetingId || !storagePath || !mimeType) throw new functions.https.HttpsError("invalid-argument", "Missing params.");

            // 3. Download to Temp File (Crucial for File API)
            const bucket = admin.storage().bucket();
            const tempFilePath = path.join(os.tmpdir(), `audio-${meetingId}${path.extname(storagePath)}`);

            console.log(`[Plan B] Downloading gs://${bucket.name}/${storagePath} to ${tempFilePath}...`);

            await bucket.file(storagePath).download({
                destination: tempFilePath
            });

            console.log('[Plan B] Download complete. Uploading to Gemini File API...');

            // 4. Upload using SDK
            const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: mimeType,
                displayName: `Meeting ${meetingId}`
            });

            const file = uploadResult.file;
            console.log(`[Plan B] Uploaded file: ${file.name} (${file.uri})`);

            // Wait for processing if video/large audio (usually instant for audio but good practice)
            let processedFile = await fileManager.getFile(file.name);
            while (processedFile.state === FileState.PROCESSING) {
                console.log('[Plan B] Waiting for processing...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                processedFile = await fileManager.getFile(file.name);
            }

            if (processedFile.state === FileState.FAILED) {
                throw new Error("Gemini File API processing failed.");
            }

            // 5. Generate Content
            console.log('[Plan B] Generating transcription...');
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const prompt = `Tu es un secrétaire de séance expert. Transcris cet enregistrement DE MANIÈRE EXHAUSTIVE ET COMPLÈTE.
        
RÈGLES CRITIQUES :
1. NE JAMAIS RÉSUMER. Je veux chaque phrase, chaque mot.
2. Si l'enregistrement est long, CONTINUE jusqu'au bout. Ne t'arrête pas.
3. Structure par sujets.
4. Identifie les intervenants **en gras** (ex: **M. Tremblay :**).
5. Utilise ce format Markdown :

## [Sujet / Point de l'ordre du jour]
**Intervenant 1 :** Propos exacts...
`;

            const result = await model.generateContent({
                contents: [{
                    role: "user",
                    parts: [
                        { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
                        { text: prompt }
                    ]
                }],
                generationConfig: {
                    maxOutputTokens: 100000, // Max possible
                    temperature: 0.2
                }
            });

            const transcription = result.response.text();

            console.log(`[Plan B] Generation complete. Length: ${transcription.length} chars.`);

            // 6. Cleanup (Delete from Gemini + Local)
            try {
                await fileManager.deleteFile(file.name);
                fs.unlinkSync(tempFilePath);
                console.log('[Plan B] Cleanup done.');
            } catch (cleanupErr) {
                console.warn('Cleanup warning:', cleanupErr);
            }

            // 7. Save
            await admin.firestore().doc(`meetings/${meetingId}`).update({
                'audioRecording.transcription': transcription,
                'audioRecording.transcriptionStatus': 'completed',
                'audioRecording.transcribedAt': new Date().toISOString(),
                dateUpdated: new Date().toISOString()
            });

            return { success: true, transcription };

        } catch (error) {
            console.error('[Plan B CRASH]', error);

            // Error logging
            if (data?.meetingId) {
                await admin.firestore().doc(`meetings/${data.meetingId}`).update({
                    'audioRecording.transcriptionStatus': 'error',
                    'audioRecording.transcriptionError': error instanceof Error ? error.message : String(error)
                }).catch(console.error);
            }

            throw new functions.https.HttpsError("internal", error instanceof Error ? error.message : "Internal Error");
        }
    });
