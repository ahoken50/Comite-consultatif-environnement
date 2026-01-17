import type { AIService, AIProviderId, TranscriptionResult, TranscriptionOptions, SanitizeOptions, ActionItem } from '../ai.types';
import type { Meeting, MinutesDraft } from '../../../types/meeting.types';

const GEMINI_API_KEY = import.meta.env.VITE_GOOGLE_AI_API;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const UPLOAD_API_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

interface GeminiFileResponse {
    file: {
        name: string;
        uri: string;
        mimeType: string;
        state: string;
    };
}

export class GeminiProvider implements AIService {
    id: AIProviderId = 'gemini';

    isConfigured(): boolean {
        return !!GEMINI_API_KEY;
    }

    private async uploadToGemini(blob: Blob, mimeType: string, displayName: string): Promise<string> {
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

        if (!initResponse.ok) throw new Error(`Failed to initiate upload: ${initResponse.statusText}`);

        const uploadUrl = initResponse.headers.get('x-goog-upload-url');
        if (!uploadUrl) throw new Error('No upload URL received from Gemini');

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

        if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.statusText}`);

        const result: GeminiFileResponse = await uploadResponse.json();
        return result.file.uri;
    }

    async transcribe(file: File, options?: TranscriptionOptions): Promise<TranscriptionResult> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const fileUri = await this.uploadToGemini(file, file.type, `transcription-${Date.now()}`);

        const prompt = options?.prompt || `Tu es un secrétaire de séance expert. Transcris cet audio fidèlement. Identifie les interlocuteurs. Structure par points.`;

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
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) throw new Error('Aucune transcription générée');

        return {
            text,
            metrics: { duration: 0 } // Gemini doesn't return duration in this call
        };
    }

    async generateDraft(meeting: Meeting, transcription: string, historicalContext?: string): Promise<MinutesDraft> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const attendeesList = meeting.attendees?.map(a => `${a.name} (${a.role})`).join('\n') || 'Non spécifié';
        const agendaList = meeting.agendaItems?.map((item, i) => `${i + 1}. ${item.title}`).join('\n') || 'Non spécifié';

        const prompt = `Tu es un rédacteur expert de procès-verbaux.
        
OBJET: Rédiger le PV de la réunion "${meeting.title}" du ${meeting.date}.

PARTICIPANTS:
${attendeesList}

ORDRE DU JOUR:
${agendaList}

TRANSCRIPTION:
${transcription}

INSTRUCTIONS:
Rédige un PV détaillé, point par point. Utilise un ton formel et administratif.
Pour chaque point: 
1. Contexte
2. Délibérations (Qui a dit quoi, résumé des échanges)
3. Décision/Résolution (Si applicable)

${historicalContext ? `CONTEXTE HISTORIQUE:\n${historicalContext}` : ''}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 32000 }
            })
        });

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) throw new Error('Failed to generate draft');

        return {
            content,
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
        };
    }

    async finalizeDraft(meeting: Meeting, feedback: string): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const currentDraft = meeting.minutesDraft?.content || '';
        const prompt = `Corrige ce PV selon le feedback suivant:\n\nFEEDBACK:\n${feedback}\n\nPV ACTUAL:\n${currentDraft}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async sanitize(text: string, _options?: SanitizeOptions): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = `Anonymise ce texte pour respecter la loi sur la vie privée (Québec).
        Masque les noms de citoyens, adresses privées, emails, téléphones.
        Ne masque PAS les élus ou fonctionnaires.
        
        TEXTE:
        ${text}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async generateSummary(transcription: string): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = `Génère un résumé exécutif (1 paragraphe) de cette réunion pour l'intro du PV.
         Ton formel. Mentionne les grands thèmes.
         
         TRANSCRIPTION:
         ${transcription.substring(0, 30000)}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async extractActionItems(minutesContent: string): Promise<ActionItem[]> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = `Extrais les tâches/actions à suivre de ce PV au format JSON:
         [{"description": "...", "assignee": "...", "deadline": "YYYY-MM-DD"}]
         
         PV:
         ${minutesContent}`;

        const response = await fetch(`${GEMINI_API_URL.replace('gemini-2.0-flash', 'gemini-1.5-flash')}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return [];

        try {
            return JSON.parse(jsonText);
        } catch (e) {
            console.error("Failed to parse action items JSON", e);
            return [];
        }
    }
}
