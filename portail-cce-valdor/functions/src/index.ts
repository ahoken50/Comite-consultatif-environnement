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
        console.log('[Transcription V4] Function Start. Data:', JSON.stringify(data));

        try {
            if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required.");

            const config = functions.config();
            const GEMINI_API_KEY = config.google?.api_key || process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_AI_API;

            if (!GEMINI_API_KEY) throw new functions.https.HttpsError("failed-precondition", "API Key missing.");

            const { meetingId, storagePath, mimeType } = data;
            if (!meetingId || !storagePath || !mimeType) throw new functions.https.HttpsError("invalid-argument", "Missing params.");

            // 1. Fetch meeting data (for agenda items)
            const meetingDoc = await admin.firestore().doc(`meetings/${meetingId}`).get();
            const meetingData = meetingDoc.data();

            const agendaItems = meetingData?.agendaItems?.map((item: { title: string }, i: number) =>
                `${i + 1}. ${item.title}`
            ).join('\n') || 'Aucun ordre du jour défini';

            const attendees = meetingData?.attendees?.map((a: { name: string, role?: string }) =>
                `- ${a.name}${a.role ? ` (${a.role})` : ''}`
            ).join('\n') || 'Participants non spécifiés';

            console.log(`[V4] Agenda items:\n${agendaItems}`);

            // 2. Download audio
            const bucket = admin.storage().bucket();
            const tempFilePath = path.join(os.tmpdir(), `audio-${meetingId}${path.extname(storagePath)}`);
            console.log(`[V4] Downloading ${storagePath}...`);
            await bucket.file(storagePath).download({ destination: tempFilePath });

            // 3. Upload to File API
            const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: mimeType,
                displayName: `Meeting ${meetingId}`
            });
            const file = uploadResult.file;
            console.log(`[V4] File uploaded: ${file.uri}`);

            // Wait for processing
            let processedFile = await fileManager.getFile(file.name);
            while (processedFile.state === FileState.PROCESSING) {
                console.log('[V4] Waiting for processing...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                processedFile = await fileManager.getFile(file.name);
            }
            if (processedFile.state === FileState.FAILED) throw new Error("File processing failed.");

            // 4. Transcription with verification loop
            console.log(`[V4] Starting transcription with Gemini 2.0 Flash...`);
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const basePrompt = `Tu es un secrétaire de séance expert pour le Comité Consultatif en Environnement (CCE).

## CONTEXTE DE LA RÉUNION
**Participants présents :**
${attendees}

**Ordre du jour :**
${agendaItems}

## TA MISSION
Transcris cet enregistrement audio de réunion de manière COMPLÈTE et STRUCTURÉE.

## RÈGLES DE TRANSCRIPTION STRICTES

### 1. STRUCTURE PAR SUJETS
- Organise la transcription selon les points de l'ordre du jour
- Utilise le format : ## [Numéro] [Titre du point]

### 2. IDENTIFICATION DES INTERVENANTS
- Utilise les noms des participants quand possible (ex: **M. Tremblay :**)
- Met TOUJOURS le nom en gras avec ** **

### 3. VERBATIM COMPLET
- Transcris CHAQUE mot prononcé
- N'omets RIEN, ne résume JAMAIS

### 4. MARQUEUR DE FIN OBLIGATOIRE
- Quand tu as transcrit TOUT l'audio jusqu'à la fin, termine par :
[FIN DE L'ENREGISTREMENT - TRANSCRIPTION COMPLÈTE]

- Si tu n'as pas pu tout transcrire, termine par :
[TRANSCRIPTION PARTIELLE - DERNIÈRE MINUTE TRANSCRITE : XX:XX]

COMMENCE LA TRANSCRIPTION MAINTENANT.`;

            let fullTranscription = "";
            let isComplete = false;
            let attempts = 0;
            const maxAttempts = 3;

            while (!isComplete && attempts < maxAttempts) {
                attempts++;
                console.log(`[V4] Transcription attempt ${attempts}/${maxAttempts}...`);

                let currentPrompt = basePrompt;

                // If we have partial transcription, ask to continue
                if (fullTranscription.length > 0) {
                    const lastLines = fullTranscription.slice(-500);
                    currentPrompt = `Tu as commencé une transcription mais tu t'es arrêté. Voici les dernières lignes :

---
${lastLines}
---

CONTINUE la transcription à partir de là. Reprends exactement où tu t'es arrêté et va jusqu'à la fin de l'enregistrement.

Quand tu atteins la fin, écris : [FIN DE L'ENREGISTREMENT - TRANSCRIPTION COMPLÈTE]`;
                }

                const result = await model.generateContent({
                    contents: [{
                        role: "user",
                        parts: [
                            { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
                            { text: currentPrompt }
                        ]
                    }],
                    generationConfig: {
                        maxOutputTokens: 65536,
                        temperature: 0.1
                    }
                });

                const newText = result.response.text();
                console.log(`[V4] Received ${newText.length} chars`);

                // Check finish reason
                const finishReason = result.response.candidates?.[0]?.finishReason;
                console.log(`[V4] Finish reason: ${finishReason}`);

                // Append to full transcription
                if (fullTranscription.length === 0) {
                    fullTranscription = newText;
                } else {
                    // Avoid duplicating content
                    fullTranscription += "\n\n" + newText;
                }

                // Check if complete
                if (fullTranscription.includes('[FIN DE L\'ENREGISTREMENT')) {
                    isComplete = true;
                    console.log('[V4] ✅ Transcription marked as COMPLETE by AI');
                } else if (finishReason === 'STOP') {
                    // Natural stop - might be complete
                    console.log('[V4] Natural stop, verifying...');

                    // Ask AI to verify
                    const verifyResult = await model.generateContent({
                        contents: [{
                            role: "user",
                            parts: [
                                { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
                                {
                                    text: `Voici une transcription de cet audio. Est-elle complète jusqu'à la fin de l'enregistrement ? Réponds UNIQUEMENT par "COMPLET" ou "INCOMPLET".

Transcription :
${fullTranscription.slice(-2000)}`
                                }
                            ]
                        }],
                        generationConfig: { maxOutputTokens: 10, temperature: 0 }
                    });

                    const verifyAnswer = verifyResult.response.text().toUpperCase();
                    if (verifyAnswer.includes('COMPLET') && !verifyAnswer.includes('INCOMPLET')) {
                        isComplete = true;
                        fullTranscription += '\n\n[FIN DE L\'ENREGISTREMENT - TRANSCRIPTION VÉRIFIÉE COMPLÈTE]';
                        console.log('[V4] ✅ Verification confirmed COMPLETE');
                    } else {
                        console.log('[V4] ⚠️ Verification says INCOMPLETE, continuing...');
                    }
                } else if (finishReason === 'MAX_TOKENS') {
                    console.log('[V4] ⚠️ Hit token limit, will continue...');
                }
            }

            // 5. Clean up repetition loops
            const repetitionPattern = /(\b\w+\b)(\s+\1){10,}/g;
            if (repetitionPattern.test(fullTranscription)) {
                console.warn('[V4] Cleaning repetition loops...');
                fullTranscription = fullTranscription.replace(repetitionPattern, '$1 [...]');
            }

            // 6. Final status
            if (!isComplete) {
                console.warn('[V4] ⚠️ Could not verify completeness after max attempts');
                fullTranscription += '\n\n[⚠️ AVERTISSEMENT : La transcription peut être incomplète. Veuillez vérifier manuellement.]';
            }

            console.log(`[V4] Final transcription length: ${fullTranscription.length} chars`);

            // 7. Cleanup
            await fileManager.deleteFile(file.name).catch((e: Error) => console.warn('Cleanup error', e));
            fs.unlinkSync(tempFilePath);

            // 8. Save
            await admin.firestore().doc(`meetings/${meetingId}`).update({
                'audioRecording.transcription': fullTranscription,
                'audioRecording.transcriptionStatus': isComplete ? 'completed' : 'partial',
                'audioRecording.transcribedAt': new Date().toISOString(),
                'audioRecording.verificationStatus': isComplete ? 'verified_complete' : 'unverified',
                dateUpdated: new Date().toISOString()
            });

            return {
                success: true,
                transcription: fullTranscription,
                isComplete: isComplete,
                attempts: attempts
            };

        } catch (error) {
            console.error('[V4 CRASH]', error);

            if (data?.meetingId) {
                await admin.firestore().doc(`meetings/${data.meetingId}`).update({
                    'audioRecording.transcriptionStatus': 'error',
                    'audioRecording.transcriptionError': error instanceof Error ? error.message : String(error)
                }).catch(console.error);
            }

            throw new functions.https.HttpsError("internal", error instanceof Error ? error.message : "Internal Error");
        }
    });
