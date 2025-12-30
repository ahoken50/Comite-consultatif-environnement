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

        const prompt = `Tu es un rédacteur expert de procès-verbaux pour le Comité Consultatif en Environnement (CCE) de la Ville de Val-d'Or.
OBJECTIF : Rédiger un procès-verbal (PV) professionnel, complet et structuré à partir de la transcription fournie.

## INFORMATIONS
Titre: ${meeting.title}
Date: ${meeting.date}
Lieu: ${meeting.location || 'Salle de conférence'}

## PARTICIPANTS
${attendeesList}

## ORDRE DU JOUR
${agendaList}

## TRANSCRIPTION (Source intégrale)
${transcription}

## DIRECTIVES STRICTES DE RÉDACTION
1. **EXHAUSTIVITÉ & PRÉCISION** : Ne laisse passer aucune résolution ou décision importante. Relève TOUS les points discutés.
2. **STYLE FORMEL MUNICIPAL** : Utilise le ton neutre et administratif (ex: "Le comité discute de...", "Il est proposé par...").
3. **STRUCTURE CLAIRE** :
   - Pour chaque point de l'ordre du jour, crée une section.
   - **RÉSUMÉ** : Synthèse claire des délibérations.
   - **RÉSOLUTION** (Si vote/décision) : Utilise le format "CONSIDÉRANT... IL EST RÉSOLU DE...".
   - **SUIVI** : Mentionne qui doit faire quoi si spécifié.
4. **VÉRIFICATION** : Si une information est floue (nom, date, montant), ajoute la mention **[À VALIDER : ...]**.
5. **NE PAS INVENTER** : Base-toi uniquement sur le texte.

## RÉSULTAT ATTENDU
Un document prêt pour approbation, impeccable et professionnel.`;

        const geminiRequest = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 16000
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

/**
 * Suggested project from AI extraction
 */
export interface SuggestedProject {
    name: string;
    category: 'water' | 'biodiversity' | 'regulation' | 'waste' | 'emergency' | 'innovation' | 'operations' | 'climate';
    priority: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    nextSteps: string;
    isUrgent: boolean;
    sourceResolution?: string;
    estimatedEffort?: string;
}

/**
 * Extract actionable projects from a meeting's completed PV using AI
 */
export const extractProjectsFromPV = async (
    meeting: Meeting
): Promise<{ success: boolean; projects?: SuggestedProject[]; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return { success: false, error: 'Clé API Gemini non configurée.' };
    }

    // Format agenda items with their resolutions
    const agendaItemsFormatted = (meeting.agendaItems || []).map((item, index) => {
        let itemText = `### Point ${index + 1}: ${item.title}\n`;
        itemText += `- Objectif: ${item.objective || 'Non spécifié'}\n`;

        if (item.decision) {
            itemText += `- Décision: ${item.decision}\n`;
        }

        if (item.minuteEntries && item.minuteEntries.length > 0) {
            itemText += `- Résolutions/Commentaires:\n`;
            item.minuteEntries.forEach(entry => {
                const prefix = entry.type === 'resolution' ? '📋 Résolution' : '💬 Commentaire';
                itemText += `  - ${prefix} ${entry.number || ''}: ${entry.content}\n`;
            });
        }

        return itemText;
    }).join('\n');

    const prompt = `Tu es un assistant expert en gestion de comités consultatifs environnementaux municipaux.

Analyse le procès-verbal suivant et extrait les **projets actionnables** qui nécessitent un suivi.

## Réunion: ${meeting.title}
## Date: ${meeting.date}
## Type: ${meeting.type}

## Notes générales:
${meeting.minutes || 'Aucune note générale'}

## Points de l'ordre du jour:
${agendaItemsFormatted || 'Aucun point à l\'ordre du jour'}

---

## Instructions:
1. Identifie chaque action, engagement ou projet mentionné dans les résolutions
2. Ignore les points purement informatifs sans action requise (ex: approbation de l'ordre du jour, adoption du PV précédent)
3. Regroupe les actions similaires en un seul projet
4. Utilise les catégories: water, biodiversity, regulation, waste, emergency, innovation, operations, climate

## Format de réponse (JSON uniquement, sans markdown):
{
  "projects": [
    {
      "name": "Titre clair et concis du projet",
      "category": "water",
      "priority": "medium",
      "description": "Description détaillée de ce qui doit être fait",
      "nextSteps": "Prochaines étapes immédiates",
      "isUrgent": false,
      "sourceResolution": "CCE-2024-15",
      "estimatedEffort": "Court terme"
    }
  ]
}

Si aucun projet actionnable n'est trouvé, retourne: {"projects": []}`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 4096
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            return { success: false, error: errorData.error?.message || 'Erreur API Gemini' };
        }

        const data: GeminiResponse = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            return { success: false, error: 'Réponse vide de l\'IA' };
        }

        // Parse JSON from response (remove markdown code blocks if present)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { success: false, error: 'Format de réponse invalide' };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const projects: SuggestedProject[] = parsed.projects || [];

        return { success: true, projects };

    } catch (error) {
        const err = error as Error;
        console.error('AI extraction error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Sanitize minutes for public release (remove personal info)
 */
export const sanitizeMinutes = async (
    minutesContent: string
): Promise<{ success: boolean; sanitizedContent?: string; error?: string }> => {
    if (!GEMINI_API_KEY) {
        return { success: false, error: 'Clé API Gemini non configurée' };
    }

    try {
        const prompt = `Tu es un expert en conformité et protection de la vie privée pour une administration municipale.
TA MISSIONS : Anonymiser le procès-verbal suivant pour qu'il soit conforme à la Loi sur'accès à l'information.

RÈGLES D'ANONYMISATION :
1. CITOYENS : Remplace les noms complets des citoyens privés par "[NOM MASQUÉ]" ou "un citoyen".
2. ADRESSES : Remplace les adresses civiques privées complètes par le nom de la rue seulement (ex: "123 rue Principale" -> "rue Principale"). 
3. DONNÉES SENSIBLES : Masque les numéros de téléphone, courriels personnels, ou détails financiers privés.
4. ÉLUS ET FONCTIONNAIRES : NE MASQUE PAS les noms des élus municipaux, employés de la ville, ou promoteurs d'entreprises (personnes morales). Ils sont publics.
5. CONTEXTE : Garde le reste du texte intact pour la compréhension.

TEXTE À TRAITER :
${minutesContent}

FORMAT DE SORTIE :
Retourne uniquement le texte traité.`;

        const geminiRequest = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8000
            }
        };

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiRequest)
        });

        const result: GeminiResponse = await response.json();

        if (result.error) {
            throw new Error(result.error.message);
        }

        const sanitizedContent = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!sanitizedContent) {
            throw new Error('Aucun contenu généré');
        }

        return { success: true, sanitizedContent };

    } catch (error) {
        const err = error as Error;
        console.error('Sanitization error:', err);
        return { success: false, error: err.message };
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
