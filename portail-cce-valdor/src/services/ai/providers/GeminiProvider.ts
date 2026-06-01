import type { AIService, AIProviderId, TranscriptionResult, TranscriptionOptions, SanitizeOptions, ResolutionContext } from '../ai.types';
import type { Meeting, MinutesDraft } from '../../../types/meeting.types';
import { PromptRegistry } from '../PromptRegistry';

const GEMINI_API_KEY = import.meta.env.VITE_GOOGLE_AI_API;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Interface for Gemini response structure
interface GeminiResponse {
    candidates?: {
        content?: {
            parts?: {
                text?: string;
            }[];
        };
    }[];
    error?: {
        message: string;
    };
}

export class GeminiProvider implements AIService {
    id: AIProviderId = 'gemini';

    isConfigured(): boolean {
        return !!GEMINI_API_KEY;
    }

    async transcribe(file: File, _options?: TranscriptionOptions): Promise<TranscriptionResult> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const fileUri = await this.uploadToGemini(file, file.type, `transcription-${Date.now()}`);

        const prompt = PromptRegistry.transcription.get();

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

        if (!response.ok) throw new Error('Gemini API refused connection');
        const data: GeminiResponse = await response.json();

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No transcription generated');

        return {
            text,
            // language: 'fr', // Not part of interface currently
            // segments: []    // Not part of interface currently
        };
    }

    async generateDraft(meeting: Meeting, transcription: string, historicalContext?: string): Promise<MinutesDraft> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const attendeesList = meeting.attendees?.map(a => `${a.name} (${a.role})`).join('\n') || 'Non spécifié';
        const agendaList = meeting.agendaItems?.map((item, i) => `${i + 1}. ${item.title}`).join('\n') || 'Non spécifié';

        // Check if transcription is too long (approx 25k chars limit check for safety, though Gemini supports 1M tokens)
        // If > 50000 chars, we use "Smart Chunking"
        if (transcription.length > 50000) {
            console.log(`[Gemini] Large meeting detected (${transcription.length} chars). Using Smart Chunking.`);
            return this.generateDraftChunked(meeting, transcription, attendeesList, agendaList);
        }

        const prompt = PromptRegistry.minutesDraft.get({
            meetingTitle: meeting.title,
            meetingDate: meeting.date,
            meetingLocation: meeting.location || 'Salle de conférence',
            attendeesList,
            agendaList,
            transcription,
            historicalContext: historicalContext || ''
        });

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 8192
                }
            })
        });

        const result: GeminiResponse = await response.json();

        if (result.error) throw new Error(result.error.message);

        const draftContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!draftContent) throw new Error('No draft content generated');

        return {
            content: draftContent,
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
        };
    }

    /**
     * Map-Reduce strategy for large meetings
     */
    private async generateDraftChunked(meeting: Meeting, transcription: string, _attendees: string, agenda: string): Promise<MinutesDraft> {
        const { ContextManager } = await import('../ContextManager');
        const chunks = ContextManager.splitIntoChunks(transcription);

        console.log(`[Gemini] Split into ${chunks.length} chunks.`);

        // 1. Map Phase: Process each chunk
        const partialSummaries: string[] = [];

        for (const chunk of chunks) {
            console.log(`[Gemini] Processing chunk ${chunk.id}/${chunks.length}...`);
            const prompt = PromptRegistry.chunkProcess.get({
                meetingTitle: meeting.title,
                agendaList: agenda,
                chunkId: chunk.id,
                chunkContent: chunk.content
            });

            try {
                const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const data: GeminiResponse = await response.json();
                const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (summary) partialSummaries.push(`--- SECTION ${chunk.id} ---\n${summary}`);
            } catch (e) {
                console.error(`Error processing chunk ${chunk.id}`, e);
                partialSummaries.push(`--- SECTION ${chunk.id} (ERREUR) ---\n[Erreur de traitement pour cette partie]`);
            }
        }

        // 2. Reduce Phase: Fusion
        console.log('[Gemini] Fusing summaries...');
        const fusionPrompt = PromptRegistry.fusion.get({
            meetingTitle: meeting.title,
            meetingDate: meeting.date,
            partialSummaries: partialSummaries.join('\n\n'),
            agendaList: agenda
        });

        const finalResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fusionPrompt }] }],
                generationConfig: { maxOutputTokens: 8192 }
            })
        });

        const finalData: GeminiResponse = await finalResponse.json();
        const finalContent = finalData.candidates?.[0]?.content?.parts?.[0]?.text || partialSummaries.join('\n'); // Fixed part access

        return {
            content: finalContent || 'Erreur de génération finale',
            generatedAt: new Date().toISOString(),
            status: 'draft',
            version: 1
            // Removed 'notes' property as it doesn't exist on MinutesDraft type
        };
    }

    async finalizeDraft(meeting: Meeting, feedback: string): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const currentDraft = meeting.minutesDraft?.content || '';
        const prompt = PromptRegistry.draftFinalize.get({
            currentDraft,
            userFeedback: feedback
        });

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);
        return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async sanitize(text: string, _options?: SanitizeOptions): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = PromptRegistry.sanitize.get({
            content: text
        });

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result: GeminiResponse = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || text;
    }

    async generateSummary(transcription: string): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = `Résume cette réunion en un paragraphe concis pour l'introduction du procès-verbal.\n\nTRANSCRIPTION:\n${transcription.substring(0, 30000)}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result: GeminiResponse = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async extractProjects(meeting: Meeting): Promise<any[]> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        // Format agenda items with their resolutions
        const agendaItemsFormatted = (meeting.agendaItems || []).map((item, index) => {
            let itemText = `### Point ${index + 1}: ${item.title}\n`;
            itemText += `- Objectif: ${item.objective || 'Non spécifié'}\n`;
            if (item.decision) itemText += `- Décision: ${item.decision}\n`;
            if (item.minuteEntries && item.minuteEntries.length > 0) {
                itemText += `- Résolutions/Commentaires:\n`;
                item.minuteEntries.forEach(entry => {
                    const prefix = entry.type === 'resolution' ? '📋 Résolution' : '💬 Commentaire';
                    itemText += `  - ${prefix} ${entry.number || ''}: ${entry.content}\n`;
                });
            }
            return itemText;
        }).join('\n');

        const prompt = PromptRegistry.actionItems.get({
            meetingTitle: meeting.title,
            meetingDate: meeting.date,
            meetingType: meeting.type,
            generalNotes: meeting.minutes || 'Aucune note générale',
            agendaItems: agendaItemsFormatted || 'Aucun point à l\'ordre du jour'
        });

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

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return [];

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return [];

        try {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.projects || [];
        } catch (e) {
            console.error('Failed to parse projects JSON', e);
            return [];
        }
    }

    async suggestFileMatches(fileNames: string[], agendaItems: string[]): Promise<Array<{ fileName: string; agendaItemTitle: string; confidence: number }>> {
        if (!this.isConfigured()) return [];

        const prompt = `Tu es un assistant administratif intelligent.
Tâche : Associer cette liste de fichiers aux points de l'ordre du jour correspondants.

FICHIERS :
${fileNames.map(f => `- ${f}`).join('\n')}

ORDRE DU JOUR :
${agendaItems.map(a => `- ${a}`).join('\n')}

RÈGLES :
1. Analyse le nom du fichier et trouve le point le plus pertinent.
2. Si incertain, mets une confiance basse (< 0.5).
3. Format JSON attendu :
[
  { "fileName": "...", "agendaItemTitle": "...", "confidence": 0.9 }
]
Retourne uniquement le JSON.`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1 }
            })
        });

        const data: GeminiResponse = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return [];

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    async generateEmbedding(text: string): Promise<number[]> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        // Use 'gemini-embedding-001' with 768 dimensions (since text-embedding-004 is deprecated/unsupported for Developer keys)
        const MODEL = 'models/gemini-embedding-001';
        const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/${MODEL}:embedContent`;

        const response = await fetch(`${EMBED_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                content: {
                    parts: [{ text }]
                },
                outputDimensionality: 768
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini Embedding Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const embedding = data.embedding?.values;

        if (!embedding) throw new Error('No embedding returned from Gemini');
        return embedding;
    }

    // Helper for file upload (same as before)
    private async uploadToGemini(blob: Blob, mimeType: string, displayName: string): Promise<string> {
        // Simplified upload logic or copy from original if needed.
        // For brevity assuming standard upload API or reusing existing logic.
        // Re-implementing correctly:

        const UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

        // 1. Start upload
        const initRes = await fetch(`${UPLOAD_URL}?key=${GEMINI_API_KEY}`, {
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

        const uploadUrl = initRes.headers.get('x-goog-upload-url');
        if (!uploadUrl) throw new Error('Failed to get upload URL');

        // 2. Upload bytes
        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Length': blob.size.toString(),
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: blob
        });

        const data = await uploadRes.json();
        return data.file.uri;
    }

    async draftResolution(context: ResolutionContext): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const examplesText = context.similarResolutions
            .map((r, i) => `EXEMPLE ${i + 1} (Source: ${r.source || 'Inconnue'}):\n${r.content}`)
            .join('\n\n');

        const prompt = `Tu es un expert en rédaction de résolutions municipales.
TÂCHE : Rédiger une résolution formelle pour le point suivant, en t'inspirant STRICTEMENT du style et de la structure des exemples fournis.

CONTEXTE DU NOUVEAU POINT :
Titre : ${context.title}
Description : ${context.description}

EXEMPLES DE RÉSOLUTIONS SIMILAIRES (Jurisprudence) :
${examplesText}

INSTRUCTIONS DE RÉDACTION :
1. Utilise le format classique : "CONSIDÉRANT QUE... IL EST RÉSOLU DE...".
2. Si les exemples utilisent des formules spécifiques (ex: "Entériner la demande...", "Recommander au conseil..."), réutilise-les.
3. Sois précis, formel et juridique.
4. Ne mets pas de préambule, fournis directement le texte de la résolution.

RÉSOLUTION PROPOSÉE :`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2, // Low temp for consistency with examples
                    maxOutputTokens: 2048
                }
            })
        });

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);

        return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async extractText(file: File): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        // Reuse the upload method - assumes file is PDF or Image
        const fileUri = await this.uploadToGemini(file, file.type, `ocr-${Date.now()}`);

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "OCR TASK: Extract all text from this document verbatim. Preserve structure (headers, lists) using Markdown." },
                        { file_data: { mime_type: file.type, file_uri: fileUri } }
                    ]
                }]
            })
        });

        if (!response.ok) throw new Error('Gemini API refused connection');
        const data: GeminiResponse = await response.json();

        if (data.error) throw new Error(data.error.message);
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async checkRegulatoryCompliance(resolutionText: string, context?: string): Promise<{
        compliant: boolean;
        issues: string[];
        suggestions: string[];
        citedRegulations: string[];
    }> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        // Use Supabase Search for RAG
        const { searchRegulations } = await import('../../supabaseSearchService');
        const results = await searchRegulations(resolutionText, {
            matchCount: 3,
            matchThreshold: 0.5
        });

        const relevantRegulations = results.hits
            .map(h => `RÈGLEMENT: ${h.document.title}\nCONTENU:\n${h.document.content.substring(0, 1000)}...`)
            .join('\n\n');

        // 2. Ask Gemini to validate
        const prompt = `Tu es "Le Gardien", une IA experte en conformité réglementaire municipale.
TÂCHE : Analyser si le PROJET DE RÉSOLUTION proposé respecte les RÈGLEMENTS MUNICIPAUX fournis.

PROJET DE RÉSOLUTION :
"${resolutionText}"
${context ? `CONTEXTE SUPPLÉMENTAIRE : ${context}` : ''}

RÈGLEMENTS PERTINENTS TROUVÉS :
${relevantRegulations || "Aucun règlement spécifique trouvé (Analyse générale seulement)."}

INSTRUCTIONS D'ANALYSE :
1. Détecte les conflits directs (ex: hauteur maximale dépassée, marge de recul, usage interdit).
2. Détecte les omissions procédurales (ex: mention manquante d'un PIIA, permis requis).
3. Si le texte est conforme, confirme-le.
4. Réponds UNIQUEMENT en format JSON valide.

FORMAT JSON ATTENDU :
{
  "compliant": boolean,
  "issues": ["Description du conflit 1", "Description du conflit 2"], 
  "suggestions": ["Suggestion pour corriger 1", "Suggestion 2"],
  "citedRegulations": ["Titre du règlement cité 1", "Titre 2"]
}
`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1, // Low temp for analytical precision
                    responseMimeType: "application/json" // Force JSON mode
                }
            })
        });

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No compliance analysis generated');

        try {
            const parsed = JSON.parse(text);
            return {
                compliant: parsed.compliant ?? false,
                issues: parsed.issues || [],
                suggestions: parsed.suggestions || [],
                citedRegulations: parsed.citedRegulations || []
            };
        } catch (e) {
            console.error('Failed to parse compliance JSON', e);
            return {
                compliant: false,
                issues: ["Erreur d'analyse IA (Format invalide)"],
                suggestions: [],
                citedRegulations: []
            };
        }
    }

    async analyzeProjectRegulations(projectDescription: string): Promise<{
        relevantRegulationIds: string[];
        reasoning: string;
    }> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        // 1. Search for potentially relevant regulations
        // 1. Search for potentially relevant regulations
        const { searchRegulations } = await import('../../../services/supabaseSearchService');
        const searchResults = await searchRegulations(projectDescription, {
            matchCount: 5,
            // filterBy: 'status:=[En vigueur]' // Not supported in Supabase implementation yet
        });

        if (searchResults.hits.length === 0) {
            return { relevantRegulationIds: [], reasoning: "Aucun règlement pertinent trouvé dans la recherche initiale." };
        }

        const candidates = searchResults.hits.map((h: any) => ({
            id: h.document.id,
            title: h.document.title,
            snippet: h.document.content.substring(0, 500)
        }));

        const candidatesText = candidates.map((c) => `[ID: ${c.id}] ${c.title}\n${c.snippet}...`).join('\n\n');

        // 2. Ask Gemini to filter and explain
        const prompt = `Tu es un expert en urbanisme.
TÂCHE : Identifier les règlements applicables à ce projet municipal.

DESCRIPTION DU PROJET :
"${projectDescription}"

RÈGLEMENTS CANDIDATS (trouvés par recherche par mots-clés) :
${candidatesText}

INSTRUCTIONS :
1. Analyse quels règlements de cette liste sont réellement pertinents pour ce projet.
2. Retourne les IDs des règlements pertinents.
3. Explique brièvement pourquoi.
4. Format JSON attendu :
{
  "relevantRegulationIds": ["id1", "id2"],
  "reasoning": "Explication courte..."
}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json"
                }
            })
        });

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return { relevantRegulationIds: [], reasoning: "Erreur d'analyse IA" };

        try {
            const parsed = JSON.parse(text);
            return {
                relevantRegulationIds: parsed.relevantRegulationIds || [],
                reasoning: parsed.reasoning || "Analyse complétée."
            };
        } catch (e) {
            console.error('Failed to parse analysis JSON', e);
            return { relevantRegulationIds: [], reasoning: "Erreur de formatage IA" };
        }
    }

    async chatWithJurisprudence(question: string, context: string): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = `Tu es un assistant juridique municipal hautement qualifié pour la ville de Val-d'Or.
