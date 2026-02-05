import { db, functions } from './firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { aiService } from './ai/UnifiedAIService';
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

/*
const UPLOAD_API_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

interface GeminiFileResponse {
    file: {
        name: string;
        uri: string;
        mimeType: string;
        state: string;
    };
}
*/

/**
 * Upload file to Gemini using Resumable Upload Protocol
 * Necessary for files > 20MB
 */
/*
const _uploadToGemini = async (blob: Blob, mimeType: string, displayName: string): Promise<string> => {
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
*/




/**
 * Transcribe audio file using Speechmatics (polling pattern)
 * 1. Submit job (returns immediately)
 * 2. Poll check_transcription until complete (more reliable than webhooks)
 * 3. Firestore is updated when complete
 */
export const transcribeAudio = async (
    meetingId: string,
    audioUrl: string,
    _mimeType: string,
    storagePath?: string
): Promise<{ success: boolean; transcription?: string; error?: string }> => {
    try {
        console.log(`[Transcription] Submitting job for meeting ${meetingId}`);
        if (storagePath) {
            console.log(`[Transcription] Storage path: ${storagePath}`);
        }

        // Submit transcription job (returns immediately)
        const submitFunction = httpsCallable(functions, 'submit_transcription', { timeout: 120000 });

        const submitResult = await submitFunction({
            meetingId,
            downloadUrl: audioUrl,
            storagePath  // Pass storagePath to identify recording in array
        });

        const submitData = submitResult.data as { success: boolean; jobId?: string; error?: string };

        if (!submitData.success) {
            throw new Error(submitData.error || 'Failed to submit transcription');
        }

        console.log(`[Transcription] Job submitted: ${submitData.jobId}`);
        console.log('[Transcription] Starting polling for completion...');

        // Polling removed for FinOps optimization. 
        // The Speechmatics webhook will update Firestore automatically.
        console.log('[Transcription] Job submitted. Waiting for webhook update...');

        // Return success immediately
        return {
            success: true,
            transcription: `Transcription en cours (ID: ${submitData.jobId}). La page se mettra à jour automatiquement.`
        };

    } catch (error) {
        console.error('Transcription error handling:', error);

        const err = error as Error;

        return {
            success: false,
            error: err.message
        };
    }
};

/**
 * Poll transcription status until complete or timeout
 * Polls every 30 seconds for up to 30 minutes
 */
// Polling function removed (FinOps)




/**
 * Transcribe a local file directly (bypass download)
 * Used as fallback when auto-fetch fails
 */
