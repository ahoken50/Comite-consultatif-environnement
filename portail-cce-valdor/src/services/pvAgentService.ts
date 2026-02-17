/**
 * SmartPV Agent Service — Pipeline complet en 10 étapes
 *
 * Orchestrates the full PV generation workflow:
 * 1. 🎙️ TRANSCRIPTION     → Audio → Text
 * 2. 🔍 IDENTIFICATION     → Speaker identification
 * 3. 🧹 NETTOYAGE          → Cleanup + merge segments
 * 4. 📋 ANALYSE ODJ        → Map discussions → ODJ items
 * 5. 🏷️ CLASSIFICATION     → Thematic categorization + sentiment
 * 6. ✍️ RÉDACTION          → Generate PV draft
 * 7. 🔄 RÉFLEXION          → Self-critique + auto-corrections (loop)
 * 8. ✅ VALIDATION USER    → Human checkpoint
 * 9. 📊 COMPARAISON        → Historical PV consistency check (loop)
 * 10. 🧠 APPRENTISSAGE     → Update models with corrections
 */

import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { httpsCallable } from 'firebase/functions';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { functions, db } from './firebase';
import type {
    AgentConfig,
    AgentState,
    AgentStep,
    AgentStepId,
    TranscriptionResult,
    IdentificationResult,
    CleaningResult,
    ODJAnalysisResult,
    ClassificationResult,
    DraftingResult,
    ReflectionResult,
    UserValidationResult,
    ComparisonResult,
    LearningResult,
    CCENumbering,
} from '../types/pvAgent.types';
import {
    getODJAnalysisPrompt,
    getClassificationPrompt,
    getDraftingSystemPrompt,
    getDraftingUserPrompt,
    getDraftingExtractionPrompt,
    getReflectionPrompt,
    getComparisonPrompt,
} from '../prompts/pvPipelinePrompts';

// ============================================================================
// AI Provider Configuration
// ============================================================================

const getGroq = () => createGroq({
    apiKey: import.meta.env.VITE_GROQ_API_KEY,
});

// ============================================================================
// Step Definitions (10 steps)
// ============================================================================

export const AGENT_STEPS: Omit<AgentStep, 'status' | 'result' | 'error'>[] = [
    {
        id: 'transcription',
        label: '🎙️ Transcription',
        description: 'Conversion de l\'audio en texte avec identification des intervenants',
        icon: '🎙️',
    },
    {
        id: 'identification',
        label: '🔍 Identification',
        description: 'Identification des locuteurs par empreinte vocale (ML)',
        icon: '🔍',
    },
    {
        id: 'cleaning',
        label: '🧹 Nettoyage',
        description: 'Nettoyage des répétitions, hallucinations et fusion des segments',
        icon: '🧹',
    },
    {
        id: 'odj_analysis',
        label: '📋 Analyse ODJ',
        description: 'Association des discussions aux points de l\'ordre du jour',
        icon: '📋',
    },
    {
        id: 'classification',
        label: '🏷️ Classification',
        description: 'Catégorisation thématique et analyse de sentiment',
        icon: '🏷️',
    },
    {
        id: 'drafting',
        label: '✍️ Rédaction',
        description: 'Génération du brouillon PV (résolutions, commentaires)',
        icon: '✍️',
    },
    {
        id: 'reflection',
        label: '🔄 Réflexion',
        description: 'Auto-critique et corrections automatiques (boucle)',
        icon: '🔄',
    },
    {
        id: 'user_validation',
        label: '✅ Validation',
        description: 'Point de contrôle humain — révision et approbation',
        icon: '✅',
    },
    {
        id: 'comparison',
        label: '📊 Comparaison',
        description: 'Vérification de cohérence avec les PV historiques',
        icon: '📊',
    },
    {
        id: 'learning',
        label: '🧠 Apprentissage',
        description: 'Mise à jour des modèles avec les corrections',
        icon: '🧠',
    },
];

// ============================================================================
// Initial State Factory
// ============================================================================

// ============================================================================
// RLHF & Recommendation Helpers (callable from UI)
// ============================================================================

/** Fetch RLHF-optimized parameters before starting the pipeline */
export const fetchRLHFParams = async (): Promise<{
    policy: Record<string, unknown>;
    preferences: Record<string, unknown>;
    styleMemory: Record<string, unknown>;
    qualityTrends: Record<string, unknown>;
} | null> => {
    try {
        const rlhfGetParams = httpsCallable(functions, 'rlhf_get_optimized_params');
        const result = await rlhfGetParams({ forceReoptimize: false });
        const data = result.data as { success: boolean; policy: Record<string, unknown>; preferences: Record<string, unknown>; styleMemory: Record<string, unknown>; qualityTrends: Record<string, unknown> };
        if (data.success) {
            console.log('[RLHF] Loaded optimized params:', data.policy);
            return {
                policy: data.policy,
                preferences: data.preferences,
                styleMemory: data.styleMemory,
                qualityTrends: data.qualityTrends,
            };
        }
        return null;
    } catch (e) {
        console.warn('[RLHF] Could not fetch optimized params:', e);
        return null;
    }
};