TÂCHE : Répondre à la question de l'utilisateur de façon extrêmement précise et rigoureuse en te basant sur la jurisprudence (résolutions antérieures) et les règlements municipaux fournis dans le contexte ci-dessous.

CONTEXTE (RÈGLEMENTS & JURISPRUDENCE) :
${context}

QUESTION :
"${question}"

INSTRUCTIONS :
1. Réponds de manière professionnelle, claire et structurée.
2. Cite les Règlements Municipaux pertinents (Titre complet, Catégorie, Année) ainsi que les Résolutions/Décisions antérieures (Titre de séance, Date) de manière explicite pour justifier ta réponse.
3. Si les informations fournies dans le contexte ne permettent pas de répondre de manière complète ou s'il y a un doute, mentionne-le en précisant ce qui manque.
4. Si des règlements et d'anciennes décisions se contredisent ou suggèrent des approches différentes, mets en lumière cette divergence de manière constructive.

RÉPONSE :`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);

        return result.candidates?.[0]?.content?.parts?.[0]?.text || "Désolé, je n'ai pas pu générer de réponse.";
    }

    async generateAnnualSummary(year: number, context: string): Promise<string> {
        if (!this.isConfigured()) throw new Error('Gemini API key not configured');

        const prompt = `Tu es l'analyste principal du Comité Consultatif de l'Environnement (CCE) de la ville de Val-d'Or.
