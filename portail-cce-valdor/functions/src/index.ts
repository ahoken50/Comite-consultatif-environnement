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

            const chunkDurationMins = 20;
            const totalChunks = 9;
            const chunks = [];

            for (let i = 0; i < totalChunks; i++) {
                // Overlap Strategy: 
                // Start 1 min earlier (unless first chunk)
                // End 1 min later
                const startStr = Math.max(0, i * chunkDurationMins - 1);
                const endStr = (i + 1) * chunkDurationMins + 1;

                chunks.push({
                    index: i,
                    start: startStr,
                    end: endStr
                });
            }

            console.log(`[Chunking] Starting ${chunks.length} parallel requests (with overlap) using Gemini 2.5 Flash...`);
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            // Gemini 2.5 Flash: Latest model with 1M context window and native audio support
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            // 4. Parallel Execution
            const promises = chunks.map(async (chunk) => {
                const prompt = `Tu es un secrétaire de séance expert. Transcris INTÉGRALEMENT la partie de l'audio comprise entre la minute ${chunk.start} et la minute ${chunk.end}.

RÈGLES STRICTES :
1. VERBATIM : Transcris CHAQUE mot prononcé, sans résumer ni omettre.
2. INTERVENANTS : Identifie chaque personne qui parle avec le format **Intervenant X :** en gras.
3. CONTINUITÉ : Si une phrase commence avant ${chunk.start}m, commence par "..." et si elle continue après ${chunk.end}m, termine par "..."
4. Ne fais AUCUN résumé.
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
                        generationConfig: { maxOutputTokens: 16384, temperature: 0.1 } // 16k per chunk for 20m of speech
                    });
                    const text = result.response.text();
                    // Label chunk for debug but keep clean for fusion
                    return { index: chunk.index, text: text };
                } catch (err) {
                    console.error(`[Chunk ${chunk.index}] Failed`, err);
                    return { index: chunk.index, text: "" };
                }
            });

            const results = await Promise.all(promises);

            // 5. Sort and Raw Join
            const rawTranscription = results
                .sort((a, b) => a.index - b.index)
                .map(r => r.text)
                .join("\n\n");

            console.log(`[Chunking] Raw joined length: ${rawTranscription.length}. Starting AI Fusion...`);

            // 6. AI Fusion / Cleanup
            const fusionPrompt = `Voici une transcription brute divisée en segments qui se chevauchent.
Objectif : FUSIONNER et NETTOYER sans perdre d'information.

RÈGLES ABSOLUES :
1. **INTERVENANTS** : Tu DOIS conserver le format gras : **Intervenant X :**. C'est crucial pour le logiciel.
2. **INTÉGRALITÉ** : Ne fais AUCUN résumé. Garde chaque phrase.
3. **FUSION** : Supprime les redondances aux jonctions des segments.

TEXTE A TRAITER :
${rawTranscription}
`;

            let finalTranscription = rawTranscription; // Default to raw if fusion fails

            try {
                // Use a larger context model for fusion if possible, or same 1.5 Pro
                const finalResult = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: fusionPrompt }] }],
                    generationConfig: { maxOutputTokens: 32768, temperature: 0.1 } // Large output for complete fusion
                });

                const fusedText = finalResult.response.text();

                // Safety Check: If fusion lost more than 20% of content, suspect truncation/summarization -> Revert to RAW
                if (fusedText.length < rawTranscription.length * 0.8) {
                    console.warn(`[Fusion Warning] Fused text significantly shorter (${fusedText.length} vs ${rawTranscription.length}). Returning RAW transcription to ensure completeness.`);
                    finalTranscription = rawTranscription;
                } else {
                    console.log(`[Fusion Success] Length: ${fusedText.length}`);
                    finalTranscription = fusedText;
                }

            } catch (fusionErr) {
                console.error('[Fusion Failed]', fusionErr);
                console.log('Returning raw concatenated transcription.');
                // finalTranscription is already rawTranscription
            }

            // 7. Cleanup
            await fileManager.deleteFile(file.name).catch(e => console.warn('Cleanup error', e));
            fs.unlinkSync(tempFilePath);

            // 8. Save
            await admin.firestore().doc(`meetings/${meetingId}`).update({
                'audioRecording.transcription': finalTranscription,
                'audioRecording.transcriptionStatus': 'completed',
                'audioRecording.transcribedAt': new Date().toISOString(),
                dateUpdated: new Date().toISOString()
            });

            return { success: true, transcription: finalTranscription };

        } catch (error) {
            console.error('[Plan B CRASH]', error);
            throw new functions.https.HttpsError("internal", error instanceof Error ? error.message : "Internal Error");
        }
    });
