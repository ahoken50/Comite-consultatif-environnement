import { db, functions } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import type { Meeting, MinutesDraft } from '../types/meeting.types';

// Environment variable for Gemini API key (matches GOOGLE_AI_API GitHub secret)
const GEMINI_API_KEY = import.meta.env.VITE_GOOGLE_AI_API;

// Gemini API endpoint
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface GeminiResponse {
    candidates?: Array<{
        content: {
            parts: Array<{ text: string }>;
        };
    }>;
    error?: {
        message: string;
    };
}

const UPLOAD_API_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

interface GeminiFileResponse {
    file: {
        name: string;
        uri: string;
        mimeType: string;
        state: string;
    };
}

/**
 * Upload file to Gemini using Resumable Upload Protocol
 * Necessary for files > 20MB
 */
const uploadToGemini = async (blob: Blob, mimeType: string, displayName: string): Promise<string> => {
    if (!GEMINI_API_KEY) throw new Error('API Key missing');

    // 1. Initiate Resumable Upload
    const initResponse = await fetch(`${UPLOAD_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': blob.size.toString(),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: displayName } })
    });

    if (!initResponse.ok) {
        throw new Error(`Failed to initiate upload: ${initResponse.statusText}`);
    }

    const uploadUrl = initResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
        throw new Error('No upload URL received from Gemini');
    }

    // 2. Perform Upload
    const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Length': blob.size.toString(),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize'
        },
        body: blob
    });

    if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    const result: GeminiFileResponse = await uploadResponse.json();
    return result.file.uri;
};




/**
 * Transcribe audio file using Gemini API
 * Updated to use Direct GCS URI for large file support
 */
export const transcribeAudio = async (
    meetingId: string,
    audioUrl: string,
    mimeType: string,
    storagePath?: string // Optional storage path for direct SDK download
): Promise<{ success: boolean; transcription?: string; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return {
            success: false,
            error: 'Clé API Gemini non configurée. Vérifiez GOOGLE_AI_API dans les secrets GitHub.'
        };
    }

    try {
        // Update status to processing
        const meetingRef = doc(db, 'meetings', meetingId);
        await updateDoc(meetingRef, {
            'audioRecording.transcriptionStatus': 'processing',
            dateUpdated: new Date().toISOString()
        });

        // 1. Call Cloud Function instead of client-side fetch due to CORS issues
        console.log('[Transcription] Calling Cloud Function...');
        const transcribeFunction = httpsCallable(functions, 'transcribeAudio', { timeout: 540000 }); // 9 minutes timeout

        const result = await transcribeFunction({
            meetingId,
            storagePath: storagePath || audioUrl, // Pass storage path if avail, else URL (but function expects path)
            mimeType
        });

        // The function updates Firestore directly, so we just verify success
        const data = result.data as { success: boolean; transcription: string; error?: string };

        if (!data.success) {
            throw new Error(data.error || 'Unknown error from server');
        }

        console.log('[Transcription] Success via Cloud Function!');
        return { success: true, transcription: data.transcription };

    } catch (error) {
        console.error('Transcription error handling:', error);

        const err = error as Error;
        const meetingRef = doc(db, 'meetings', meetingId);

        await updateDoc(meetingRef, {
            'audioRecording.transcriptionStatus': 'error',
            'audioRecording.transcriptionError': err.message,
            dateUpdated: new Date().toISOString()
        });

        return {
            success: false,
            error: err.message
        };
    }
};


/**
 * Transcribe a local file directly (bypass download)
 * Used as fallback when auto-fetch fails
 */
export const transcribeLocalFile = async (
    meetingId: string,
    file: File
): Promise<{ success: boolean; transcription?: string; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return { success: false, error: 'Clé API manquante' };
    }

    try {
        const meetingRef = doc(db, 'meetings', meetingId);
        await updateDoc(meetingRef, {
            'audioRecording.transcriptionStatus': 'processing',
            dateUpdated: new Date().toISOString()
        });

        // Upload local file directly to Gemini
        const fileUri = await uploadToGemini(file, file.type, `meeting-${meetingId}`);

        // Call Gemini API (same logic as transcribeAudio)
        const prompt = `Tu es un secrétaire de séance expert. Ta tâche est de transcrire cet enregistrement de réunion de manière détaillée et structurée.

RÈGLES DE TRANSCRIPTION :
1. DÉTAILS : Ne fais PAS de résumé. Transcris les discussions le plus fidèlement possible.
2. STRUCTURE : Organise la transcription par SUJETS ou POINTS D'ORDRE DU JOUR clairement identifiés.
3. INTERVENANTS : Identifie qui parle.
4. FORMAT : Utilise du texte suivi et détaillé pour faciliter la rédaction du procès-verbal.
`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        { file_data: { mime_type: file.type, file_uri: fileUri } }
                    ]
                }]
            })
        });

        if (!response.ok) throw new Error('Refus API Gemini');
        const data = await response.json();

        const transcription = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!transcription) throw new Error('Aucune transcription générée');

        await updateDoc(meetingRef, {
            'audioRecording.transcription': transcription,
            'audioRecording.transcriptionStatus': 'completed',
            dateUpdated: new Date().toISOString()
        });

        return { success: true, transcription };

    } catch (error) {
        console.error('Local transcription error:', error);
        await updateDoc(doc(db, 'meetings', meetingId), {
            'audioRecording.transcriptionStatus': 'error',
            'audioRecording.transcriptionError': error instanceof Error ? error.message : 'Echec transcription locale'
        });
        return { success: false, error: 'Echec transcription locale' };
    }
};

/**
 * Generate minutes draft from transcription using Gemini
 */
export const generateMinutesDraft = async (
    meeting: Meeting,
    transcription: string
): Promise<{ success: boolean; draft?: MinutesDraft; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return {
            success: false,
            error: 'Clé API Gemini non configurée'
        };
    }

    try {
        const attendeesList = meeting.attendees
            ?.map(a => `${a.name} (${a.role})${a.isPresent ? '' : ' - ABSENT'}`)
            .join('\n') || 'Non spécifié';

        const agendaList = meeting.agendaItems
            ?.map((item, i) => `${i + 1}. ${item.title}`)
            .join('\n') || 'Non spécifié';

        const prompt = `Tu es un rédacteur de procès-verbaux professionnel pour le Comité Consultatif en Environnement (CCE) de la Ville de Val-d'Or.

À partir de la transcription suivante, génère un brouillon de procès-verbal structuré.

## INFORMATIONS DE LA RÉUNION
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR
${agendaList}

## TRANSCRIPTION
${transcription}

## INSTRUCTIONS DE RÉDACTION
1. Structure le procès-verbal selon les points de l'ordre du jour
2. Pour chaque point, utilise ce format:
   - Discussion (résumé des échanges)
   - Résolution (si applicable): "RÉSOLUTION XX-XX" avec CONSIDÉRANT et IL EST RÉSOLU
   - Commentaire (si applicable): "COMMENTAIRE XX-X"

3. Utilise le vocabulaire formel des procès-verbaux municipaux
4. Marque [À VÉRIFIER] les éléments dont tu n'es pas certain
5. Identifie les proposeurs et secondeurs des résolutions si mentionnés
6. Reste factuel, ne pas inventer d'informations non présentes dans la transcription

## FORMAT DE SORTIE
Génère un texte structuré avec des titres clairs pour chaque section.`;

        const geminiRequest = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 8000
            }
        };

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(geminiRequest)
        });

        const result: GeminiResponse = await response.json();

        if (result.error) {
            throw new Error(result.error.message);
        }

        const draftContent = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!draftContent) {
            throw new Error('Aucun brouillon généré');
        }

        const draft: MinutesDraft = {
            content: draftContent,
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
        };

        // Update meeting with draft
        const meetingRef = doc(db, 'meetings', meeting.id);
        await updateDoc(meetingRef, {
            minutesDraft: draft,
            dateUpdated: new Date().toISOString()
        });

        return { success: true, draft };

    } catch (error) {
        const err = error as Error;
        console.error('Draft generation error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Finalize draft with user feedback
 */
export const finalizeDraft = async (
    meeting: Meeting,
    userFeedback: string
): Promise<{ success: boolean; finalContent?: string; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return {
            success: false,
            error: 'Clé API Gemini non configurée'
        };
    }

    const currentDraft = meeting.minutesDraft?.content;
    if (!currentDraft) {
        return { success: false, error: 'Aucun brouillon à finaliser' };
    }

    try {
        const prompt = `Tu es un rédacteur de procès-verbaux. Voici un brouillon de procès-verbal et les corrections demandées par l'utilisateur.

## BROUILLON ACTUEL
${currentDraft}

## CORRECTIONS ET FEEDBACK
${userFeedback}

## INSTRUCTIONS
1. Intègre toutes les corrections demandées
2. Supprime tous les marqueurs [À VÉRIFIER]
3. Assure-toi que le format est cohérent et professionnel
4. Ne modifie pas ce qui n'a pas été demandé
5. Produis la version finale du procès-verbal

## FORMAT DE SORTIE
Génère le procès-verbal final, prêt à être imprimé.`;

        const geminiRequest = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 8000
            }
        };

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(geminiRequest)
        });

        const result: GeminiResponse = await response.json();

        if (result.error) {
            throw new Error(result.error.message);
        }

        const finalContent = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!finalContent) {
            throw new Error('Aucune version finale générée');
        }

        // Update meeting
        const meetingRef = doc(db, 'meetings', meeting.id);
        await updateDoc(meetingRef, {
            'minutesDraft.content': finalContent,
            'minutesDraft.status': 'final',
            'minutesDraft.finalizedAt': new Date().toISOString(),
            'minutesDraft.userFeedback': userFeedback,
            'minutesDraft.version': (meeting.minutesDraft?.version || 0) + 1,
            dateUpdated: new Date().toISOString()
        });

        return { success: true, finalContent };

    } catch (error) {
        const err = error as Error;
        console.error('Finalization error:', err);
        return { success: false, error: err.message };
    }
};



/**
 * Check if Gemini API is configured
 */
export const isGeminiConfigured = (): boolean => {
    return !!GEMINI_API_KEY;
};
