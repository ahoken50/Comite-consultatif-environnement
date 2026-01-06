"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeAudioV2 = void 0;
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const os = require("os");
const generative_ai_1 = require("@google/generative-ai");
const server_1 = require("@google/generative-ai/server");
try {
    admin.initializeApp();
}
catch (e) {
    console.warn('Firebase Admin already initialized:', e);
}
// Detect and clean repetition loops
function cleanRepetitions(text) {
    // Pattern: same word repeated 5+ times
    let cleaned = text.replace(/(\b\w+\b)(\s+\1){4,}/gi, '$1 [...]');
    // Pattern: same phrase repeated
    cleaned = cleaned.replace(/(.{10,50})\1{2,}/gi, '$1 [...]');
    return cleaned;
}
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
const params_1 = require("firebase-functions/params");
const googleApiKey = (0, params_1.defineSecret)("GEMINI_BRIEFING_KEY");
// Global options for Gen 2
(0, v2_1.setGlobalOptions)({ maxInstances: 10 });
exports.transcribeAudioV2 = (0, https_1.onCall)({
    timeoutSeconds: 3600,
    memory: "4GiB",
    secrets: [googleApiKey], // Make secret available
}, async (request) => {
    var _a, _b;
    const data = request.data;
    console.log('[V5-V2] Start:', JSON.stringify(data));
    try {
        if (!request.auth)
            throw new https_1.HttpsError("unauthenticated", "Auth required.");
        // Access secret directly
        const GEMINI_API_KEY = googleApiKey.value();
        if (!GEMINI_API_KEY)
            throw new https_1.HttpsError("failed-precondition", "API Key missing.");
        const { meetingId, storagePath, mimeType } = data;
        if (!meetingId || !storagePath || !mimeType)
            throw new https_1.HttpsError("invalid-argument", "Missing params.");
        // 1. Get meeting context
        const meetingDoc = await admin.firestore().doc(`meetings/${meetingId}`).get();
        const meetingData = meetingDoc.data();
        const agendaItems = ((_a = meetingData === null || meetingData === void 0 ? void 0 : meetingData.agendaItems) === null || _a === void 0 ? void 0 : _a.map((item, i) => `${i + 1}. ${item.title}`).join('\n')) || '';
        const attendeeNames = ((_b = meetingData === null || meetingData === void 0 ? void 0 : meetingData.attendees) === null || _b === void 0 ? void 0 : _b.map((a) => a.name).join(', ')) || '';
        // 2. Download & Upload
        const bucket = admin.storage().bucket();
        const tempFilePath = path.join(os.tmpdir(), `audio-${meetingId}${path.extname(storagePath)}`);
        await bucket.file(storagePath).download({ destination: tempFilePath });
        const fileManager = new server_1.GoogleAIFileManager(GEMINI_API_KEY);
        const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: `Meeting ${meetingId}`
        });
        const file = uploadResult.file;
        let processedFile = await fileManager.getFile(file.name);
        while (processedFile.state === server_1.FileState.PROCESSING) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            processedFile = await fileManager.getFile(file.name);
        }
        if (processedFile.state === server_1.FileState.FAILED)
            throw new Error("File processing failed.");
        // 3. Setup model
        const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        // 4. PHASE 1: Raw transcription in chunks
        console.log('[V6] Phase 1: Raw transcription with timestamps...');
        let rawTranscription = "";
        let lastTimestamp = "0:00";
        let previousTimestamp = "";
        let stuckCount = 0;
        const maxPasses = 12; // Increased to cover ~3 hours (12 * 15m = 180m)
        for (let pass = 0; pass < maxPasses; pass++) {
            console.log(`[V6] Pass ${pass + 1}/${maxPasses}, last timestamp: ${lastTimestamp}`);
            // Detect if we're stuck at the same timestamp
            if (lastTimestamp === previousTimestamp && pass > 0) {
                stuckCount++;
                if (stuckCount >= 2) {
                    console.log('[V6] Stuck at same timestamp, ending transcription');
                    break;
                }
            }
            else {
                stuckCount = 0;
            }
            previousTimestamp = lastTimestamp;
            const continuePrompt = pass === 0
                ? `Transcris cet enregistrement audio de réunion. Transcris VERBATIM (mot à mot) tout ce qui est dit.
                
RÈGLES IMPORTANTES:
1. Commence au début (0:00) et transcris environ 15 minutes de contenu
2. HORODATAGE OBLIGATOIRE: Indique le temps [MM:SS] au début de chaque intervention
   Exemple: "[0:00] **Président:** Bonjour à tous..."
            "[1:30] **Membre:** Je voudrais ajouter..."
3. À la fin, écris EXACTEMENT: [CONTINUER À: MM:SS] ou [FIN DE L'ENREGISTREMENT]
4. N'invente rien, transcris uniquement ce que tu entends
5. Change de paragraphe quand l'intervenant change`
                : `Continue la transcription de cet enregistrement à partir de [${lastTimestamp}].

RAPPEL: Tu as déjà transcrit de 0:00 à ${lastTimestamp}. Continue à partir de là.
RÈGLES:
1. Transcris les 15 prochaines minutes environ
2. HORODATAGE OBLIGATOIRE sur chaque intervention: [MM:SS] **Nom:**
3. Termine par [CONTINUER À: MM:SS] ou [FIN DE L'ENREGISTREMENT]
4. Ne répète pas ce qui a déjà été transcrit`;
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
            console.log(`[V6] Received ${chunk.length} chars`);
            chunk = cleanRepetitions(chunk);
            // Extract timestamp - try multiple methods
            // Method 1: Look for explicit continue marker
            const continueMatch = chunk.match(/\[CONTINUER\s*[ÀA]?\s*:?\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/i);
            // Method 2: Find the LAST timestamp in the chunk content [MM:SS] or [H:MM:SS]
            const allTimestamps = chunk.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g);
            const lastContentTimestamp = allTimestamps && allTimestamps.length > 0
                ? allTimestamps[allTimestamps.length - 1].replace(/[\[\]]/g, '')
                : null;
            // Use continue marker if found, otherwise use last content timestamp
            if (continueMatch) {
                lastTimestamp = continueMatch[1];
                console.log(`[V6] Found continue marker: ${lastTimestamp}`);
            }
            else if (lastContentTimestamp) {
                lastTimestamp = lastContentTimestamp;
                console.log(`[V6] Extracted last timestamp from content: ${lastTimestamp}`);
            }
            else {
                // If no timestamp found at all, estimate based on pass number (15 min per pass)
                const estimatedMinutes = (pass + 1) * 15;
                lastTimestamp = `${estimatedMinutes}:00`;
                console.log(`[V6] No timestamp found, estimating: ${lastTimestamp}`);
            }
            rawTranscription += (pass > 0 ? "\n\n---\n\n" : "") + chunk;
            // Parse current timestamp to minutes for validation
            const parseTimestamp = (ts) => {
                const parts = ts.split(':').map(Number);
                if (parts.length === 2)
                    return parts[0] + parts[1] / 60; // MM:SS
                if (parts.length === 3)
                    return parts[0] * 60 + parts[1] + parts[2] / 60; // HH:MM:SS
                return 0;
            };
            const currentMinutes = parseTimestamp(lastTimestamp);
            console.log(`[V6] Progress: ${currentMinutes.toFixed(1)} minutes transcribed`);
            // Check for EXPLICIT end marker - must be EXACT format
            const hasExplicitEnd = chunk.includes('[FIN DE L\'ENREGISTREMENT]');
            if (hasExplicitEnd) {
                // Only trust "end" marker if we've transcribed at least 45 minutes
                // OR if there's no continue marker
                if (currentMinutes >= 45 || !continueMatch) {
                    console.log(`[V6] Reached end of recording at ${lastTimestamp} (${currentMinutes.toFixed(1)} min)`);
                    break;
                }
                else {
                    console.log(`[V6] Ignoring premature end marker at ${lastTimestamp} - only ${currentMinutes.toFixed(1)} min transcribed`);
                }
            }
            // Adjusted threshold: only stop if very short AND no new content AND we've done significant work
            if (chunk.length < 200 && pass > 2 && currentMinutes >= 30) {
                console.log(`[V6] Very short chunk at ${currentMinutes.toFixed(1)} min, likely end`);
                break;
            }
        }
        console.log(`[V6] Phase 1 complete: ${rawTranscription.length} chars, final timestamp: ${lastTimestamp}`);
        // 5. PHASE 2: Organization with PRESERVED timestamps
        console.log('[V6] Phase 2: Organization with timestamps...');
        const organizePrompt = `Tu es un assistant qui organise des transcriptions de réunions.

TRANSCRIPTION BRUTE:
${rawTranscription}

${agendaItems ? `ORDRE DU JOUR DE LA RÉUNION:\n${agendaItems}\n` : ''}
${attendeeNames ? `PARTICIPANTS CONNUS: ${attendeeNames}\n` : ''}

MISSION:
1. ORGANISE par SUJETS/THÈMES discutés avec titres ##
2. ⚠️ PRÉSERVE TOUS LES HORODATAGES [MM:SS] - C'est CRITIQUE
3. IDENTIFIE les intervenants:
   - Si tu reconnais des noms, utilise-les: **[MM:SS] M. Tremblay:**
   - Sinon: **[MM:SS] Intervenant A:**
4. CONSERVE tout le contenu, ne résume pas
5. Supprime uniquement les répétitions type "c'est c'est c'est..."
6. Termine par [TRANSCRIPTION ORGANISÉE COMPLÈTE]

FORMAT EXACT:
## [MM:SS] Titre du sujet

**[MM:SS] Nom/Intervenant:** Ce qui est dit...

**[MM:SS] Autre intervenant:** Sa réponse...

---`;
        const organizeResult = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: organizePrompt }] }],
            generationConfig: {
                maxOutputTokens: 32768,
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
    }
    catch (error) {
        console.error('[V5-V2 ERROR]', error);
        if (data === null || data === void 0 ? void 0 : data.meetingId) {
            await admin.firestore().doc(`meetings/${data.meetingId}`).update({
                'audioRecording.transcriptionStatus': 'error',
                'audioRecording.transcriptionError': error instanceof Error ? error.message : String(error)
            }).catch(() => { });
        }
        // HttpsError from Gen 2
        throw new https_1.HttpsError("internal", error instanceof Error ? error.message : "Error");
    }
});
//# sourceMappingURL=index.js.map