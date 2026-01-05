import * as admin from "firebase-admin";

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

try {
    admin.initializeApp();
} catch (e) {
    console.warn('Firebase Admin already initialized:', e);
}

interface TranscriptionRequest {
    meetingId: string;
    storagePath: string;
    mimeType: string;
}

// Detect and clean repetition loops
function cleanRepetitions(text: string): string {
    // Pattern: same word repeated 5+ times
    let cleaned = text.replace(/(\b\w+\b)(\s+\1){4,}/gi, '$1 [...]');
    // Pattern: same phrase repeated
    cleaned = cleaned.replace(/(.{10,50})\1{2,}/gi, '$1 [...]');
    return cleaned;
}

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";

const googleApiKey = defineSecret("GOOGLE_API_KEY");

// Global options for Gen 2
setGlobalOptions({ maxInstances: 10 });

export const transcribeAudioV2 = onCall({
    timeoutSeconds: 3600, // 1 hour timeout (Gen 2 supports up to 60m)
    memory: "4GiB",       // Increases memory to 4GB
    secrets: [googleApiKey], // Make secret available
}, async (request: CallableRequest<TranscriptionRequest>) => {
    const data = request.data as TranscriptionRequest;
    console.log('[V5-V2] Start:', JSON.stringify(data));

    try {
        if (!request.auth) throw new HttpsError("unauthenticated", "Auth required.");

        // Access secret directly
        const GEMINI_API_KEY = googleApiKey.value();
        if (!GEMINI_API_KEY) throw new HttpsError("failed-precondition", "API Key missing.");

        const { meetingId, storagePath, mimeType } = data;
        if (!meetingId || !storagePath || !mimeType) throw new HttpsError("invalid-argument", "Missing params.");

        // 1. Get meeting context
        const meetingDoc = await admin.firestore().doc(`meetings/${meetingId}`).get();
        const meetingData = meetingDoc.data();

        const agendaItems = meetingData?.agendaItems?.map((item: { title: string }, i: number) =>
            `${i + 1}. ${item.title}`
        ).join('\n') || '';

        const attendeeNames = meetingData?.attendees?.map((a: { name: string }) => a.name).join(', ') || '';

        // 2. Download & Upload
        const bucket = admin.storage().bucket();
        const tempFilePath = path.join(os.tmpdir(), `audio-${meetingId}${path.extname(storagePath)}`);
        await bucket.file(storagePath).download({ destination: tempFilePath });

        const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
        const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: `Meeting ${meetingId}`
        });
        const file = uploadResult.file;

        let processedFile = await fileManager.getFile(file.name);
        while (processedFile.state === FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            processedFile = await fileManager.getFile(file.name);
        }
        if (processedFile.state === FileState.FAILED) throw new Error("File processing failed.");

        // 3. Setup model
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // 4. PHASE 1: Raw transcription in chunks
        console.log('[V5-V2] Phase 1: Raw transcription...');

        let rawTranscription = "";
        let lastTimestamp = "0:00";
        const maxPasses = 8; // Increased from 5 to 8 to cover 2 hours (8 * 15m = 120m)

        for (let pass = 0; pass < maxPasses; pass++) {
            console.log(`[V5-V2] Pass ${pass + 1}/${maxPasses}, last timestamp: ${lastTimestamp}`);

            const continuePrompt = pass === 0
                ? `Transcris cet enregistrement audio de réunion. Transcris VERBATIM (mot à mot) tout ce qui est dit.
                
IMPORTANT:
- Commence au début et transcris jusqu'à la fin OU jusqu'à ce que tu aies transcrit environ 15 minutes de contenu
- Indique le temps approximatif entre crochets: [MM:SS]
- À la fin de ta transcription, écris: [CONTINUER À: MM:SS] ou [FIN DE L'ENREGISTREMENT]
- N'invente rien, transcris uniquement ce que tu entends`
                : `Continue la transcription de cet enregistrement à partir de ${lastTimestamp}.

RAPPEL: Tu as déjà transcrit le début. Continue là où tu t'es arrêté.
- Transcris les 15 prochaines minutes environ
- Termine par [CONTINUER À: MM:SS] ou [FIN DE L'ENREGISTREMENT]`;

            const result = await model.generateContent({
                contents: [{
                    role: "user",
                    parts: [
                        { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
                        { text: continuePrompt }
                    ]
                }],
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.1,
                    topP: 0.8,
                    topK: 40
                }
            });

            let chunk = result.response.text();
            console.log(`[V5-V2] Received ${chunk.length} chars`);

            chunk = cleanRepetitions(chunk);

            const continueMatch = chunk.match(/\[CONTINUER À:\s*(\d+:\d+)\]/i);
            if (continueMatch) {
                lastTimestamp = continueMatch[1];
            }

            rawTranscription += (pass > 0 ? "\n\n---\n\n" : "") + chunk;

            if (chunk.includes('[FIN DE L\'ENREGISTREMENT]') ||
                chunk.toLowerCase().includes('fin de l\'enregistrement')) {
                console.log('[V5-V2] Reached end of recording');
                break;
            }

            if (chunk.length < 500 && pass > 0) {
                console.log('[V5-V2] Short chunk, stopping');
                break;
            }
        }

        console.log(`[V5-V2] Phase 1 complete: ${rawTranscription.length} chars`);

        // 5. PHASE 2: Organization
        console.log('[V5-V2] Phase 2: Organization...');

        const organizePrompt = `Tu es un assistant qui organise des transcriptions.

TRANSCRIPTION BRUTE:
${rawTranscription}

${agendaItems ? `ORDRE DU JOUR DE LA RÉUNION:\n${agendaItems}\n` : ''}
${attendeeNames ? `PARTICIPANTS CONNUS: ${attendeeNames}\n` : ''}

MISSION:
1. ORGANISE cette transcription par SUJETS/THÈMES discutés
2. Pour chaque sujet, crée une section avec un titre ## 
3. IDENTIFIE les intervenants:
   - Si tu reconnais des noms mentionnés, utilise-les (ex: **M. Tremblay :**)
   - Sinon utilise **Intervenant A :**, **Intervenant B :**, etc. (différencie les voix)
4. CONSERVE tout le contenu, ne résume pas
5. Supprime les répétitions inutiles comme "c'est c'est c'est..."
6. Termine par [TRANSCRIPTION ORGANISÉE COMPLÈTE]

FORMAT:
## [Titre du sujet]

**Nom/Intervenant :** Ce qui est dit...
---`;

        const organizeResult = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: organizePrompt }] }],
            generationConfig: {
                maxOutputTokens: 32768, // Requires high output limit
                temperature: 0.1
            }
        });

        let finalTranscription = organizeResult.response.text();
        finalTranscription = cleanRepetitions(finalTranscription);

        const isOrganized = finalTranscription.includes('##');
        const isComplete = finalTranscription.includes('[TRANSCRIPTION ORGANISÉE COMPLÈTE]') ||
            finalTranscription.includes('[FIN');

        console.log(`[V5-V2] Organized: ${isOrganized}, Complete: ${isComplete}`);

        await fileManager.deleteFile(file.name).catch(() => { });
        fs.unlinkSync(tempFilePath);

        if (!isComplete) {
            finalTranscription += '\n\n⚠️ **Note:** La transcription peut être incomplète. Veuillez vérifier.';
        }

        await admin.firestore().doc(`meetings/${meetingId}`).update({
            'audioRecording.transcription': finalTranscription,
            'audioRecording.rawTranscription': rawTranscription,
            'audioRecording.transcriptionStatus': isComplete ? 'completed' : 'partial',
            'audioRecording.transcribedAt': new Date().toISOString(),
            'audioRecording.isOrganized': isOrganized,
            dateUpdated: new Date().toISOString()
        });

        return {
            success: true,
            transcription: finalTranscription,
            isComplete,
            isOrganized
        };

    } catch (error) {
        console.error('[V5-V2 ERROR]', error);

        if (data?.meetingId) {
            await admin.firestore().doc(`meetings/${data.meetingId}`).update({
                'audioRecording.transcriptionStatus': 'error',
                'audioRecording.transcriptionError': error instanceof Error ? error.message : String(error)
            }).catch(() => { });
        }

        // HttpsError from Gen 2
        throw new HttpsError("internal", error instanceof Error ? error.message : "Error");
    }
});
