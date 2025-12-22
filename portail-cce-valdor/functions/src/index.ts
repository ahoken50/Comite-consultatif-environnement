import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallableContext } from "firebase-functions/v1/https";
import axios from "axios";

// Standard initialization
try {
    admin.initializeApp();
} catch (e) {
    console.warn('Firebase Admin already initialized or failed init:', e);
}

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

interface TranscriptionRequest {
    meetingId: string;
    storagePath: string;
    mimeType: string;
}

export const transcribeAudio = functions
    .runWith({
        timeoutSeconds: 300,
        memory: "2GB"
    })
    .https.onCall(async (data: TranscriptionRequest, context: CallableContext) => {
        console.log('[Transcription] Function Start. Data:', JSON.stringify(data));

        try {
            // 1. Auth Check - STRICT
            if (!context.auth) {
                console.warn('[Transcription] Unauthenticated call');
                throw new functions.https.HttpsError(
                    "unauthenticated",
                    "Authentication required."
                );
            }

            // 2. Config Check - ROBUST
            const config = functions.config();
            // Try multiple sources for the key
            const GEMINI_API_KEY = config.google?.api_key || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_AI_API;

            if (!GEMINI_API_KEY) {
                console.error('[Transcription] FATAL: No API Key found in env options.');
                throw new functions.https.HttpsError(
                    "failed-precondition",
                    "Server misconfiguration: API Key missing."
                );
            }

            const { meetingId, storagePath, mimeType } = data;

            if (!meetingId || !storagePath || !mimeType) {
                throw new functions.https.HttpsError("invalid-argument", "Missing parameters (meetingId, storagePath, mimeType)");
            }

            // 3. Storage Access
            console.log(`[Transcription] Accessing storage path: ${storagePath}`);
            const bucket = admin.storage().bucket();
            const file = bucket.file(storagePath);

            const [exists] = await file.exists();
            if (!exists) {
                console.error(`[Transcription] File not found: ${storagePath}`);
                throw new functions.https.HttpsError("not-found", "Audio file not found in storage");
            }

            // 4. Download
            const [fileBuffer] = await file.download();
            const base64Audio = fileBuffer.toString('base64');
            console.log(`[Transcription] Downloaded ${fileBuffer.length} bytes`);

            // 5. Build Prompt (Improved)
            const prompt = `Tu es un secrétaire de séance expert. Ta tâche est de transcrire cet enregistrement de réunion de manière détaillée et structurée.

RÈGLES DE TRANSCRIPTION :
1. DÉTAILS : Ne fais PAS de résumé. Transcris les discussions le plus fidèlement possible.
2. STRUCTURE : Organise la transcription par SUJETS ou POINTS D'ORDRE DU JOUR clairement identifiés.
3. INTERVENANTS : Identifie qui parle (Intervenant 1, Intervenant 2, etc.).
4. FORMAT : Utilise du texte suivi et détaillé pour faciliter la rédaction du procès-verbal.

Exemple :
## [Sujet]
**Intervenant 1 :** [Propos...]
`;

            // 6. Gemini Call
            console.log('[Transcription] Sending to Gemini...');
            const geminiRequest = {
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: base64Audio
                            }
                        }
                    ]
                }]
            };

            const response = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, geminiRequest, {
                headers: { 'Content-Type': 'application/json' },
                validateStatus: () => true // Allow handling non-200 responses
            });

            if (response.status !== 200) {
                console.error('[Gemini Error]', response.data);
                throw new functions.https.HttpsError("internal", `Gemini API Error: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            const transcription = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!transcription) {
                console.error('[Gemini] Empty transcription', response.data);
                throw new functions.https.HttpsError("internal", "Empty transcription received from AI");
            }

            // 7. Save Result
            console.log('[Transcription] Success! Saving to Firestore...');
            await admin.firestore().doc(`meetings/${meetingId}`).update({
                'audioRecording.transcription': transcription,
                'audioRecording.transcriptionStatus': 'completed',
                'audioRecording.transcribedAt': new Date().toISOString(),
                dateUpdated: new Date().toISOString()
            });

            return { success: true, transcription };

        } catch (error) {
            console.error('[Transcription CRASH HANDLED]', error);

            // Attempt to log error to Firestore so user sees it in UI
            if (data && data.meetingId) {
                try {
                    await admin.firestore().doc(`meetings/${data.meetingId}`).update({
                        'audioRecording.transcriptionStatus': 'error',
                        'audioRecording.transcriptionError': error instanceof Error ? error.message : String(error)
                    });
                } catch (writeErr) {
                    console.error('Failed to write error status to Firestore', writeErr); // Best effort
                }
            }

            if (error instanceof functions.https.HttpsError) throw error;
            throw new functions.https.HttpsError("internal", error instanceof Error ? error.message : "Unknown server error");
        }
    });