TÂCHE : Rédiger le rapport annuel officiel d'activités du CCE pour l'année ${year} en effectuant une synthèse croisée et transversale des données de séance fournies ci-dessous.

DONNÉES DU COMPIL DES ASSEMBLÉES ET PROJETS (ANNÉE ${year}) :
${context}

INSTRUCTIONS DE RÉDACTION :
1. Adopte un ton très formel, objectif et hautement professionnel.
2. Structure ton rapport selon les sections suivantes (utilise le Markdown) :
   - # RAPPORT ANNUEL D'ACTIVITÉS DU CCE - VAL-D'OR (${year})
   - ## 1. Résumé Exécutif
     (Un aperçu complet de la contribution du comité cette année, des priorités clés et de l'impact global sur la municipalité)
   - ## 2. Faits Saillants et Chiffres Clés
     (Nombre total de séances tenues, de projets étudiés et de résolutions adoptées)
   - ## 3. Analyse Thématique des Dossiers
     (Synthétise les grands thèmes traités cette année : p. ex. urbanisme et zonage, conservation des milieux humides, gestion des eaux, gestion des matières résiduelles. Donne des exemples concrets pour chaque thème.)
   - ## 4. Résolutions Clés et Avis Recommandés
     (Mets en lumière 3 à 5 résolutions majeures adoptées cette année et résume leur portée ou la recommandation formulée au conseil municipal)
   - ## 5. Orientations et Recommandations Administratives pour l'Année Suivante
     (Formule des perspectives d'amélioration ou des enjeux prioritaires pour le CCE dans le futur)

Sois exhaustif et précis, en te basant uniquement sur la réalité des résolutions et des faits transmis dans le contexte. Évite les généralités vagues.

RÉPONSE :`;

        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result: GeminiResponse = await response.json();
        if (result.error) throw new Error(result.error.message);

        return result.candidates?.[0]?.content?.parts?.[0]?.text || "Désolé, je n'ai pas pu générer de rapport de synthèse.";
    }
}
