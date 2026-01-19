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
    expectedDurationMinutes?: number; // Optional: stop transcription after this + margin
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

const googleApiKey = defineSecret("GEMINI_BRIEFING_KEY");

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

        const { meetingId, storagePath, mimeType, expectedDurationMinutes } = data;
        if (!meetingId || !storagePath || !mimeType) throw new HttpsError("invalid-argument", "Missing params.");

        // 1. Get meeting context
        const meetingDoc = await admin.firestore().doc(`meetings/${meetingId}`).get();
        const meetingData = meetingDoc.data();

        // Get actual audio duration from meeting data (in seconds -> convert to minutes)
        const audioDurationSeconds = meetingData?.audioRecording?.duration;
        const audioDurationMinutes = audioDurationSeconds ? Math.ceil(audioDurationSeconds / 60) : null;

        // Set max duration: use actual audio duration if available, else param, else 180 min default
        const maxDurationMinutes = audioDurationMinutes
            ? audioDurationMinutes + 5 // Add 5 min margin to actual duration
            : (expectedDurationMinutes
                ? expectedDurationMinutes + 10
                : 180); // Default max 3 hours
        console.log(`[V6] Audio duration: ${audioDurationMinutes || 'unknown'} min, Max allowed: ${maxDurationMinutes} min`);

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
            } else {
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
            } else if (lastContentTimestamp) {
                lastTimestamp = lastContentTimestamp;
                console.log(`[V6] Extracted last timestamp from content: ${lastTimestamp}`);
            } else {
                // If no timestamp found at all, estimate based on pass number (15 min per pass)
                const estimatedMinutes = (pass + 1) * 15;
                lastTimestamp = `${estimatedMinutes}:00`;
                console.log(`[V6] No timestamp found, estimating: ${lastTimestamp}`);
            }

            rawTranscription += (pass > 0 ? "\n\n---\n\n" : "") + chunk;

            // Parse current timestamp to minutes for validation
            const parseTimestamp = (ts: string): number => {
                const parts = ts.split(':').map(Number);
                if (parts.length === 2) return parts[0] + parts[1] / 60; // MM:SS
                if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60; // HH:MM:SS
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
                } else {
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

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as typesense from "./typesenseClient";

export const syncMeetingToTypesense = onDocumentWritten({
    document: "meetings/{meetingId}",
    secrets: [typesense.typesenseApiKey, typesense.typesenseHost],
}, async (event) => {
    const meetingId = event.params.meetingId;
    const change = event.data;

    if (!change) return; // Should not happen for onDocumentWritten

    // DELETE or Non-existent
    if (!change.after.exists) {
        await typesense.deleteFromIndex("meetings", meetingId);
        return;
    }

    // CREATE or UPDATE
    const data = change.after.data();
    if (!data) return;

    // Transform to SearchableMeeting (simplified for backend)
    // Note: We avoid importing frontend types to prevent build issues
    const searchableMeeting: typesense.SearchableMeeting = {
        id: meetingId,
        title: data.title || "Sans titre",
        date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
        dateTimestamp: data.date ? Math.floor(new Date(data.date).getTime() / 1000) : 0,
        type: data.type || "regular",
        status: data.status || "scheduled",
        minutes: data.minutes || "",
        agendaItemTitles: data.agendaItems?.map((i: any) => i.title) || [],
        resolutions: data.agendaItems?.flatMap((item: any) =>
            item.minuteEntries?.map((entry: any) => entry.content) ||
            (item.minuteContent ? [item.minuteContent] : [])
        ) || [],
        attendeeNames: data.attendees?.map((a: any) => a.name) || [],
    };

    await typesense.indexMeeting(searchableMeeting);
});

export const syncProjectToTypesense = onDocumentWritten({
    document: "projects/{projectId}",
    secrets: [typesense.typesenseApiKey, typesense.typesenseHost],
}, async (event) => {
    const projectId = event.params.projectId;
    const change = event.data;

    if (!change) return;

    if (!change.after.exists) {
        await typesense.deleteFromIndex("projects", projectId);
        return;
    }

    const data = change.after.data();
    if (!data) return;

    const searchableProject: typesense.SearchableProject = {
        id: projectId,
        code: data.code || "",
        name: data.name || data.title || "Sans nom",
        description: data.description || "",
        category: data.category || "Général",
        status: data.status || "Actif",
        priority: data.priority || "Moyenne",
        notes: data.notes || ""
    };

    await typesense.indexProject(searchableProject);
});

export const syncRegulationToTypesense = onDocumentWritten({
    document: "regulations/{regulationId}",
    secrets: [typesense.typesenseApiKey, typesense.typesenseHost, googleApiKey],
}, async (event) => {
    const regulationId = event.params.regulationId;
    const change = event.data;

    if (!change) return;

    if (!change.after.exists) {
        await typesense.deleteFromIndex("regulations", regulationId);
        return;
    }

    const data = change.after.data();
    if (!data) return;

    // Generate Embedding using Gemini
    let embedding: number[] | undefined;
    try {
        const apiKey = googleApiKey.value();
        if (apiKey && (data.title || data.content)) {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

            const textToEmbed = `${data.title || ''}\n${data.content || ''}`.trim().substring(0, 9000); // Limit context
            if (textToEmbed) {
                const result = await model.embedContent(textToEmbed);
                embedding = result.embedding.values;
                console.log(`[Typesense] Generated embedding for regulation ${regulationId}`);
            }
        }
    } catch (error) {
        console.error(`[Typesense] Failed to generate embedding for ${regulationId}`, error);
        // Continue indexing without embedding (fallback to keyword search)
    }

    const searchableRegulation: typesense.SearchableRegulation = {
        id: regulationId,
        title: data.title || "Sans titre",
        content: data.content || "",
        category: data.category || "Général",
        year: data.year || new Date().getFullYear(),
        status: data.status || "active",
        embedding: embedding
    };

    await typesense.indexRegulation(searchableRegulation);
});