export const transcribeLocalFile = async (
    meetingId: string,
    file: File
): Promise<{ success: boolean; transcription?: string; error?: string }> => {
    try {
        const result = await aiService.transcribe(file);

        const meetingRef = doc(db, 'meetings', meetingId);
        await updateDoc(meetingRef, {
            'audioRecording.transcription': result.text,
            'audioRecording.transcriptionStatus': 'completed',
            dateUpdated: new Date().toISOString()
        });

        return { success: true, transcription: result.text };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Generate minutes draft from transcription using Gemini
 * @param meeting - The current meeting
 * @param transcription - The audio transcription
 * @param historicalContext - Optional formatted historical context (past resolutions)
 */
export const generateMinutesDraft = async (
    meeting: Meeting,
    transcription: string,
    historicalContext?: string
): Promise<{ success: boolean; draft?: MinutesDraft; error?: string }> => {
    try {
        const draft = await aiService.generateDraft(meeting, transcription, historicalContext);

        const meetingRef = doc(db, 'meetings', meeting.id);
        await updateDoc(meetingRef, {
            minutesDraft: draft,
            dateUpdated: new Date().toISOString()
        });

        return { success: true, draft };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Finalize draft with user feedback
 */
export const finalizeDraft = async (
    meeting: Meeting,
    userFeedback: string
): Promise<{ success: boolean; finalContent?: string; error?: string }> => {
    try {
        const finalContent = await aiService.finalizeDraft(meeting, userFeedback);

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
        return { success: false, error: (error as Error).message };
    }
};



/**
 * Check if Gemini API is configured
 */
export const isGeminiConfigured = (): boolean => {
    return !!GEMINI_API_KEY;
};

/**
 * Suggested project from AI extraction
 */
// End of functions


/**
 * Sanitize minutes for public release (remove personal info)
 */
export const sanitizeMinutes = async (
    minutesContent: string
): Promise<{ success: boolean; sanitizedContent?: string; error?: string }> => {
    try {
        const sanitizedContent = await aiService.sanitize(minutesContent);
        return { success: true, sanitizedContent };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Generate speaking points for a council recommendation
 */
export const generateSpeakingPoints = async (
    recommendation: any
): Promise<{ success: boolean; speakingPoints?: string; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return { success: false, error: 'Clé API Gemini non configurée' };
    }

    try {
        const prompt = `Tu es un conseiller politique expert. Ta tâche est de préparer des "Speaking Points" (points de discussion) pour un élu municipal qui doit présenter cette recommandation au conseil de ville.

TITRE : ${recommendation.projectName || 'Non spécifié'}
DESCRIPTION : ${recommendation.description || 'Non spécifié'}
IMPACT ENVIRONNEMENTAL : ${recommendation.impactAnalysis?.environmentalImpact || 'Non spécifié'}
EFFORT DE MISE EN OEUVRE : ${recommendation.impactAnalysis?.implementationEffort || 'Non spécifié'}
COÛT ESTIMÉ : ${recommendation.impactAnalysis?.financial || 'Non spécifié'}

CONTEXTE SUPPLÉMENTAIRE (Commentaires du PV, Discussions précédentes) :
${recommendation.notes || 'Aucun contexte supplémentaire'}

PRODUIS 3 à 5 POINTS CLÉS (Bullet points) :
1. Pourquoi c'est important (L'accroche)
2. Quel est l'bénéfice direct pour la ville/citoyens (L'argument fort) - Utilise les commentaires du PV si pertinents pour appuyer l'argument.
3. Pourquoi la mise en oeuvre est réaliste (La faisabilité)

Ton ton doit être convaincant, clair et concis. Prêt à être lu à l'oral.`;

        const geminiRequest = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 1000
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

        const speakingPoints = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!speakingPoints) {
            throw new Error('Aucun contenu généré');
        }

        return { success: true, speakingPoints };

    } catch (error) {
        const err = error as Error;
        console.error('Speaking points generation error:', err);
        return { success: false, error: err.message };
    }
};

// --- NEW AI WORKFLOW FUNCTIONS ---

import type { PVStructure, VerificationResult, DraftRecommendation } from '../types/ai-workflow.types';

const JSON_MODEL = 'gemini-1.5-flash'; // Better for structured output

export const analyzePVStructure = async (pvText: string): Promise<{ success: boolean; data?: PVStructure; error?: string }> => {
    if (!GEMINI_API_KEY) return { success: false, error: 'API Key missing' };

    try {
        const prompt = `Tu es un expert en analyse de Procès-Verbaux municipaux.
Ta mission est d'analyser le texte suivant et d'extraire une structure JSON stricte.

TEXTE DU PV :
${pvText.substring(0, 30000)} // Limit context to avoid token errors

INSTRUCTIONS :
Extrais les éléments suivants au format JSON uniquement (sans markdown) :
1. "summary": Bref résumé du PV.
2. "agendaItems": Liste des points (id, title, resolutionNumber, content).
3. "resolutions": Liste des résolutions formelles (number, text).
4. "deadlines": Échéances mentionnées (date, task, responsible).
5. "departments": Départements responsables cités.
6. "laws": Lois et règlements cités (reference, description, context).

FORMAT JSON ATTENDU :
{
  "summary": "...",
  "agendaItems": [...],
  "resolutions": [...],
  "deadlines": [...],
  "departments": [...],
  "laws": [...]
}
`;

        const response = await fetch(`${GEMINI_API_URL.replace('gemini-pro', JSON_MODEL)}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    response_mime_type: "application/json",
                    temperature: 0.2
                }
            })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No content');

        const data = JSON.parse(text) as PVStructure;
        return { success: true, data };

    } catch (error) {
        console.error('Structure analysis failed:', error);
        return { success: false, error: (error as Error).message };
    }
};

export const verifyPVClaims = async (laws: any[], deadlines: any[]): Promise<{ success: boolean; results?: VerificationResult[]; error?: string }> => {
    if (!GEMINI_API_KEY) return { success: false, error: 'API Key missing' };

    try {
        // Note: Real web search requires "google_search_retrieval" tool in newer API versions.
        // For standard keys without billing enabling search, this might rely on internal knowledge.
        // We will TRY to request search grounding if supported.

        const claimsText = JSON.stringify({ laws, deadlines }, null, 2);
        const prompt = `Tu es un assistant juridique et administratif expert (Québec/Canada).
Vérifie la validité des références légales et des échéances suivantes extraites d'un PV.

CONTEXTE À VÉRIFIER :
${claimsText}

TÂCHE :
Pour chaque loi ou échéance, vérifie si elle semble conforme aux normes actuelles (LQE, MELCCFP, etc.).
Si tu as accès à la recherche, utilise-la. Sinon, utilise tes connaissances.

FORMAT JSON ATTENDU (Liste d'objets) :
[
  {
    "claim": "Référence à l'article 22 LQE",
    "status": "verified" | "warning" | "info",
    "analysis": "L'article 22 est bien pertinent pour...",
    "source": "Loi sur la qualité de l'environnement"
  }
]
`;

        const response = await fetch(`${GEMINI_API_URL.replace('gemini-pro', JSON_MODEL)}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                // Try to enable tools if possible (requires specific model version)
                // tools: [{ google_search_retrieval: {} }], 
                generationConfig: {
                    response_mime_type: "application/json",
                    temperature: 0.3
                }
            })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        const results = JSON.parse(text) as VerificationResult[];
        return { success: true, results };

    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

export const draftAIRecommendations = async (structure: PVStructure, verification: VerificationResult[]): Promise<{ success: boolean; recommendations?: DraftRecommendation[]; error?: string }> => {
    if (!GEMINI_API_KEY) return { success: false, error: 'API Key missing' };

    try {
        const prompt = `Basé sur l'analyse suivante d'un PV et les vérifications effectuées, rédige des recommandations d'action concrètes.

STRUCTURE DU PV :
${JSON.stringify(structure).substring(0, 15000)}

VÉRIFICATIONS :
${JSON.stringify(verification).substring(0, 5000)}

TÂCHE :
Rédige des recommandations courtes et orientées vers l'action (ex: "Mettre à jour...", "Budgéter...").
Lie chaque recommandation à une résolution source si possible.

FORMAT JSON ATTENDU :
[
  {
    "id": "rec_1",
    "title": "Action courte",
    "description": "Détail de l'action...",
    "priority": "Haute" | "Moyenne" | "Basse",
    "rationale": "Justification...",
    "sourceResolutionNumber": "2024-..."
  }
]
`;

        const response = await fetch(`${GEMINI_API_URL.replace('gemini-pro', JSON_MODEL)}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    response_mime_type: "application/json",
                    temperature: 0.5
                }
            })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        const recommendations = JSON.parse(text) as DraftRecommendation[];
        return { success: true, recommendations };

    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
};

/**
 * Historical context for PV generation
 * Provides previous decisions related to agenda topics
 */
export interface HistoricalContext {
    resolutions: Array<{
        number: string;
        date: string;
        title: string;
        summary: string;
    }>;
    relatedProjects: Array<{
        code: string;
        name: string;
        status: string;
    }>;
}

/**
 * Build historical context from previous meetings
 * Used to enrich AI-generated PV with references to past decisions
 */
export const buildHistoricalContext = (
    previousMeetings: Meeting[],
    currentAgendaItems: Array<{ title: string }>
): HistoricalContext => {
    const resolutions: HistoricalContext['resolutions'] = [];

    // Extract keywords from current agenda for matching
    const keywords = currentAgendaItems
        .map(item => item.title.toLowerCase().split(/\s+/))
        .flat()
        .filter(word => word.length > 3);

    // Search previous meetings for related resolutions
    previousMeetings.forEach(meeting => {
        meeting.agendaItems?.forEach(item => {
            const itemText = item.title.toLowerCase();
            const hasRelatedKeyword = keywords.some(kw => itemText.includes(kw));

            if (hasRelatedKeyword && item.minuteEntries) {
                item.minuteEntries
                    .filter(entry => entry.type === 'resolution' && entry.number)
                    .forEach(entry => {
                        resolutions.push({
                            number: entry.number || '',
                            date: meeting.date,
                            title: item.title,
                            summary: (entry.content || '').substring(0, 200)
                        });
                    });
            }
        });
    });

    return {
        resolutions: resolutions.slice(0, 10), // Limit to 10 most relevant
        relatedProjects: [] // Can be populated from project store if needed
    };
};

/**
 * Format historical context for inclusion in AI prompt
 */
export const formatHistoricalContextForPrompt = (context: HistoricalContext): string => {
    if (context.resolutions.length === 0) {
        return '';
    }

    let text = '\n\n## CONTEXTE HISTORIQUE (Décisions passées liées)\n';
    text += 'Les résolutions suivantes des réunions précédentes peuvent être pertinentes:\n\n';

    context.resolutions.forEach(res => {
        text += `- **${res.number}** (${res.date}): ${res.title}\n`;
        if (res.summary) {
            text += `  Résumé: ${res.summary}...\n`;
        }
    });

    text += '\n> Note: Mentionner ces références si le sujet est rediscuté.\n';

    return text;
};
