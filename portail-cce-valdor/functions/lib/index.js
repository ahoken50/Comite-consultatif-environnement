"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRegulationToSupabase = exports.syncProjectToSupabase = exports.syncMeetingToSupabase = exports.transcribeAudioV2 = void 0;
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
    secrets: [googleApiKey],
}, async (request) => {
    var _a, _b, _c, _d;
    const data = request.data;
    console.log('[V5-V2] Start:', JSON.stringify(data));
    try {
        if (!request.auth)
            throw new https_1.HttpsError("unauthenticated", "Auth required.");
        // Access secret directly
        const GEMINI_API_KEY = googleApiKey.value();
        if (!GEMINI_API_KEY)
            throw new https_1.HttpsError("failed-precondition", "API Key missing.");
        const { meetingId, storagePath, mimeType, expectedDurationMinutes } = data;
        if (!meetingId || !storagePath || !mimeType)
            throw new https_1.HttpsError("invalid-argument", "Missing params.");
        // 1. Get meeting context
        const meetingDoc = await admin.firestore().doc(`meetings/${meetingId}`).get();
        const meetingData = meetingDoc.data();
        // Get actual audio duration from meeting data (in seconds -> convert to minutes)
        const audioDurationSeconds = (_a = meetingData === null || meetingData === void 0 ? void 0 : meetingData.audioRecording) === null || _a === void 0 ? void 0 : _a.duration;
        const audioDurationMinutes = audioDurationSeconds ? Math.ceil(audioDurationSeconds / 60) : null;
        // Set max duration: use actual audio duration if available, else param, else 180 min default
        const maxDurationMinutes = audioDurationMinutes
            ? audioDurationMinutes + 5 // Add 5 min margin to actual duration
            : (expectedDurationMinutes
                ? expectedDurationMinutes + 10
                : 180); // Default max 3 hours
        console.log(`[V6] Audio duration: ${audioDurationMinutes || 'unknown'} min, Max allowed: ${maxDurationMinutes} min`);
        const agendaItems = ((_b = meetingData === null || meetingData === void 0 ? void 0 : meetingData.agendaItems) === null || _b === void 0 ? void 0 : _b.map((item, i) => `${i + 1}. ${item.title}`).join('\n')) || '';
        const attendeeNames = ((_c = meetingData === null || meetingData === void 0 ? void 0 : meetingData.attendees) === null || _c === void 0 ? void 0 : _c.map((a) => a.name).join(', ')) || '';
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
        // Format audio duration info for the prompt
        const durationInfo = audioDurationMinutes
            ? `DURÉE TOTALE DE L'AUDIO: ${Math.floor(audioDurationMinutes / 60)}h${audioDurationMinutes % 60}min (${audioDurationMinutes} minutes)`
            : '';
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
${durationInfo}

RÈGLES IMPORTANTES:
1. Commence au début (0:00) et transcris environ 15 minutes de contenu
2. HORODATAGE OBLIGATOIRE: Indique le temps [MM:SS] ou [H:MM:SS] au début de chaque intervention
   Exemple: "[0:00] **Président:** Bonjour à tous..."
            "[1:30] **Membre:** Je voudrais ajouter..."
3. À la fin de ton passage, écris: [CONTINUER À: MM:SS] avec le timestamp où tu t'es arrêté
4. Si tu atteins la FIN RÉELLE de l'audio (silence, plus rien), écris: [FIN DE L'ENREGISTREMENT]
5. N'invente JAMAIS de contenu après la fin de l'audio!`
                : `Continue la transcription de cet enregistrement à partir de [${lastTimestamp}].
${durationInfo}

RAPPEL: Tu as déjà transcrit de 0:00 à ${lastTimestamp}. Continue à partir de là.
RÈGLES:
1. Transcris les 15 prochaines minutes environ
2. HORODATAGE sur chaque intervention: [MM:SS] **Nom:**
3. Si tu atteins la FIN RÉELLE de l'audio, écris IMMÉDIATEMENT: [FIN DE L'ENREGISTREMENT]
4. Sinon, termine par: [CONTINUER À: MM:SS]
5. N'INVENTE PAS de contenu après la fin de l'audio!`;
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
            // SAFEGUARD: Stop if we exceed expected duration (prevents hallucination)
            if (currentMinutes > maxDurationMinutes) {
                console.log(`[V6] STOPPING: Exceeded max duration (${currentMinutes.toFixed(1)} > ${maxDurationMinutes} min) - likely hallucination`);
                // Trim the transcription to remove this hallucinatory chunk
                rawTranscription = rawTranscription.substring(0, rawTranscription.lastIndexOf('\n\n---\n\n'));
                break;
            }
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
        // Update Firestore - Handle both legacy and new array structure
        const docRef = admin.firestore().doc(`meetings/${meetingId}`);
        const currentDoc = await docRef.get();
        const currentData = currentDoc.data();
        const updates = {
            dateUpdated: new Date().toISOString()
        };
        // 1. Update legacy field if it exists and matches
        if (((_d = currentData === null || currentData === void 0 ? void 0 : currentData.audioRecording) === null || _d === void 0 ? void 0 : _d.storagePath) &&
            (currentData.audioRecording.storagePath === storagePath || !currentData.audioRecording.transcription)) {
            updates['audioRecording.transcription'] = finalTranscription;
            updates['audioRecording.rawTranscription'] = rawTranscription;
            updates['audioRecording.transcriptionStatus'] = isComplete ? 'completed' : 'partial';
            updates['audioRecording.transcribedAt'] = new Date().toISOString();
            updates['audioRecording.isOrganized'] = isOrganized;
        }
        // 2. Update item in new array
        if (Array.isArray(currentData === null || currentData === void 0 ? void 0 : currentData.audioRecordings)) {
            const recordings = currentData.audioRecordings;
            const index = recordings.findIndex((r) => r.storagePath === storagePath);
            if (index !== -1) {
                // Update existing item in array
                const updatedRecording = Object.assign(Object.assign({}, recordings[index]), { transcription: finalTranscription, rawTranscription: rawTranscription, transcriptionStatus: isComplete ? 'completed' : 'partial', transcribedAt: new Date().toISOString(), isOrganized: isOrganized });
                // Remove old, add new (Firestore doesn't support updating index directly easily without reading first)
                // Since we read it, we can just replace the whole array or specific item. 
                // Replacing array is safer for now.
                recordings[index] = updatedRecording;
                updates['audioRecordings'] = recordings;
            }
        }
        await docRef.update(updates);
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
const firestore_1 = require("firebase-functions/v2/firestore");
const supabaseC = require("./supabaseClient");
exports.syncMeetingToSupabase = (0, firestore_1.onDocumentWritten)({
    document: "meetings/{meetingId}",
    secrets: [supabaseC.supabaseKeyParam, googleApiKey],
}, async (event) => {
    var _a, _b, _c, _d, _e;
    const meetingId = event.params.meetingId;
    const change = event.data;
    if (!change)
        return;
    if (!change.after.exists) {
        await supabaseC.deleteFromIndex("meetings", meetingId);
        return;
    }
    const data = change.after.data();
    if (!data)
        return;
    // Fix: Handle invalid dates safely to prevent crash
    const parsedDate = data.date ? new Date(data.date) : new Date();
    const safeDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    // Generate Embedding using Gemini for completed meetings (RAG on approved/final PVs)
    let embedding;
    if (googleApiKey.value() && data.status === "completed") {
        try {
            const apiKey = googleApiKey.value();
            const { GoogleGenerativeAI } = require("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
            const agendaList = ((_a = data.agendaItems) === null || _a === void 0 ? void 0 : _a.map((i) => i.title).join(', ')) || '';
            const resolutionsText = ((_b = data.agendaItems) === null || _b === void 0 ? void 0 : _b.flatMap((item) => {
                var _a;
                return ((_a = item.minuteEntries) === null || _a === void 0 ? void 0 : _a.map((entry) => {
                    const text = entry.content || "";
                    return entry.number ? `${entry.number} ${text}` : text;
                })) ||
                    (item.minuteContent ? [item.minuteContent] : []);
            }).join('\n')) || '';
            const textToEmbed = `Réunion: ${data.title || "Sans titre"}\nDate: ${safeDate.toISOString()}\nOrdre du jour: ${agendaList}\nRésolutions:\n${resolutionsText}\nProcès-verbal:\n${data.minutes || ""}`.trim().substring(0, 9000);
            if (textToEmbed) {
                const result = await model.embedContent(textToEmbed);
                embedding = result.embedding.values;
                console.log(`[Supabase] Generated embedding for completed meeting ${meetingId}`);
            }
        }
        catch (error) {
            console.error(`[Supabase] Failed to generate embedding for meeting ${meetingId}`, error);
        }
    }
    const searchableMeeting = {
        id: meetingId,
        title: data.title || "Sans titre",
        date: safeDate.toISOString(),
        dateTimestamp: Math.floor(safeDate.getTime() / 1000),
        type: data.type || "regular",
        status: data.status || "scheduled",
        minutes: data.minutes || "",
        agendaItemTitles: ((_c = data.agendaItems) === null || _c === void 0 ? void 0 : _c.map((i) => i.title)) || [],
        resolutions: ((_d = data.agendaItems) === null || _d === void 0 ? void 0 : _d.flatMap((item) => {
            var _a;
            return ((_a = item.minuteEntries) === null || _a === void 0 ? void 0 : _a.map((entry) => entry.content)) ||
                (item.minuteContent ? [item.minuteContent] : []);
        })) || [],
        attendeeNames: ((_e = data.attendees) === null || _e === void 0 ? void 0 : _e.map((a) => a.name)) || [],
        embedding: embedding
    };
    await supabaseC.indexMeeting(searchableMeeting);
});
exports.syncProjectToSupabase = (0, firestore_1.onDocumentWritten)({
    document: "projects/{projectId}",
    secrets: [supabaseC.supabaseKeyParam],
}, async (event) => {
    const projectId = event.params.projectId;
    const change = event.data;
    if (!change)
        return;
    if (!change.after.exists) {
        await supabaseC.deleteFromIndex("projects", projectId);
        return;
    }
    const data = change.after.data();
    if (!data)
        return;
    const searchableProject = {
        id: projectId,
        code: data.code || "",
        name: data.name || data.title || "Sans nom",
        description: data.description || "",
        category: data.category || "Général",
        status: data.status || "Actif",
        priority: data.priority || "Moyenne",
        notes: data.notes || ""
    };
    await supabaseC.indexProject(searchableProject);
});
exports.syncRegulationToSupabase = (0, firestore_1.onDocumentWritten)({
    document: "regulations/{regulationId}",
    secrets: [supabaseC.supabaseKeyParam, googleApiKey],
}, async (event) => {
    var _a;
    const regulationId = event.params.regulationId;
    const change = event.data;
    if (!change)
        return;
    if (!change.after.exists) {
        await supabaseC.deleteFromIndex("regulations", regulationId);
        return;
    }
    const data = change.after.data();
    if (!data)
        return;
    // Generate Embedding using Gemini
    let embedding;
    if (googleApiKey.value()) {
        try {
            const apiKey = googleApiKey.value();
            const { GoogleGenerativeAI } = require("@google/generative-ai");
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
            const resolutionsText = ((_a = data.agendaItems) === null || _a === void 0 ? void 0 : _a.flatMap((item) => {
                var _a;
                return ((_a = item.minuteEntries) === null || _a === void 0 ? void 0 : _a.map((entry) => {
                    const text = entry.content || "";
                    return entry.number ? `${entry.number} ${text}` : text;
                })) ||
                    (item.minuteContent ? [item.minuteContent] : []);
            }).join('\n')) || '';
            const textToEmbed = `${data.title || ''}\n${data.minutes || ''}\n${resolutionsText}`.trim().substring(0, 9000);
            if (textToEmbed) {
                const result = await model.embedContent(textToEmbed);
                embedding = result.embedding.values;
                console.log(`[Supabase] Generated embedding for regulation ${regulationId}`);
            }
        }
        catch (error) {
            console.error(`[Supabase] Failed to generate embedding for ${regulationId}`, error);
        }
    }
    const searchableRegulation = {
        id: regulationId,
        title: data.title || "Sans titre",
        content: data.content || "",
        category: data.category || "Général",
        year: data.year || new Date().getFullYear(),
        status: data.status || "Actif",
        embedding: embedding
    };
    await supabaseC.indexRegulation(searchableRegulation);
});
//# sourceMappingURL=index.js.map