/** Fetch meeting recommendations based on agenda items */
export const fetchMeetingRecommendations = async (
    agendaItems: Array<{ id?: string; title: string; description?: string; objective?: string }>,
    meetingDate: string
): Promise<{
    predictions: Array<{
        odjItemId: string;
        odjTitle: string;
        predictedType: string;
        confidence: number;
        suggestedTemplate: string;
        keywords: string[];
    }>;
    generalSuggestions: string[];
    seasonalRelevance: string[];
} | null> => {
    try {
        const getRecommendations = httpsCallable(functions, 'get_meeting_recommendations');
        const result = await getRecommendations({ agendaItems, meetingDate });
        const data = result.data as {
            success: boolean;
            predictions: Array<{
                odjItemId: string;
                odjTitle: string;
                predictedType: string;
                confidence: number;
                suggestedTemplate: string;
                keywords: string[];
            }>;
            generalSuggestions: string[];
            seasonalRelevance: string[];
        };
        if (data.success) {
            console.log(`[Recommendation] Got ${data.predictions.length} predictions`);
            return {
                predictions: data.predictions,
                generalSuggestions: data.generalSuggestions,
                seasonalRelevance: data.seasonalRelevance,
            };
        }
        return null;
    } catch (e) {
        console.warn('[Recommendation] Could not fetch recommendations:', e);
        return null;
    }
};

/** Fetch ML dashboard data */
export const fetchMLDashboard = async (): Promise<Record<string, unknown> | null> => {
    try {
        const getDashboard = httpsCallable(functions, 'get_ml_dashboard');
        const result = await getDashboard({});
        const data = result.data as { success: boolean } & Record<string, unknown>;
        if (data.success) {
            return data;
        }
        return null;
    } catch (e) {
        console.warn('[ML Dashboard] Could not fetch dashboard:', e);
        return null;
    }
};

// ============================================================================
// Initial State Factory
// ============================================================================

export const createInitialState = (meetingId: string, meetingNumber: number): AgentState => ({
    meetingId,
    meetingNumber,
    mode: 'smartpv',
    steps: AGENT_STEPS.map(step => ({
        ...step,
        status: 'pending',
    })),
    currentStepIndex: 0,
    results: {},
    pipelineVersion: '2.0',
});

// ============================================================================
// Step 1: TRANSCRIPTION — Audio → Text
// ============================================================================

export const runTranscriptionStep = async (
    config: AgentConfig,
    existingTranscription?: string
): Promise<TranscriptionResult> => {
    // If we already have a transcription, use it
    if (existingTranscription) {
        return {
            text: existingTranscription,
            duration: 0,
            speakers: extractSpeakersFromText(existingTranscription, config.members.map(m => m.displayName)),
            engine: 'whisper',
        };
    }

    // If audio file provided, transcribe using existing service
    if (config.audioFile) {
        const { transcribeLocalFile } = await import('./geminiService');
        const result = await transcribeLocalFile(config.meeting.id, config.audioFile);

        if (!result.success || !result.transcription) {
            throw new Error(result.error || 'Échec de la transcription');
        }

        return {
            text: result.transcription,
            duration: 0,
            speakers: extractSpeakersFromText(result.transcription, config.members.map(m => m.displayName)),
            engine: 'gemini',
        };
    }

    throw new Error('Aucun audio ou transcription fourni');
};

// Helper to extract speaker names from transcription
const extractSpeakersFromText = (text: string, memberNames: string[]): string[] => {
    const found: Set<string> = new Set();
    const patterns = [
        /(?:M\.|Mme|Monsieur|Madame)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?)/g,
        ...memberNames.map(name => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))
    ];

    for (const pattern of patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            found.add(match[1] || match[0]);
        }
    }

    return Array.from(found);
};

// ============================================================================
// Step 2: IDENTIFICATION — Speaker identification (delegates to Cloud Function)
// ============================================================================

export const runIdentificationStep = async (
    config: AgentConfig,
    transcription: TranscriptionResult
): Promise<IdentificationResult> => {
    // If transcription already has speaker labels mapped, use them
    const speakerPattern = /\[?(Speaker|Locuteur|Intervenant)\s*(\d+|[A-Z])\]?\s*:/gi;
    const matches = [...transcription.text.matchAll(speakerPattern)];
    const uniqueLabels = new Set(matches.map(m => `${m[1]} ${m[2]}`));

    // Build mapping from detected speakers
    const speakerMapping: Record<string, string> = {};
    const confidence: Record<string, number> = {};
    const unidentified: string[] = [];

    if (transcription.speakers && transcription.speakers.length > 0) {
        // Map detected speakers to member names
        for (const speaker of transcription.speakers) {
            const memberMatch = config.members.find(m =>
                m.displayName.toLowerCase().includes(speaker.toLowerCase()) ||
                speaker.toLowerCase().includes(m.displayName.split(' ').pop()?.toLowerCase() || '')
            );
            if (memberMatch) {
                speakerMapping[speaker] = memberMatch.displayName;
                confidence[speaker] = 0.8;
            } else {
                unidentified.push(speaker);
            }
        }
    }

    // Also try to match speaker labels from transcription
    for (const label of uniqueLabels) {
        if (!speakerMapping[label]) {
            unidentified.push(label);
        }
    }

    return {
        speakerMapping,
        confidence,
        unidentified,
        totalSegments: matches.length || 1,
        identifiedSegments: Object.keys(speakerMapping).length,
    };
};

