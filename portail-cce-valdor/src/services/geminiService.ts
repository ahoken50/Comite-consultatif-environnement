import { db } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
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

/**
 * Transcribe audio file using Gemini API
 */
export const transcribeAudio = async (
    meetingId: string,
    audioUrl: string,
    mimeType: string
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

        // Fetch audio file as base64
        const response = await fetch(audioUrl);
        const blob = await response.blob();
        const base64Audio = await blobToBase64(blob);

        // Prepare Gemini request
        const geminiRequest = {
            contents: [{
                parts: [
                    {
                        text: `Tu es un transcripteur professionnel. Transcris cet enregistrement audio en français québécois.

Instructions:
- Transcris fidèlement tout ce qui est dit
- Identifie les différents intervenants si possible (Intervenant 1, Intervenant 2, etc.)
- Ajoute des horodatages approximatifs toutes les 2-3 minutes [00:00], [02:00], etc.
- Marque les passages inaudibles avec [INAUDIBLE]
- Utilise des paragraphes pour séparer les différentes interventions
- Ne résume pas, transcris mot pour mot

Format de sortie:
[00:00] Intervenant 1: [Début de la transcription...]
[02:00] Intervenant 2: [Suite...]`
                    },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Audio
                        }
                    }
                ]
            }]
        };

        // Call Gemini API
        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(geminiRequest)
        });

        const result: GeminiResponse = await geminiResponse.json();

        if (result.error) {
            throw new Error(result.error.message);
        }

        const transcription = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!transcription) {
            throw new Error('Aucune transcription générée');
        }

        // Update meeting with transcription
        await updateDoc(meetingRef, {
            'audioRecording.transcription': transcription,
            'audioRecording.transcriptionStatus': 'completed',
            'audioRecording.transcribedAt': new Date().toISOString(),
            dateUpdated: new Date().toISOString()
        });

        return { success: true, transcription };

    } catch (error) {
        const err = error as Error;
        console.error('Transcription error:', err);

        // Update status to error
        const meetingRef = doc(db, 'meetings', meetingId);
        await updateDoc(meetingRef, {
            'audioRecording.transcriptionStatus': 'error',
            'audioRecording.transcriptionError': err.message,
            dateUpdated: new Date().toISOString()
        });

        return { success: false, error: err.message };
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
 * Convert Blob to base64 string
 */
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            // Remove data URL prefix
            const base64Data = base64.split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * Check if Gemini API is configured
 */
export const isGeminiConfigured = (): boolean => {
    return !!GEMINI_API_KEY;
};