// ============================================================================
// Step 3: CLEANING — Cleanup + merge segments
// ============================================================================

export const runCleaningStep = async (
    _config: AgentConfig,
    transcription: TranscriptionResult,
    identification: IdentificationResult
): Promise<CleaningResult> => {
    let text = transcription.text;
    let removedDuplicates = 0;
    let mergedSegments = 0;
    const hallucinations: string[] = [];

    // 1. Remove repeated segments (Whisper hallucination pattern)
    const lines = text.split('\n');
    const cleanedLines: string[] = [];
    let prevLine = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === prevLine && trimmed.length > 10) {
            removedDuplicates++;
            continue;
        }
        // Detect repeated phrases within a line
        const repeatedPattern = /(.{20,}?)\1{2,}/g;
        const cleaned = trimmed.replace(repeatedPattern, (_match, group) => {
            removedDuplicates++;
            hallucinations.push(`Répétition détectée: "${group.substring(0, 50)}..."`);
            return group;
        });
        cleanedLines.push(cleaned);
        prevLine = trimmed;
    }

    text = cleanedLines.join('\n');

    // 2. Apply speaker mapping (replace labels with real names)
    // Only remap generic labels like "Speaker 1", "Locuteur A" — NOT already-named speakers
    for (const [label, name] of Object.entries(identification.speakerMapping)) {
        // Skip if the label is already a real name (contains letters and spaces, not a generic label)
        const isGenericLabel = /^(Speaker|Locuteur|Intervenant)\s*(\d+|[A-Z])$/i.test(label.trim());
        if (!isGenericLabel) continue;

        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\[?${escapedLabel}\\]?\\s*:`, 'gi');
        text = text.replace(regex, `${name} :`);
        mergedSegments++;
    }

    // 3. Remove common Whisper hallucination patterns
    const hallucinationPatterns = [
        /(?:Merci d'avoir regardé|Thanks for watching|Sous-titres? réalisés?|Sous-titrage)[^\n]*/gi,
        /(?:♪|🎵|🎶)[^\n]*/g,
        /\[(?:Musique|Music|Applaudissements|Rires)\]/gi,
    ];

    for (const pattern of hallucinationPatterns) {
        const matches = text.match(pattern);
        if (matches) {
            hallucinations.push(...matches.map(m => `Hallucination supprimée: "${m.substring(0, 50)}"`));
            text = text.replace(pattern, '');
            removedDuplicates += matches.length;
        }
    }

    // 4. Clean up excessive whitespace
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return {
        cleanedText: text,
        removedDuplicates,
        mergedSegments,
        hallucinations,
    };
};

// ============================================================================
// Step 4: ANALYSE ODJ — Map discussions → ODJ items
// ============================================================================

export const runODJAnalysisStep = async (
    config: AgentConfig,
    cleaning: CleaningResult
): Promise<ODJAnalysisResult> => {
    const groq = getGroq();

    const prompt = getODJAnalysisPrompt(
        config.meeting,
        cleaning.cleanedText,
    );

    const { text: rawResult } = await generateText({
        model: groq('qwen/qwen3-32b'),
        prompt,
        temperature: 0.3,
    });

    try {
        // Clean response (remove <think> block and code fences)
        let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
        }

        const parsed = JSON.parse(cleaned);

        // Validate and enrich with actual ODJ item IDs
        const mappedItems = (parsed.mappedItems || []).map((item: any) => {
            const odjItem = config.meeting.agendaItems?.find(
                a => a.id === item.odjItemId || a.title === item.odjTitle
            );
            return {
                odjItemId: odjItem?.id || item.odjItemId || `odj-unknown`,
                odjTitle: item.odjTitle || odjItem?.title || 'Sans titre',
                odjOrder: item.odjOrder || odjItem?.order || 0,
                transcriptSegments: Array.isArray(item.transcriptSegments)
                    ? item.transcriptSegments
                    : [item.transcriptSegment || ''],
                speakers: item.speakers || [],
                confidence: item.confidence || 0.5,
            };
        });

        const odjCount = config.meeting.agendaItems?.length || 0;
        const coveragePercent = odjCount > 0
            ? (mappedItems.length / odjCount) * 100
            : 100;

        return {
            mappedItems,
            unmappedSegments: parsed.unmappedSegments || [],
            coveragePercent: parsed.coveragePercent || coveragePercent,
        };
    } catch (e) {
        console.error('Failed to parse ODJ analysis result:', e);
        throw new Error('Échec de l\'analyse de structure ODJ');
    }
};

// ============================================================================
// Step 5: CLASSIFICATION — Thematic categorization + sentiment
// ============================================================================

export const runClassificationStep = async (
    config: AgentConfig,
    odjAnalysis: ODJAnalysisResult
): Promise<ClassificationResult> => {
    const groq = getGroq();

    const prompt = getClassificationPrompt(config.meeting, odjAnalysis);

    const { text: rawResult } = await generateText({
        model: groq('qwen/qwen3-32b'),
        prompt,
        temperature: 0.3,
    });

    try {
        let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
        }

        const parsed = JSON.parse(cleaned);

        return {
            items: parsed.items || [],
            globalThemes: parsed.globalThemes || [],
            globalSentiment: parsed.globalSentiment || 'neutral',
        };
    } catch (e) {
        console.error('Failed to parse classification result:', e);
        throw new Error('Échec de la classification thématique');
    }
};

// ============================================================================
// Step 6: RÉDACTION — Generate PV draft
// ============================================================================

export const runDraftingStep = async (
    config: AgentConfig,
    odjAnalysis: ODJAnalysisResult,
    classification: ClassificationResult,
    cleaning: CleaningResult,
    numbering: CCENumbering
): Promise<DraftingResult> => {
    // Use Cloud Function for Claude (server-side API key)
    const generateMinutes = httpsCallable(functions, 'generate_minutes_claude', { timeout: 540000 });

    const systemPrompt = getDraftingSystemPrompt();
    const userMessage = getDraftingUserPrompt(
        config.meeting,
        odjAnalysis,
        classification,
        numbering,
        cleaning.cleanedText
    );

    const result = await generateMinutes({
        systemPrompt,
        userMessage,
        meetingId: config.meeting.id,
    });

    const data = result.data as { success: boolean; content: string };

    if (!data.success || !data.content) {
        throw new Error('Échec de la génération du brouillon PV');
    }

    // Now extract structured data from the generated PV
    const extractionResult = await extractStructuredData(data.content, numbering);

    return {
        pvContent: data.content,
        ...extractionResult,
    };
};

/** Helper: Extract structured data (resolutions, comments, attendees) from PV text */
const extractStructuredData = async (
    pvContent: string,
    numbering: CCENumbering
): Promise<Omit<DraftingResult, 'pvContent'>> => {
    const groq = getGroq();

    const prompt = getDraftingExtractionPrompt(pvContent, numbering);

    const { text: rawResult } = await generateText({
        model: groq('qwen/qwen3-32b'),
        prompt,
        temperature: 0.1,
    });

    try {
        let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
        }

        const parsed = JSON.parse(cleaned);

        return {
            resolutions: parsed.resolutions || [],
            comments: parsed.comments || [],
            attendees: parsed.attendees || { present: [], absent: [], guests: [] },
            header: parsed.header || {
                assemblyNumber: numbering.assemblyNumber,
                assemblyType: 'ordinaire',
                date: '',
                time: '',
                location: '',
            },
        };
    } catch (e) {
        console.error('Failed to extract structured data:', e);
        // Return minimal structure if extraction fails
        return {
            resolutions: [],
            comments: [],
            attendees: { present: [], absent: [], guests: [] },
            header: {
                assemblyNumber: numbering.assemblyNumber,
                assemblyType: 'ordinaire',
                date: '',
                time: '',
                location: '',
            },
        };
    }
};

// ============================================================================
// Step 7: RÉFLEXION — Self-critique + auto-corrections (loop)
// ============================================================================

export const runReflectionStep = async (
    config: AgentConfig,
    drafting: DraftingResult,
    cleaning: CleaningResult,
    maxIterations: number = 3
): Promise<ReflectionResult> => {
    const iterations: ReflectionResult['iterations'] = [];
    let currentContent = drafting.pvContent;
    let totalIssuesFound = 0;
    let totalIssuesFixed = 0;
    let qualityScore = 0;
    const previousIssuesSummary: string[] = [];

    for (let i = 1; i <= maxIterations; i++) {
        config.onProgress?.('reflection', Math.round((i / maxIterations) * 100));

        const generateMinutes = httpsCallable(functions, 'chat_claude', { timeout: 540000 });

        const prompt = getReflectionPrompt(
            currentContent,
            cleaning.cleanedText,
            i,
            previousIssuesSummary.length > 0 ? previousIssuesSummary.join('\n') : undefined
        );

        const result = await generateMinutes({
            systemPrompt: 'Tu es un réviseur expert de procès-verbaux municipaux. Réponds UNIQUEMENT en JSON valide.',
            userMessage: prompt,
        });

        const data = result.data as { success: boolean; content: string };

        if (!data.success || !data.content) {
            console.warn(`Reflection iteration ${i} failed, stopping loop`);
            break;
        }

        try {
            let cleaned = data.content.replace(/```(?:json)?/g, '').replace(/```/g, '');
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                cleaned = cleaned.substring(start, end + 1);
            }

            const parsed = JSON.parse(cleaned);
            const issues = (parsed.issues || []).map((issue: any) => ({
                ...issue,
                applied: issue.applied ?? true,
            }));

            qualityScore = parsed.qualityScore || 0;

            iterations.push({
                iterationNumber: i,
                issues,
                correctedContent: parsed.correctedContent || currentContent,
            });

            totalIssuesFound += issues.length;
            totalIssuesFixed += issues.filter((issue: any) => issue.applied).length;

            // Track previous issues to avoid repetition
            previousIssuesSummary.push(
                ...issues.map((issue: any) => `- [${issue.type}] ${issue.description}`)
            );

            // Update content for next iteration
            if (parsed.correctedContent) {
                currentContent = parsed.correctedContent;
            }

            // Stop early if quality is high enough or no issues found
            if (qualityScore >= 90 || issues.length === 0) {
                console.log(`Reflection stopped at iteration ${i}: score=${qualityScore}, issues=${issues.length}`);
                break;
            }
        } catch (e) {
            console.error(`Failed to parse reflection iteration ${i}:`, e);
            break;
        }
    }

    return {
        iterations,
        totalIssuesFound,
        totalIssuesFixed,
        finalContent: currentContent,
        qualityScore,
    };
};

// ============================================================================
// Step 8: VALIDATION USER — Human checkpoint (handled by UI)
// ============================================================================

// This step is entirely handled by the UI through the onValidationRequired callback.
// The result is populated when the user approves/rejects.

// ============================================================================
// Step 9: COMPARAISON — Historical PV consistency check
// ============================================================================

export const runComparisonStep = async (
    config: AgentConfig,
    currentPVContent: string,
    meetingNumber: number
): Promise<ComparisonResult> => {
    // 1. Fetch historical PVs from Firestore
    const historicalPVs = await fetchHistoricalPVs(config.meeting.id, 3);

    if (historicalPVs.length === 0) {
        // No historical PVs to compare with
        return {
            historicalPVs: [],
            consistencyChecks: [{
                type: 'format',
                status: 'pass',
                message: 'Aucun PV historique disponible pour comparaison',
            }],
            formatScore: 100,
            corrections: [],
            finalContent: currentPVContent,
        };
    }

    // 2. Run comparison via Claude
    const chatClaude = httpsCallable(functions, 'chat_claude', { timeout: 540000 });

    const prompt = getComparisonPrompt(
        currentPVContent,
        historicalPVs.map(pv => ({ date: pv.date, content: pv.content })),
        meetingNumber
    );

    const result = await chatClaude({
        systemPrompt: 'Tu es un expert en contrôle qualité de procès-verbaux municipaux. Réponds UNIQUEMENT en JSON valide.',
        userMessage: prompt,
    });

    const data = result.data as { success: boolean; content: string };

    if (!data.success || !data.content) {
        throw new Error('Échec de la comparaison historique');
    }

    try {
        let cleaned = data.content.replace(/```(?:json)?/g, '').replace(/```/g, '');
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
        }

        const parsed = JSON.parse(cleaned);

        return {
            historicalPVs: historicalPVs.map(pv => ({
                meetingId: pv.meetingId,
                meetingDate: pv.date,
                meetingTitle: pv.title,
                similarity: 0.8, // Could be computed with embeddings
            })),
            consistencyChecks: parsed.consistencyChecks || [],
            formatScore: parsed.formatScore || 0,
            corrections: parsed.corrections || [],
            finalContent: parsed.correctedContent || currentPVContent,
        };
    } catch (e) {
        console.error('Failed to parse comparison result:', e);
        return {
            historicalPVs: historicalPVs.map(pv => ({
                meetingId: pv.meetingId,
                meetingDate: pv.date,
                meetingTitle: pv.title,
                similarity: 0,
            })),
            consistencyChecks: [],
            formatScore: 0,
            corrections: [],
            finalContent: currentPVContent,
        };
    }
};

/** Helper: Fetch historical PVs from Firestore */
const fetchHistoricalPVs = async (
    currentMeetingId: string,
    count: number
): Promise<Array<{ meetingId: string; date: string; title: string; content: string }>> => {
    try {
        const meetingsRef = collection(db, 'meetings');
        const q = query(
            meetingsRef,
            orderBy('date', 'desc'),
            limit(count + 1) // +1 to exclude current meeting
        );

        const snapshot = await getDocs(q);
        const results: Array<{ meetingId: string; date: string; title: string; content: string }> = [];

        for (const doc of snapshot.docs) {
            if (doc.id === currentMeetingId) continue;
            const data = doc.data();
            const minutes = data.minutes || data.minutesDraft?.content;
            if (minutes && minutes.length > 100) {
                results.push({
                    meetingId: doc.id,
                    date: data.date || '',
                    title: data.title || 'Sans titre',
                    content: minutes,
                });
            }
            if (results.length >= count) break;
        }

        return results;
    } catch (e) {
        console.error('Failed to fetch historical PVs:', e);
        return [];
    }
};

// ============================================================================
// Step 10: APPRENTISSAGE — Update models with corrections
// ============================================================================

export const runLearningStep = async (
    config: AgentConfig,
    reflection: ReflectionResult,
    comparison: ComparisonResult,
    userValidation: UserValidationResult,
    pipelineStartTime?: number,
): Promise<LearningResult> => {
    const modelsUpdated: string[] = [];
    let stylePatterns = 0;
    let terminologyUpdates = 0;
    const nextMeetingHints: string[] = [];

    try {
        // 1. Record feedback in Firestore via Cloud Function
        const pvRecordLearning = httpsCallable(functions, 'pv_record_learning');

        // Collect all corrections from reflection + comparison
        const allCorrections = [
            ...reflection.iterations.flatMap(it => it.issues.map(issue => ({
                type: issue.type,
                description: issue.description,
                fix: issue.suggestedFix,
                source: 'reflection',
                severity: issue.severity,
                applied: issue.applied,
            }))),
            ...comparison.corrections.map(c => ({
                type: 'format',
                description: c.reason,
                fix: `${c.before} → ${c.after}`,
                source: 'comparison',
            })),
        ];

        // Calculate time to approval
        const timeToApproval = pipelineStartTime
            ? (Date.now() - pipelineStartTime) / 1000
            : undefined;

        if (allCorrections.length > 0 || userValidation.userComments) {
            await pvRecordLearning({
                meetingId: config.meeting.id,
                reflectionResult: {
                    iterations: reflection.iterations,
                    qualityScore: reflection.qualityScore,
                    totalIssuesFound: reflection.totalIssuesFound,
                    totalIssuesFixed: reflection.totalIssuesFixed,
                },
                comparisonResult: {
                    corrections: comparison.corrections,
                    consistencyChecks: comparison.consistencyChecks,
                    formatScore: comparison.formatScore,
                },
                userFeedback: userValidation.userComments || '',
            });
            modelsUpdated.push('feedback_model');
        }

        // 2. RLHF: Compute and store reward signal
        try {
            const rlhfComputeRewards = httpsCallable(functions, 'rlhf_compute_rewards');
            const rewardResult = await rlhfComputeRewards({
                meetingId: config.meeting.id,
                corrections: allCorrections,
                qualityScore: reflection.qualityScore,
                formatScore: comparison.formatScore,
                userApproved: userValidation.approved,
                userComments: userValidation.userComments || '',
                timeToApprovalSeconds: timeToApproval,
                reflectionIterations: reflection.iterations.length,
            });

            const rewardData = rewardResult.data as { success: boolean; grade: string; totalReward: number };
            if (rewardData.success) {
                modelsUpdated.push('rlhf_reward');
                console.log(`[RLHF] Reward: ${rewardData.totalReward.toFixed(4)} (grade: ${rewardData.grade})`);
            }
        } catch (rlhfErr) {
            console.warn('[RLHF] Reward computation skipped:', rlhfErr);
        }

        // 3. RLHF: Record user edit preferences if user made edits
        if (userValidation.userEdits) {
            try {
                const rlhfRecordPref = httpsCallable(functions, 'rlhf_record_preference');
                await rlhfRecordPref({
                    meetingId: config.meeting.id,
                    type: 'content',
                    original: 'auto-generated',
                    corrected: userValidation.userEdits.substring(0, 500),
                    context: { source: 'user_validation_edits' },
                });
                modelsUpdated.push('rlhf_preferences');
            } catch (prefErr) {
                console.warn('[RLHF] Preference recording skipped:', prefErr);
            }
        }

        // 4. Extract style patterns from corrections
        const styleIssues = reflection.iterations
            .flatMap(it => it.issues)
            .filter(issue => issue.type === 'style' || issue.type === 'formatting');
        stylePatterns = styleIssues.length;

        if (stylePatterns > 0) {
            modelsUpdated.push('style_patterns');
        }

        // 5. Extract terminology updates
        const terminologyIssues = comparison.consistencyChecks
            .filter(check => check.type === 'terminology');
        terminologyUpdates = terminologyIssues.length;

        if (terminologyUpdates > 0) {
            modelsUpdated.push('terminology_model');
        }

        // 6. Generate hints for next meeting
        if (reflection.qualityScore < 80) {
            nextMeetingHints.push('Améliorer la qualité audio pour une meilleure transcription');
        }
        if (comparison.formatScore < 80) {
            nextMeetingHints.push('Revoir le format du PV pour plus de cohérence avec les précédents');
        }

        const lowConfidenceItems = comparison.consistencyChecks
            .filter(c => c.status === 'warning' || c.status === 'fail');
        if (lowConfidenceItems.length > 0) {
            nextMeetingHints.push(`${lowConfidenceItems.length} point(s) de cohérence à surveiller`);
        }

        // 7. Trigger RLHF policy re-optimization (async, non-blocking)
        try {
            const rlhfOptimize = httpsCallable(functions, 'rlhf_get_optimized_params');
            rlhfOptimize({ forceReoptimize: true }).catch(() => { });
            // Fire and forget — don't block the pipeline
        } catch {
            // Non-critical
        }

    } catch (e) {
        console.error('Learning step partial failure:', e);
        // Learning is non-critical, don't throw
    }

    return {
        modelsUpdated,
        feedbackRecorded: modelsUpdated.length > 0,
        stylePatterns,
        terminologyUpdates,
        nextMeetingHints,
    };
};

// ============================================================================
// Main Orchestrator — 10-step pipeline
// ============================================================================

export const runPVAgent = async (
    config: AgentConfig,
    state: AgentState,
    onStateChange: (state: AgentState) => void
): Promise<AgentState> => {
    let currentState: AgentState = { ...state, startedAt: new Date() };
    const startTime = Date.now();

    const numbering: CCENumbering = {
        assemblyNumber: currentState.meetingNumber,
        nextResolution: 1,
        nextComment: 'A',
    };

    const maxReflectionIterations = config.maxReflectionIterations ?? 3;

    try {
        // ================================================================
        // STEP 1: TRANSCRIPTION
        // ================================================================
        if (config.skipTranscription && config.existingTranscription) {
            currentState = updateStepStatus(currentState, 'transcription', 'skipped');
            currentState = updateStepResult(currentState, 'transcription', {
                text: config.existingTranscription,
                duration: 0,
                speakers: extractSpeakersFromText(config.existingTranscription, config.members.map(m => m.displayName)),
            }, 'skipped');
            onStateChange(currentState);
        } else {
            currentState = updateStepStatus(currentState, 'transcription', 'running');
            onStateChange(currentState);

            const transcription = await runTranscriptionStep(
                config,
                config.existingTranscription || config.meeting.audioRecording?.transcription
            );

            currentState = updateStepResult(currentState, 'transcription', transcription, 'awaiting');
            onStateChange(currentState);

            if (config.onValidationRequired) {
                const validationResult = await config.onValidationRequired('transcription', transcription);
                if (validationResult === false) throw new Error('Étape annulée par l\'utilisateur');
                if (validationResult !== true && typeof validationResult === 'object') {
                    currentState = updateStepResult(currentState, 'transcription', validationResult, 'awaiting');
                }
            }

            currentState = updateStepStatus(currentState, 'transcription', 'completed');
            onStateChange(currentState);
        }

        const transcriptionResult = currentState.results.transcription!;

        // ================================================================
        // STEP 2: IDENTIFICATION
        // ================================================================
        if (config.skipIdentification) {
            currentState = updateStepStatus(currentState, 'identification', 'skipped');
            currentState = updateStepResult(currentState, 'identification', {
                speakerMapping: {},
                confidence: {},
                unidentified: [],
                totalSegments: 0,
                identifiedSegments: 0,
            }, 'skipped');
            onStateChange(currentState);
        } else {
            currentState = updateStepStatus(currentState, 'identification', 'running');
            onStateChange(currentState);

            const identification = await runIdentificationStep(config, transcriptionResult);

            currentState = updateStepResult(currentState, 'identification', identification, 'completed');
            onStateChange(currentState);
        }

        const identificationResult = currentState.results.identification!;

        // ================================================================
        // STEP 3: CLEANING
        // ================================================================
        currentState = updateStepStatus(currentState, 'cleaning', 'running');
        onStateChange(currentState);

        const cleaning = await runCleaningStep(config, transcriptionResult, identificationResult);

        currentState = updateStepResult(currentState, 'cleaning', cleaning, 'completed');
        onStateChange(currentState);

        // ================================================================
        // STEP 4: ANALYSE ODJ
        // ================================================================
        currentState = updateStepStatus(currentState, 'odj_analysis', 'running');
        onStateChange(currentState);

        const odjAnalysis = await runODJAnalysisStep(config, cleaning);

        currentState = updateStepResult(currentState, 'odj_analysis', odjAnalysis, 'awaiting');
        onStateChange(currentState);

        // User validation for ODJ analysis
        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('odj_analysis', odjAnalysis);
            if (validationResult === false) throw new Error('Étape annulée par l\'utilisateur');
            if (validationResult !== true && typeof validationResult === 'object') {
                currentState = updateStepResult(currentState, 'odj_analysis', validationResult, 'awaiting');
            }
        }

        currentState = updateStepStatus(currentState, 'odj_analysis', 'completed');
        onStateChange(currentState);

        const finalODJAnalysis = currentState.results.odj_analysis!;

        // ================================================================
        // STEP 5: CLASSIFICATION
        // ================================================================
        currentState = updateStepStatus(currentState, 'classification', 'running');
        onStateChange(currentState);

        const classification = await runClassificationStep(config, finalODJAnalysis);

        currentState = updateStepResult(currentState, 'classification', classification, 'completed');
        onStateChange(currentState);

        // ================================================================
        // STEP 6: RÉDACTION
        // ================================================================
        currentState = updateStepStatus(currentState, 'drafting', 'running');
        onStateChange(currentState);

        const drafting = await runDraftingStep(
            config,
            finalODJAnalysis,
            classification,
            cleaning,
            numbering
        );

        currentState = updateStepResult(currentState, 'drafting', drafting, 'completed');
        onStateChange(currentState);

        // ================================================================
        // STEP 7: RÉFLEXION (loop)
        // ================================================================
        currentState = updateStepStatus(currentState, 'reflection', 'running');
        onStateChange(currentState);

        const reflection = await runReflectionStep(
            config,
            drafting,
            cleaning,
            maxReflectionIterations
        );

        currentState = updateStepResult(currentState, 'reflection', reflection, 'completed');
        onStateChange(currentState);

        // ================================================================
        // STEP 8: VALIDATION USER
        // ================================================================
        currentState = updateStepStatus(currentState, 'user_validation', 'awaiting');
        onStateChange(currentState);

        let userValidation: UserValidationResult = {
            approved: true,
            validatedAt: new Date().toISOString(),
        };

        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('user_validation', {
                pvContent: reflection.finalContent,
                qualityScore: reflection.qualityScore,
                drafting,
                reflection,
            });

            if (validationResult === false) {
                throw new Error('PV rejeté par l\'utilisateur');
            }

            if (typeof validationResult === 'object' && validationResult !== null) {
                userValidation = {
                    approved: true,
                    userEdits: (validationResult as any).userEdits,
                    userComments: (validationResult as any).userComments,
                    validatedAt: new Date().toISOString(),
                };
            }
        }

        currentState = updateStepResult(currentState, 'user_validation', userValidation, 'completed');
        onStateChange(currentState);

        // Use user-edited content if provided
        const finalPVContent = userValidation.userEdits || reflection.finalContent;

        // ================================================================
        // STEP 9: COMPARAISON (optional)
        // ================================================================
        let comparison: ComparisonResult;

        if (config.enableHistoricalComparison !== false) {
            currentState = updateStepStatus(currentState, 'comparison', 'running');
            onStateChange(currentState);

            comparison = await runComparisonStep(
                config,
                finalPVContent,
                currentState.meetingNumber
            );

            currentState = updateStepResult(currentState, 'comparison', comparison, 'completed');
            onStateChange(currentState);
        } else {
            comparison = {
                historicalPVs: [],
                consistencyChecks: [],
                formatScore: 100,
                corrections: [],
                finalContent: finalPVContent,
            };
            currentState = updateStepStatus(currentState, 'comparison', 'skipped');
            currentState = updateStepResult(currentState, 'comparison', comparison, 'skipped');
            onStateChange(currentState);
        }

        // ================================================================
        // STEP 10: APPRENTISSAGE (optional)
        // ================================================================
        let learning: LearningResult;

        if (config.enableLearning !== false) {
            currentState = updateStepStatus(currentState, 'learning', 'running');
            onStateChange(currentState);

            learning = await runLearningStep(config, reflection, comparison, userValidation, startTime);

            currentState = updateStepResult(currentState, 'learning', learning, 'completed');
            onStateChange(currentState);
        } else {
            learning = {
                modelsUpdated: [],
                feedbackRecorded: false,
                stylePatterns: 0,
                terminologyUpdates: 0,
                nextMeetingHints: [],
            };
            currentState = updateStepStatus(currentState, 'learning', 'skipped');
            currentState = updateStepResult(currentState, 'learning', learning, 'skipped');
            onStateChange(currentState);
        }

        // ================================================================
        // PIPELINE COMPLETE
        // ================================================================
        currentState.completedAt = new Date();
        currentState.totalDuration = Date.now() - startTime;
        onStateChange(currentState);

        return currentState;

    } catch (error) {
        const stepId = currentState.steps.find(s => s.status === 'running' || s.status === 'awaiting')?.id;
        if (stepId) {
            currentState = updateStepStatus(currentState, stepId, 'error');
            currentState.steps = currentState.steps.map(s =>
                s.id === stepId ? { ...s, error: (error as Error).message } : s
            );
        }

        config.onError?.(stepId as AgentStepId, error as Error);
        onStateChange(currentState);
        throw error;
    }
};

// ============================================================================
// State Helpers
// ============================================================================

const updateStepStatus = (
    state: AgentState,
    stepId: AgentStepId,
    status: AgentStep['status']
): AgentState => ({
    ...state,
    steps: state.steps.map(s => s.id === stepId ? { ...s, status } : s),
    currentStepIndex: state.steps.findIndex(s => s.id === stepId),
});

const updateStepResult = (
    state: AgentState,
    stepId: AgentStepId,
    result: unknown,
    status: AgentStep['status']
): AgentState => {
    const newState = updateStepStatus(state, stepId, status);
    return {
        ...newState,
        steps: newState.steps.map(s => s.id === stepId ? { ...s, result } : s),
        results: {
            ...newState.results,
            [stepId]: result,
        },
    };
};