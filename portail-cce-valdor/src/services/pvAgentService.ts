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
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { httpsCallable } from 'firebase/functions';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import JSON5 from 'json5';
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
    UserRevisionResult,
    ComparisonResult,
    LearningResult,
    CCENumbering,
} from '../types/pvAgent.types';
import {
    getTopicExtractionPrompt,
    getODJMappingPrompt,
    getClassificationPrompt,
    getDraftingSystemPrompt,
    getDraftingUserPrompt,
    getDraftingExtractionPrompt,
    getReflectionPrompt,
    getComparisonPrompt,
    getUserRevisionPrompt,
} from '../prompts/pvPipelinePrompts';

// ============================================================================
// AI Provider Configuration
// ============================================================================

const getGroq = () => createGroq({
    apiKey: import.meta.env.VITE_GROQ_API_KEY,
});

const getGoogle = () => createGoogleGenerativeAI({
    apiKey: import.meta.env.VITE_GOOGLE_AI_API,
});

interface FallbackConfig {
    primaryProvider: 'groq' | 'google';
    primaryModel: string;
    fallbackProvider: 'groq' | 'google';
    fallbackModel: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
}

export const generateTextWithFallback = async (config: FallbackConfig): Promise<{ text: string }> => {
    const { primaryProvider, primaryModel, fallbackProvider, fallbackModel, prompt, temperature = 0.2, maxTokens, timeout } = config;
    try {
        console.log(`[AI Routing] Trying primary provider: ${primaryProvider} with model ${primaryModel}`);
        const modelInstance = primaryProvider === 'groq' ? getGroq()(primaryModel) : getGoogle()(primaryModel);
        
        const textOptions: any = {
            model: modelInstance,
            prompt,
            temperature,
        };
        if (maxTokens) textOptions.maxTokens = maxTokens;
        if (timeout) textOptions.timeout = timeout;

        const res = await generateText(textOptions);
        return { text: res.text };
    } catch (primaryError: any) {
        console.warn(`[AI Routing] Primary provider ${primaryProvider} failed: ${primaryError?.message || primaryError}. Falling back to ${fallbackProvider} with model ${fallbackModel}`);
        try {
            const modelInstance = fallbackProvider === 'groq' ? getGroq()(fallbackModel) : getGoogle()(fallbackModel);
            
            const textOptions: any = {
                model: modelInstance,
                prompt,
                temperature,
            };
            if (maxTokens) textOptions.maxTokens = maxTokens;
            if (timeout) textOptions.timeout = timeout;

            const res = await generateText(textOptions);
            return { text: res.text };
        } catch (fallbackError: any) {
            console.error(`[AI Routing] Fallback provider ${fallbackProvider} also failed: ${fallbackError?.message || fallbackError}`);
            throw primaryError; // Throw the original error
        }
    }
};

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
        label: 'Validation',
        description: 'Point de contrôle humain — révision et approbation',
        icon: '✅',
    },
    {
        id: 'user_revision',
        label: 'Révision finale',
        description: 'Application des commentaires par l\'IA',
        icon: '🤖',
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
        // PRE-COMPUTE MEMBER LOOKUPS (Optimization Pattern)
        // Extract display name lowercase and last name lowercase once per member
        // to avoid O(N*M) repeated string splits and lowercasing inside the loop.
        const normalizedMembers = config.members.map(m => {
            const displayNameLower = m.displayName.toLowerCase();
            const lastNameLower = m.displayName.split(' ').pop()?.toLowerCase() || '';
            return { member: m, displayNameLower, lastNameLower };
        });

        // Map detected speakers to member names
        for (const speaker of transcription.speakers) {
            const speakerLower = speaker.toLowerCase();
            const memberMatch = normalizedMembers.find(m =>
                m.displayNameLower.includes(speakerLower) ||
                (m.lastNameLower && speakerLower.includes(m.lastNameLower))
            );
            if (memberMatch) {
                speakerMapping[speaker] = memberMatch.member.displayName;
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

    // [REMOVED] Do NOT reconstruct from segments — they are often stale (original diarization)
    // while transcription.text contains user edits (e.g. [Real Name]).
    // Trust the text string as the source of truth.

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
        // Trust user mapping for any label (even if it looks like a real name, user might be correcting a typo)
        if (!label || !name || label === name) continue;

        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match label optionally in brackets, optionally followed by (timestamp), then colon
        const regex = new RegExp(`\\[?${escapedLabel}\\]?(?:\\s*\\(.*?\\))?\\s*:`, 'gi');
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

    // 3.5 Token Pruning: Remove excessive lexical filler verbal tics (Point 3)
    // Clean common French hesitations and filler phrases to save 20-30% context size safely
    const originalLength = text.length;
    
    // Replace hesitations (e.g. "euh...", "euh", "bah", "ben")
    text = text.replace(/\b(?:euh+|bah+|ben+|hein+)\b(?:[\s.,!?]+)?/gi, '');
    
    // Safely remove redundant verbal tics while keeping context (only matching where they are tics, e.g. "en fait," or surrounded by spaces)
    // We target common ones: "en fait", "je veux dire", "tu sais", "du coup" when used as fillers
    text = text.replace(/\b(?:du coup|en fait|je veux dire|tu sais)(?:[\s.,!?]+)/gi, ' ');
    
    // Remove stuttering / word repetitions (e.g. "je... je", "nous nous")
    text = text.replace(/\b(\w+)\b[\s.,]+(?:\b\1\b)/gi, '$1');
    
    // Cleanup double spaces created by the regex replacements
    text = text.replace(/[ ]{2,}/g, ' ');
    
    console.log(`[TokenPruning] Reduced transcript size from ${originalLength} to ${text.length} chars (saved ${((originalLength - text.length)/originalLength * 100).toFixed(1)}% context tokens)`);

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

/**
 * Attempt to repair malformed JSON from LLM output.
 * Fixes: trailing commas, unclosed brackets/braces, truncated strings.
 */
const repairJSON = (raw: string): string => {
    let s = raw.trim();

    // Remove trailing commas before ] or }
    s = s.replace(/,\s*([\]}])/g, '$1');

    // If the string ends abruptly mid-value, try to close it
    // Remove any trailing incomplete key-value pair (e.g. `"key": "val`)
    // by finding the last complete value
    let openBraces = 0;
    let openBrackets = 0;
    for (const ch of s) {
        if (ch === '{') openBraces++;
        if (ch === '}') openBraces--;
        if (ch === '[') openBrackets++;
        if (ch === ']') openBrackets--;
    }

    // If we have unclosed strings (odd number of unescaped quotes after last complete token),
    // try to close the last string
    const lastQuoteIdx = s.lastIndexOf('"');
    if (lastQuoteIdx > 0) {
        // Count unescaped quotes
        let quoteCount = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) quoteCount++;
        }
        if (quoteCount % 2 !== 0) {
            // Odd quotes — close the dangling string
            s += '"';
        }
    }

    // Close unclosed brackets and braces
    for (let i = 0; i < openBrackets; i++) s += ']';
    for (let i = 0; i < openBraces; i++) s += '}';

    // Final cleanup: remove trailing commas again after our additions
    s = s.replace(/,\s*([\]}])/g, '$1');

    return s;
};

// Helper: Extract textual anchors matching ODJ items with Confidence Levels
// ============================================================================
// PROCEDURAL PATTERNS for standard meeting items
// ============================================================================
const PROCEDURAL_PATTERNS = [
    {
        // STRICT: "ordre du jour" ou "ODJ" explicite
        patterns: [
            /\bordre\s+du\s+jour\b/i,
            /\bodj\b/i,
            /adopt(?:er|ion|é)\s+.{0,40}\bordre\s+du\s+jour/i
        ],
        type: 'adoption_odj',
        requireAll: false, // Au moins UN pattern doit matcher
        minLength: 15
    },
    {
        // "bienvenue" ou "ouverture" explicite
        patterns: [
            /\bbienvenue\b/i,
            /\bouverture\s+(?:de\s+)?(?:la\s+)?(?:s[ée]ance|assembl[ée]e)\b/i,
            /\bmot\s+d['']ouverture\b/i
        ],
        type: 'opening',
        requireAll: false, // Au moins UN pattern doit matcher
        minLength: 10
    },
    {
        // STRICT: "levée de l'assemblée" ou "clôture de" quelque chose de pertinent
        patterns: [
            /\blev[ée]e\s+de\s+(?:la\s+|l[''])?assembl[ée]e\b/i,
            /\bcl[ôo]ture\s+de\s+(?:la\s+|l[''])?(?:s[ée]ance|assembl[ée]e|r[ée]union)\b/i,
            /\bajournement\b/i
        ],
        type: 'closing',
        requireAll: false, // Match any closing phrase
        minLength: 10
    },
    {
        patterns: [
            /\bapprobation\s+(?:du\s+)?proc[èe]s[-\s]verbal/i,
            /\badoption\s+(?:du\s+)?pv\b/i
        ],
        type: 'pv_approval',
        requireAll: false, // Match any approval phrase
        minLength: 15
    },
    {
        patterns: [/\bvaria\b/i],
        type: 'varia',
        requireAll: true,
        minLength: 3
    }
];

const extractODJAnchors = (cleanedText: string, agendaItems: any[]): Map<string, { sentences: string[], confidence: 'exact' | 'strong' | 'weak' | 'procedural' }> => {
    const anchors = new Map();
    const textLower = cleanedText.toLowerCase();

    // Normalize accents for better matching
    const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const textNorm = normalize(textLower);

    agendaItems.forEach(item => {
        const titleLower = item.title.toLowerCase();
        const titleNorm = normalize(titleLower);

        // ========== PROCEDURAL DETECTION (PRIORITY) ==========
        // ========== PROCEDURAL DETECTION (PRIORITY) ==========
        for (const pattern of PROCEDURAL_PATTERNS) {
            // Check if item title matches THIS procedural type
            const titleMatchesType = pattern.patterns.some(regex => regex.test(titleLower));

            if (!titleMatchesType) continue; // Skip if title doesn't match this pattern type

            // Search for procedural phrases in text
            const proceduralSentences: string[] = [];
            const sentences = cleanedText.split(/(?<=[.!?])\s+/);

            sentences.forEach(sentence => {
                const trimmed = sentence.trim();

                // Skip too short sentences (noise)
                if (trimmed.length < (pattern.minLength || 10)) return;

                const sentLower = trimmed.toLowerCase();

                // Count how many patterns match
                const matchingPatterns = pattern.patterns.filter(regex => regex.test(sentLower));

                // Decision: requireAll = all patterns must match, otherwise at least one
                const meetsRequirement = pattern.requireAll
                    ? matchingPatterns.length === pattern.patterns.length
                    : matchingPatterns.length > 0;

                if (meetsRequirement && trimmed.length < 300) {
                    proceduralSentences.push(trimmed);
                }
            });

            if (proceduralSentences.length > 0) {
                anchors.set(item.id, {
                    sentences: proceduralSentences.slice(0, 3),
                    confidence: 'procedural'
                });
                console.log(`[Anchor] PROCEDURAL match for "${item.title}" (${pattern.type}) - ${proceduralSentences.length} sentences`);
                return; // Skip other detection methods
            }
        }

        // Level 1: EXACT - Titre complet présent
        if (textNorm.includes(titleNorm)) {
            const sentences = cleanedText.split(/(?<=[.!?])\s+/).filter(s =>
                normalize(s.toLowerCase()).includes(titleNorm)
            );
            if (sentences.length > 0) {
                anchors.set(item.id, {
                    sentences: sentences.slice(0, 5),
                    confidence: 'exact'
                });
                return;
            }
        }

        // Level 2: STRONG - Mots-clés principaux (40% minimum)
        const keywords = titleLower
            .split(/[\s\-,()]+/)
            .map((w: string) => w.replace(/[^\wÀ-ÿ]/g, ''))
            .filter((w: string) => w.length > 3)
            .map(normalize);

        if (keywords.length === 0) return;

        const sentences = cleanedText.split(/(?<=[.!?])\s+/);
        const matchingSentences: string[] = [];

        sentences.forEach(sentence => {
            const sentenceNorm = normalize(sentence.toLowerCase());
            const matchCount = keywords.filter((kw: string) => sentenceNorm.includes(kw)).length;
            const matchRatio = matchCount / keywords.length;

            if (matchRatio >= 0.4) {
                const trimmed = sentence.trim();
                if (trimmed.length < 500) matchingSentences.push(trimmed);
            }
        });

        if (matchingSentences.length > 0) {
            anchors.set(item.id, {
                sentences: matchingSentences.slice(0, 5),
                confidence: 'strong'
            });
            return;
        }

        // Level 3: WEAK
        const importantKeywords = keywords.filter((kw: string) => kw.length > 4);
        if (importantKeywords.length < 2) return;

        const weakMatches = sentences.filter(sentence => {
            const sentenceNorm = normalize(sentence.toLowerCase());
            const matches = importantKeywords.filter((kw: string) => sentenceNorm.includes(kw)).length;
            return matches >= Math.min(2, importantKeywords.length);
        });

        if (weakMatches.length > 0) {
            anchors.set(item.id, {
                sentences: weakMatches.slice(0, 3),
                confidence: 'weak'
            });
        }
    });

    return anchors;
};

/*
    agendaItems.forEach(item => {
        // Tokenize title into significant keywords
        const keywords = item.title.toLowerCase().split(/\s+/)
            .map((w: string) => w.replace(/[^\wÀ-ÿ]/g, '')) // Remove punctuation
            .filter((w: string) => w.length > 3); // Ignore short words

        if (keywords.length === 0) return;

        // Split text into sentences (rough approximation)
        const sentences = cleanedText.split(/(?<=[.!?])\s+/);
        const matchingSentences: string[] = [];

        sentences.forEach(sentence => {
            const lowerSentence = sentence.toLowerCase();
            const matchCount = keywords.filter((kw: string) => lowerSentence.includes(kw)).length;

            // If at least 50% of keywords are present
            if (matchCount >= Math.ceil(keywords.length * 0.5)) {
                // Limit sentence length to avoid massive context
                const trimmed = sentence.trim();
                if (trimmed.length < 500) {
                    matchingSentences.push(trimmed);
                }
            }
        });

        // Keep top 5 matches to save context
        if (matchingSentences.length > 0) {
            anchors.set(item.id, matchingSentences.slice(0, 5));
        }
    });

    return anchors;
};
*/

export const runODJAnalysisStep = async (
    config: AgentConfig,
    cleaning: CleaningResult,
    onProgress?: (msg: string, pct?: number) => void
): Promise<ODJAnalysisResult> => {
    const text = cleaning.cleanedText;

    // Dynamic batch configuration (Point 5)
    let chunkSize = 100000;
    let overlap = 8000; // Increased base overlap to 8k
    
    if (text.length > 400000) {
        // Very long meetings (4h+): use slightly larger chunks (120k) and wider overlap (15k) to maintain context
        chunkSize = 120000;
        overlap = 15000;
        console.log(`[ODJ] Very long transcript detected (${text.length} chars). Adapting chunk size to ${chunkSize} and overlap to ${overlap}.`);
    } else if (text.length > 200000) {
        // Long meetings: 10k overlap
        chunkSize = 100000;
        overlap = 10000;
        console.log(`[ODJ] Long transcript detected (${text.length} chars). Adapting overlap to ${overlap}.`);
    }

    const chunks: string[] = [];

    if (text.length <= chunkSize) {
        chunks.push(text);
    } else {
        console.log(`[ODJ] Text length ${text.length} > ${chunkSize}, splitting into batches...`);
        let currentPos = 0;
        while (currentPos < text.length) {
            let endPos = Math.min(currentPos + chunkSize, text.length);

            // Try to break at a newline to avoid cutting words
            if (endPos < text.length) {
                const lastNewline = text.lastIndexOf('\n', endPos);
                if (lastNewline > currentPos + (chunkSize / 2)) {
                    endPos = lastNewline;
                }
            }

            chunks.push(text.substring(currentPos, endPos));

            if (endPos >= text.length) break;
            currentPos = endPos - overlap;
        }
        console.log(`[ODJ] Created ${chunks.length} batches.`);
    }

    // --- PASS 1: TOPIC EXTRACTION ---
    const allTopics: any[] = [];

    console.log(`[ODJ] PASS 1: Extracting topics from ${chunks.length} chunks...`);
    onProgress?.(`Pass 1: Extraction des sujets (0/${chunks.length})`, 10);

    for (let batchIdx = 0; batchIdx < chunks.length; batchIdx++) {
        onProgress?.(`Pass 1: Extraction des sujets (${batchIdx + 1}/${chunks.length})...`, 10 + (30 * (batchIdx / chunks.length)));
        const chunk = chunks[batchIdx];
        const prompt = getTopicExtractionPrompt(chunk);

        // Retry logic
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const { text: rawResult } = await generateTextWithFallback({
                    primaryProvider: 'groq',
                    primaryModel: 'llama-3.3-70b-versatile',
                    fallbackProvider: 'google',
                    fallbackModel: 'gemini-2.5-flash',
                    prompt,
                    temperature: 0.3,
                });

                let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .replace(/```(?:json)?/g, '').replace(/```/g, '');

                const start = cleaned.indexOf('{');
                const end = cleaned.lastIndexOf('}');
                if (start !== -1 && end !== -1 && end >= start) {
                    cleaned = cleaned.substring(start, end + 1);
                } else {
                    throw new Error("No JSON boundaries found in topic extraction response");
                }

                let parsed: any;
                try {
                    parsed = JSON5.parse(cleaned);
                } catch {
                    console.warn(`[ODJ] Extraction Batch ${batchIdx + 1} failed parse, repairing...`);
                    parsed = JSON5.parse(repairJSON(cleaned));
                }

                if (Array.isArray(parsed.topics)) {
                    console.log(`[ODJ] Batch ${batchIdx + 1}: Found ${parsed.topics.length} topics.`);
                    allTopics.push(...parsed.topics);
                }
                break; // Success
            } catch (e) {
                console.error(`[ODJ] Extraction Batch ${batchIdx + 1} attempt ${attempt} failed:`, e);
            }
        }
    }

    console.log(`[ODJ] PASS 1 Complete. Total topics found: ${allTopics.length}`);

    // NEW: Extract Text Anchors
    const odjAnchors = extractODJAnchors(text, config.meeting.agendaItems || []);
    console.log(`[ODJ] Found anchors for ${odjAnchors.size}/${config.meeting.agendaItems?.length} items`);

    // --- PASS 2: MAPPING TO ODJ ---
    console.log(`[ODJ] PASS 2: Mapping ${allTopics.length} topics to Agenda...`);

    // Limit to ~50k total characters for topics context
    const MAX_TOTAL_CONTEXT = 50000;
    const maxCharsPerTopic = allTopics.length > 0
        ? Math.floor(MAX_TOTAL_CONTEXT / allTopics.length)
        : 7000;
    const finalLimit = Math.max(500, Math.min(7000, maxCharsPerTopic));

    let mappingPrompt = '';
    try {
        mappingPrompt = getODJMappingPrompt(config.meeting, allTopics, undefined, finalLimit, odjAnchors);
    } catch (error: any) {
        console.error("[ODJ] Failed to generate mapping prompt:", error);
        return { mappedItems: [], unmappedSegments: [], coveragePercent: 0 };
    }

    let mappingResult: any = { mappedItems: [], unmappedSegments: [] };

    // Retry logic for mapping
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log(`[ODJ] 🔍 Prompt length: ${mappingPrompt.length} chars`);
            console.log(`[ODJ] 🔍 Prompt ends with: ${mappingPrompt.slice(-200)}`);

            const { text: rawResult } = await generateTextWithFallback({
                primaryProvider: 'google',
                primaryModel: 'gemini-2.5-flash',
                fallbackProvider: 'groq',
                fallbackModel: 'llama-3.3-70b-versatile',
                prompt: mappingPrompt,
                temperature: 0.2,
                maxTokens: 8192,
                timeout: 180000,
            });

            // ========== DEBUG: LOG RAW RESULT ==========
            console.log(`[ODJ] Raw LLM response length: ${rawResult.length} chars`);
            console.log(`[ODJ] Raw response sample (first 500 chars):\n${rawResult.substring(0, 500)}`);
            console.log(`[ODJ] Raw response sample (last 500 chars):\n${rawResult.substring(Math.max(0, rawResult.length - 500))}`);

            let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            console.log(`[ODJ] After <think> removal: ${cleaned.length} chars`);

            // Further clean markdown code blocks just in case
            cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');

            if (start === -1 || end === -1 || end <= start) {
                console.error(`[ODJ] ❌ No valid JSON boundaries found!`);
                console.error(`[ODJ] start=${start}, end=${end}`);
                console.error(`[ODJ] Full cleaned text:\n${cleaned}`);
                throw new Error("No JSON object found in LLM response");
            }

            cleaned = cleaned.substring(start, end + 1);
            console.log(`[ODJ] Extracted JSON length: ${cleaned.length} chars`);
            console.log(`[ODJ] Extracted JSON sample:\n${cleaned.substring(0, 500)}`);

            // BONUS: Validate Structure BEFORE Parse
            const validateJSONStructure = (jsonStr: string): boolean => {
                const opens = (jsonStr.match(/\[/g) || []).length;
                const closes = (jsonStr.match(/\]/g) || []).length;
                const openBraces = (jsonStr.match(/\{/g) || []).length;
                const closeBraces = (jsonStr.match(/\}/g) || []).length;

                if (opens !== closes || openBraces !== closeBraces) {
                    console.error(`[ODJ] ⚠️ JSON déséquilibré: ${opens} [ vs ${closes} ], ${openBraces} { vs ${closeBraces} }`);
                    return false;
                }
                return true;
            };

            if (!validateJSONStructure(cleaned)) {
                console.log('[ODJ] Tentative de réparation automatique (Smart Close)...');

                // Compter les items déjà parsés
                const itemCount = (cleaned.match(/"odjItemId":/g) || []).length;
                console.log(`[ODJ] 🔧 Réparation: ${itemCount} items détectés, manque ${15 - itemCount}`);

                // Fermer l'item en cours
                if (!cleaned.endsWith('}')) {
                    cleaned += '}';
                }
                // Fermer le tableau mappedItems
                if (!cleaned.endsWith(']')) {
                    cleaned += ']';
                }
                // Ajouter unmappedTopics et fermer l'objet racine
                cleaned += ', "unmappedTopics": [] }';

                console.log(`[ODJ] 🔧 JSON réparé: ${cleaned.length} chars`);
            }

            try {
                mappingResult = JSON5.parse(cleaned);
                console.log(`[ODJ] ✅ Direct JSON5 parse success`);
                console.log(`[ODJ] Parsed ${mappingResult.mappedItems?.length || 0} items from JSON`);
                break; // Success
            } catch (e1) {
                console.warn(`[ODJ] Direct JSON5 parse failed, trying repair...`);
                console.error(`[ODJ] Parse error:`, e1);
                console.log(`[ODJ] Failed JSON sample (first 1000 chars):\n${cleaned.substring(0, 1000)}`);

                try {
                    const repaired = repairJSON(cleaned);
                    mappingResult = JSON5.parse(repaired);
                    console.log(`[ODJ] ✅ Repaired JSON5 parse success`);
                    console.log(`[ODJ] Parsed ${mappingResult.mappedItems?.length || 0} items after repair`);
                    break;
                } catch (e2) {
                    console.error(`[ODJ] Repair also failed:`, e2);
                    // Continue to aggressive extraction...
                }
            }
            break; // Success
        } catch (e: any) {
            console.error(`[ODJ] Mapping attempt ${attempt} failed:`, e.message || e);
            if (attempt === 2) console.error("Full error:", e);
        }
    } // Fin de la boucle for retry

    // ========== EMERGENCY FALLBACK SI AUCUN MAPPING ==========
    if (!mappingResult || !mappingResult.mappedItems || mappingResult.mappedItems.length === 0) {
        console.warn(`[ODJ] ⚠️ LLM returned no mappings! Using TOPICS as fallback...`);

        // Stratégie de secours : Mapper les topics directement aux items ODJ par similarité de mots-clés
        const emergencyMappings: any[] = [];

        config.meeting.agendaItems?.forEach(odjItem => {
            const odjKeywords = new Set(
                odjItem.title.toLowerCase()
                    .split(/[\s\-,()]+/)
                    .filter((w: string) => w.length > 3)
            );

            // Trouve les topics qui matchent cet item ODJ
            const matchingTopics: number[] = [];
            allTopics.forEach((topic, idx) => {
                const topicText = ((topic.title || '') + ' ' + (topic.description || '')).toLowerCase();
                const matches = [...odjKeywords].filter(kw => topicText.includes(kw)).length;

                if (matches >= Math.min(2, odjKeywords.size * 0.3)) {
                    matchingTopics.push(idx + 1); // 1-based
                }
            });

            if (matchingTopics.length > 0) {
                emergencyMappings.push({
                    odjItemId: odjItem.id,
                    odjTitle: odjItem.title,
                    odjOrder: odjItem.order,
                    topicIndices: matchingTopics,
                    status: 'discussed',
                    confidence: 0.4 // Low confidence = emergency fallback
                });
                console.log(`[ODJ] Emergency mapped "${odjItem.title}" to topics [${matchingTopics.join(', ')}]`);
            }
        });

        mappingResult = {
            mappedItems: emergencyMappings,
            unmappedSegments: []
        };

        console.log(`[ODJ] Emergency fallback created ${emergencyMappings.length} mappings`);
    }

    const finalUnmappedSegments = mappingResult.unmappedSegments || [];

    // Map by ODJ Item ID to merge content
    const mergedMap = new Map<string, any>();

    // First initialize map with all ODJ items to ensure we track what we have
    config.meeting.agendaItems?.forEach(item => {
        mergedMap.set(item.id, {
            odjItemId: item.id,
            odjTitle: item.title,
            odjOrder: item.order,
            transcriptSegments: [],
            speakers: new Set<string>(),
            confidence: 0,
            count: 0
        });
    });

    // Merge AI results
    const rawMappedItems = mappingResult.mappedItems || [];
    rawMappedItems.forEach((item: any) => {
        // 1. Direct match (ID or Exact Title)
        let odjItem = config.meeting.agendaItems?.find(
            a => a.id === item.odjItemId || a.title === item.odjTitle
        );

        // 2. Fuzzy match fallback
        if (!odjItem && item.odjTitle && config.meeting.agendaItems) {
            const clean = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const target = clean(item.odjTitle);

            if (target.length > 4) { // Avoid short noise
                odjItem = config.meeting.agendaItems.find(a => {
                    const candidate = clean(a.title);
                    return candidate.includes(target) || target.includes(candidate);
                });
            }
        }

        const targetId = odjItem?.id || item.odjItemId;

        if (!mergedMap.has(targetId)) {
            // New item detected (should restrict to known items, but keep for robustness)
            if (targetId) {
                mergedMap.set(targetId, {
                    odjItemId: targetId,
                    odjTitle: item.odjTitle || odjItem?.title || 'Inconnu',
                    odjOrder: item.odjOrder || odjItem?.order || 999,
                    transcriptSegments: [],
                    speakers: new Set<string>(),
                    confidence: 0,
                    count: 0
                });
            } else {
                return; // Skip invalid items
            }
        }

        const entry = mergedMap.get(targetId);

        // NEW: Map-Only Logic (Indices -> Content)
        if (item.topicIndices && Array.isArray(item.topicIndices)) {
            item.topicIndices.forEach((idx: number) => {
                const topic = allTopics[idx - 1]; // 1-based index from prompt
                if (topic) {
                    // Add Description
                    if (topic.description && !entry.transcriptSegments.includes(topic.description)) {
                        entry.transcriptSegments.push(topic.description);
                    }
                    // Add Speakers
                    if (topic.speakers) {
                        const speakers = Array.isArray(topic.speakers) ? topic.speakers : [topic.speakers];
                        speakers.forEach((s: string) => entry.speakers.add(s));
                    }
                }
            });
        }

        // Handle Status / Empty items
        if (item.status === 'skipped' || item.status === 'postponed' || (item.topicIndices?.length === 0 && item.reason)) {
            const reason = item.reason || (item.status === 'postponed' ? "Point reporté" : "Aucune discussion détectée");
            const msg = `[${reason}]`;
            if (!entry.transcriptSegments.includes(msg)) entry.transcriptSegments.push(msg);
        }

        // Legacy/Fallback for direct text (if model ignores instructions)
        if ((!item.topicIndices || item.topicIndices.length === 0) && (item.transcriptSegments || item.transcriptSegment)) {
            const segments = Array.isArray(item.transcriptSegments) ? item.transcriptSegments : [item.transcriptSegment || ''];
            segments.forEach((s: string) => {
                if (s && typeof s === 'string' && s.length > 5 && !entry.transcriptSegments.includes(s)) {
                    entry.transcriptSegments.push(s);
                }
            });
        }
        const conf = typeof item.confidence === 'number' ? item.confidence : 0.5;
        entry.confidence = Math.max(entry.confidence, conf);
        entry.count++;
    });


    // RETRY STRATEGY: Force Map using Anchors to fill empty items
    // -----------------------------------------------------------------------
    if (odjAnchors.size > 0) {
        console.log(`[ODJ] Checking for unused anchors to fill empty items...`);
        odjAnchors.forEach((data, itemId) => {
            const entry = mergedMap.get(itemId);
            if (entry) {
                // Check if it has "real" content
                const hasRealContent = entry.transcriptSegments.some((s: string) => !s.startsWith('['));

                if (!hasRealContent && data.sentences.length > 0) {
                    console.log(`[ODJ] 🔄 Force-mapping item "${entry.odjTitle}" using ${data.sentences.length} anchors`);

                    // Clear placeholders (like "[Aucune discussion]")
                    entry.transcriptSegments = entry.transcriptSegments.filter((s: string) => !s.startsWith('['));

                    // Add anchor sentences
                    data.sentences.forEach(s => {
                        if (!entry.transcriptSegments.includes(s)) entry.transcriptSegments.push(s);
                    });

                    // Boost confidence
                    const anchorConf =
                        data.confidence === 'exact' ? 0.95 :
                            data.confidence === 'procedural' ? 0.9 :
                                data.confidence === 'strong' ? 0.75 : 0.6;
                    entry.confidence = Math.max(entry.confidence, anchorConf);
                    entry.count = Math.max(entry.count, 1);
                }
            }
        });
    }

    // Convert back to array
    const mappedItems = Array.from(mergedMap.values())
        .filter(entry => entry.transcriptSegments.length > 0) // Only keep items with content
        .map(entry => ({
            odjItemId: entry.odjItemId,
            odjTitle: entry.odjTitle,
            odjOrder: entry.odjOrder,
            transcriptSegments: entry.transcriptSegments,
            speakers: Array.from(entry.speakers) as string[],
            confidence: entry.confidence
        }))
        .sort((a, b) => a.odjOrder - b.odjOrder);

    const odjCount = config.meeting.agendaItems?.length || 0;
    const coveragePercent = odjCount > 0
        ? (mappedItems.length / odjCount) * 100
        : 100;

    console.log(`[ODJ] Final merge: ${mappedItems.length}/${odjCount} items mapped (${coveragePercent.toFixed(1)}%)`);

    // Compter les items VRAIMENT mappés (pas juste force-mappés)
    const reallyMapped = Array.from(mergedMap.values()).filter(entry => {
        // Un item est "vraiment mappé" si :
        // 1. Il a des segments de transcription réels (pas juste des anchors)
        // 2. OU il a une confidence > 0.8 (= LLM a vraiment matché)
        const hasRealContent = entry.transcriptSegments.some((seg: string) =>
            seg.length > 50 && !seg.startsWith('[Anchor]')
        );
        return hasRealContent || entry.confidence > 0.8;
    }).length;

    const forceMapOnly = mergedMap.size - reallyMapped;

    console.log(`[ODJ] Résultat final:
      ✅ Vraiment mappés: ${reallyMapped}/15 (${(reallyMapped / 15 * 100).toFixed(1)}%)
      ⚠️ Force-mappés (anchors seulement): ${forceMapOnly}
      📊 Total dans mergedMap: ${mergedMap.size}/15`);

    if (reallyMapped < 15) {
        if (config.meeting.agendaItems) {
            const unmapped = config.meeting.agendaItems
                .filter(item => {
                    const entry = mergedMap.get(item.id);
                    // items are weak if they have no text
                    return (!entry || entry.transcriptSegments.length === 0 || entry.transcriptSegments[0].startsWith('['));
                })
                .map(item => item.title);

            console.error(`[ODJ] ❌ Items manquants ou faibles:`, unmapped);
        }
    }

    // ============================================================================
    // 🆕 PASS 3: REFINEMENT - Auto-critique du mapping
    // ============================================================================

    // Filtre pré-refinement
    const needsRefinement =
        Array.from(mergedMap.values()).some(entry => entry.transcriptSegments.length > 3) || // Un item a >3 topics
        Array.from(mergedMap.values()).filter(entry =>
            entry.transcriptSegments.length === 0 ||
            (entry.transcriptSegments.length === 1 && entry.transcriptSegments[0].startsWith('['))
        ).length >= 1; // >= 1 item vide déclenche la Pass 3 (Refinement)

    if (!needsRefinement) {
        console.log('[ODJ] ✅ Mapping déjà optimal, skip refinement');
    } else {
        console.log('[ODJ] PASS 3: Refinement du mapping...');

        // Define agendaItems for scope within prompt or usage
        const agendaItemsList = config.meeting.agendaItems || [];

        const refinementPrompt = `Tu es un expert en analyse de procès-verbaux municipaux.

MISSION : Critiquer et corriger le mapping initial entre topics et items ODJ.

ODJ ITEMS (${agendaItemsList.length} items) :
${agendaItemsList.map((item, i) => `${i}. "${item.title}"`).join('\n')}

MAPPING INITIAL :
${JSON.stringify(
            Array.from(mergedMap.entries()).map(([id, data]) => ({
                odjItemId: id,
                odjTitle: agendaItemsList.find(a => a.id === id)?.title,
                topicCount: data.transcriptSegments.length,
                topicsSample: data.transcriptSegments.slice(0, 2).map((s: string) => s.slice(0, 100))
            })),
            null,
            2
        )}

TOPICS EXTRAITS (${allTopics.length} topics) :
${allTopics.map((t, i) => `${i + 1}. "${t.title}" - ${t.description?.slice(0, 150)}...`).join('\n')}

⚠️ PROBLÈMES À IDENTIFIER :
1. **Varia surchargé** : Si l'item "Varia" contient des topics spécifiques (qui ne sont pas des questions diverses), déplace-les vers l'item ODJ pertinent.
2. **Items vides par erreur** : Si un item est vide ET qu'un topic existant correspond CLAIREMENT à cet item, associe-le. ATTENTION : NE FORCE PAS d'association juste pour "remplir un trou". Si un item n'a pas été abordé, laisse-le vide !
3. **Mauvais regroupements** : Si un topic est associé à un item dont le titre/thème ne correspond pas du tout, déplace-le.
4. **Doublons** : Un même topic ne doit pas être dans plusieurs items.

🎯 PROCESSUS DE RÉFLEXION :
1. Pour chaque topic, vérifie s'il est logiquement lié à son item ODJ actuel. Sinon, déplace-le vers un meilleur item.
2. Si "Varia" contient des topics techniques (ex: discussion sur un règlement, un parc), sors-les de Varia.
3. RAPPEL CRITIQUE : Il VAUT MIEUX laisser un item ODJ vide que de lui inventer un sujet non pertinent. Ne fais une correction que si elle est ÉVIDENTE.
4. RÈGLE DE NON-DUPLICATION : Si un topic est très similaire à un autre, regroupe-les dans le MÊME item ODJ (le plus spécifique). Un sujet de réglementation environnementale va avec l'item de réglementation, pas dans Varia ni dans "Renouvellement des mandats".

📋 FORMAT DE SORTIE (JSON strict) :
{
  "corrections": [
    {
      "topicIndex": 5,
      "topicTitle": "...",
      "action": "move",
      "reason": "Le sujet 'forum eau potable' correspond mieux à 'Planification 2026' qu'à 'Varia'",
      "from": "item-13",
      "to": "item-9"
    }
  ],
  "validation": {
    "variaItemCount": 3,
    "emptyItemsCount": 2,
    "confidence": 0.85
  }
}

Réponds UNIQUEMENT avec le JSON de corrections.`;

        let refinementResult;
        try {
            const refineResponse = await generateTextWithFallback({
                primaryProvider: 'google',
                primaryModel: 'gemini-2.5-flash',
                fallbackProvider: 'groq',
                fallbackModel: 'llama-3.3-70b-versatile',
                prompt: refinementPrompt,
                temperature: 0.2,
                maxTokens: 8192,
            });

            let cleaned = refineResponse.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            console.log(`[ODJ] PASS 3 Raw LLM Response length: ${cleaned.length}`);
            console.log(`[ODJ] PASS 3 Raw LLM Response:`);
            console.log(cleaned.substring(0, 3000)); // Log details to debug

            // Handle markdown ```json``` wrapping
            if (cleaned.startsWith('```')) { cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, ''); }

            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const refinementJSON = cleaned.substring(start, end + 1);
                refinementResult = JSON5.parse(refinementJSON);
                console.log(`[ODJ] ✅ Refinement: ${refinementResult?.corrections?.length || 0} corrections identifiées`);
            } else {
                throw new Error("No JSON object found in Refinement response");
            }
        } catch (err: any) {
            console.warn('[ODJ] ⚠️ Refinement pass failed, skipping:', err.message);
        }

        // ============================================================================
        // 🆕 PASS 4: APPLICATION DES CORRECTIONS
        // ============================================================================
        if (refinementResult?.corrections?.length > 0) {
            console.log('[ODJ] PASS 4: Application des corrections...');

            for (const correction of refinementResult.corrections) {
                if (correction.action === 'move') {
                    const fromEntry = mergedMap.get(correction.from);
                    const toEntry = mergedMap.get(correction.to);

                    if (fromEntry && toEntry) {
                        // Trouver le topic correspondant dans allTopics
                        const topic = allTopics[correction.topicIndex - 1]; // -1 car topicIndex est 1-based

                        if (topic) {
                            // Chercher le segment de texte qui ressemble à la description du topic
                            const topicText = topic.description || '';
                            const segmentsToMove = fromEntry.transcriptSegments.filter((seg: string) =>
                                seg.includes(topicText.slice(0, 50)) || topicText.includes(seg.slice(0, 50))
                            );

                            if (segmentsToMove.length > 0) {
                                // Déplacer les segments
                                toEntry.transcriptSegments = toEntry.transcriptSegments.filter((s: string) => !s.startsWith('['));
                                segmentsToMove.forEach((seg: string) => {
                                    if (!toEntry.transcriptSegments.includes(seg)) {
                                        toEntry.transcriptSegments.push(seg);
                                    }
                                });

                                fromEntry.transcriptSegments = fromEntry.transcriptSegments.filter(
                                    (seg: string) => !segmentsToMove.includes(seg)
                                );

                                // Mettre à jour les speakers
                                if (topic.speakers) {
                                    const newSpeakers = Array.from(new Set([...toEntry.speakers, ...topic.speakers]));
                                    toEntry.speakers = new Set(newSpeakers as string[]);
                                }

                                // Ajuster la confiance
                                toEntry.confidence = Math.max(toEntry.confidence, 0.75);

                                console.log(`[ODJ] ✅ Moved topic "${topic.title.slice(0, 40)}..." from ${correction.from} to ${correction.to}`);
                                console.log(`[ODJ]    Reason: ${correction.reason}`);
                            }
                        }
                    }
                } else if (correction.action === 'add') {
                    // Ajouter un topic manquant
                    const toEntry = mergedMap.get(correction.to);
                    const topic = allTopics[correction.topicIndex - 1];

                    if (toEntry && topic && topic.description) {
                        toEntry.transcriptSegments.push(topic.description);
                        if (topic.speakers) {
                            const newSpeakers = Array.from(new Set([...toEntry.speakers, ...topic.speakers]));
                            toEntry.speakers = new Set(newSpeakers as string[]);
                        }
                        toEntry.confidence = Math.max(toEntry.confidence, 0.7);

                        console.log(`[ODJ] ✅ Added topic "${topic.title.slice(0, 40)}..." to ${correction.to}`);
                    }
                }
            }

            // Recalculer la coverage et mappedItems après corrections
            // Note: we need to update mappedItems and coveragePercent variables which are returned below
            // However, mappedItems is const and defined above.
            // We should ideally rebuild mappedItems or modify the array content. 
            // Since mergedMap is the source of truth, we can re-generate mappedItems list.

            const agendaItemsList = config.meeting.agendaItems || [];
            const correctedMapped = Array.from(mergedMap.values()).filter(entry =>
                entry.transcriptSegments.some((seg: string) => seg.length > 50)
            ).length;

            const newCoverage = (correctedMapped / agendaItemsList.length) * 100;
            console.log(`[ODJ] 📊 Coverage après refinement: ${newCoverage.toFixed(1)}%`);

            // RE-GENERATE mappedItems from mergedMap to reflect changes
            mappedItems.length = 0; // Clear array
            const newMappedItems = Array.from(mergedMap.values())
                .filter(entry => entry.transcriptSegments.length > 0)
                .map(entry => ({
                    odjItemId: entry.odjItemId,
                    odjTitle: entry.odjTitle,
                    odjOrder: entry.odjOrder,
                    transcriptSegments: entry.transcriptSegments,
                    speakers: Array.from(entry.speakers) as string[],
                    confidence: entry.confidence
                }))
                .sort((a, b) => a.odjOrder - b.odjOrder);
            mappedItems.push(...newMappedItems);
        }
    }

    return {
        mappedItems,
        unmappedSegments: finalUnmappedSegments,
        coveragePercent
    };
};

// ============================================================================
// Step 5: CLASSIFICATION — Thematic categorization + sentiment
// ============================================================================

export const runClassificationStep = async (
    config: AgentConfig,
    odjAnalysis: ODJAnalysisResult,
    onProgress?: (msg: string, pct?: number) => void
): Promise<ClassificationResult> => {
    const prompt = getClassificationPrompt(config.meeting, odjAnalysis);

    onProgress?.('Analyse thématique et extraction des sentiments...', 20);

    // Retry logic for classification too
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const { text: rawResult } = await generateTextWithFallback({
                primaryProvider: 'groq',
                primaryModel: 'llama-3.3-70b-versatile',
                fallbackProvider: 'google',
                fallbackModel: 'gemini-2.5-flash',
                prompt,
                temperature: attempt === 1 ? 0.3 : 0.1,
            });

            console.log(`[Classif] Raw LLM response length: ${rawResult.length} chars`);
            let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/gi, '');
            console.log(`[Classif] After <think> removal: ${cleaned.length} chars`);
            cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end >= start) {
                cleaned = cleaned.substring(start, end + 1);
            } else {
                throw new Error("No JSON boundaries found in classification response");
            }

            let parsed: any;
            try {
                parsed = JSON5.parse(cleaned);
            } catch {
                console.warn(`[Classif] JSON5 parse failed on attempt ${attempt}, repairing...`);
                parsed = JSON5.parse(repairJSON(cleaned));
            }

            return {
                items: parsed.items || [],
                globalThemes: parsed.globalThemes || [],
                globalSentiment: parsed.globalSentiment || 'neutral',
            };
        } catch (e) {
            console.error(`[Classif] Failed attempt ${attempt}:`, e);
            if (attempt === maxAttempts) throw e;
        }
    }

    throw new Error("Classification failed after retries");
};

// ============================================================================
// Step 6: RÉDACTION — Generate PV draft
// ============================================================================

export const runDraftingStep = async (
    config: AgentConfig,
    odjAnalysis: ODJAnalysisResult,
    classification: ClassificationResult,
    cleaning: CleaningResult,
    numbering: CCENumbering,
    onProgress?: (msg: string, pct?: number) => void
): Promise<DraftingResult> => {
    // Use Cloud Function for Claude (server-side API key)
    onProgress?.("Analyse du contexte pour la rédaction (Claude)...", 10);
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
    console.log(`[Drafting] Cloud function returned draft of length ${data.content.length}`);
    onProgress?.("Extraction des éléments structurés du brouillon...", 80);
    const extractionResult = await extractStructuredData(data.content, numbering);
    console.log(`[Drafting] Extracted ${extractionResult.resolutions.length} resolutions and ${extractionResult.comments.length} comments.`);

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
    const prompt = getDraftingExtractionPrompt(pvContent, numbering);

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const { text: rawResult } = await generateTextWithFallback({
                primaryProvider: 'groq',
                primaryModel: 'llama-3.3-70b-versatile',
                fallbackProvider: 'google',
                fallbackModel: 'gemini-2.5-flash',
                prompt,
                temperature: 0.1,
            });

            console.log(`[Drafting] Raw extraction response length: ${rawResult.length} chars`);
            let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/gi, '');
            cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end >= start) {
                cleaned = cleaned.substring(start, end + 1);
            } else {
                throw new Error("No JSON boundaries found in drafting extraction response");
            }

            try {
                // Use JSON5 which is much more lenient with trailing commas, unescaped newlines, etc.
                const parsed = JSON5.parse(cleaned);
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
            } catch (parseError) {
                console.warn(`[Drafting] JSON5 parse failed on attempt ${attempt}, repairing...`);
                // Auto-repair: Escape unescaped quotes within string values
                let repaired = cleaned.replace(/(?<=[a-zA-Z0-9À-ÿ\s])"(?=[a-zA-Z0-9À-ÿ\s])/g, '\\"');

                // Auto-repair: Replace literal newlines within strings with \n
                repaired = repaired.replace(/[\n\r]+/g, ' ');

                const parsed = JSON5.parse(repaired);
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
            }

        } catch (e) {
            console.error(`[Drafting] Failed to extract structured data (attempt ${attempt}):`, e);
            if (attempt === maxAttempts) {
                console.error('[Drafting] Max attempts reached, returning minimal structure.');
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
        }
    }

    // Fallback
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
};

// ============================================================================
// Step 7: RÉFLEXION — Self-critique + auto-corrections (loop)
// ============================================================================

export const runReflectionStep = async (
    config: AgentConfig,
    drafting: DraftingResult,
    cleaning: CleaningResult,
    maxIterations: number = 3,
    onProgress?: (msg: string, pct?: number) => void
): Promise<ReflectionResult> => {
    const iterations: ReflectionResult['iterations'] = [];
    let currentContent = drafting.pvContent;
    let totalIssuesFound = 0;
    let totalIssuesFixed = 0;
    let qualityScore = 0;
    const previousIssuesSummary: string[] = [];

    for (let i = 1; i <= maxIterations; i++) {
        config.onProgress?.('reflection', Math.round((i / maxIterations) * 100));
        onProgress?.(`Itération ${i}/${maxIterations} - Analyse par Claude AI...`, Math.round((i / maxIterations) * 100));

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
            if (start !== -1 && end !== -1 && end >= start) {
                cleaned = cleaned.substring(start, end + 1);
            } else {
                throw new Error("No JSON boundaries found in reflection response");
            }

            let parsed: any;
            try {
                parsed = JSON5.parse(cleaned);
            } catch (e) {
                console.warn(`[Reflection] JSON5 parse failed on iteration ${i}, attempting repair...`);
                parsed = JSON5.parse(repairJSON(cleaned));
            }

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
    meetingNumber: number,
    onProgress?: (msg: string, pct?: number) => void
): Promise<ComparisonResult> => {
    // 1. Fetch historical PVs from Firestore
    onProgress?.("Recherche des PVs historiques pour comparaison...", 10);
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
        if (start !== -1 && end !== -1 && end >= start) {
            cleaned = cleaned.substring(start, end + 1);
        } else {
            throw new Error("No JSON boundaries found in comparison response");
        }

        let parsed: any;
        try {
            parsed = JSON5.parse(cleaned);
        } catch (e) {
            console.warn(`[Comparison] JSON5 parse failed, attempting repair...`);
            parsed = JSON5.parse(repairJSON(cleaned));
        }

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
// Step 8.5: RÉVISION FINALE — Apply user comments
// ============================================================================

export const runUserRevisionStep = async (
    currentPVContent: string,
    userComments: string
): Promise<UserRevisionResult> => {
    try {
        const chatClaude = httpsCallable(functions, 'chat_claude', { timeout: 540000 });
        const userMessage = getUserRevisionPrompt(currentPVContent, userComments);
        const systemPrompt = "Tu es un secrétaire municipal expert. Ton unique tâche est de réviser un procès-verbal en te basant STRICTEMENT sur les commentaires de l'utilisateur. Tu dois répondre UNIQUEMENT en format JSON valide.";

        const response = await chatClaude({ systemPrompt, userMessage });
        const responseData = response.data as { success: boolean; content: string };

        if (!responseData.success || !responseData.content) {
            throw new Error('Échec de la révision utilisateur par Claude');
        }

        // Clean markdown JSON formatting if necessary
        let cleaned = responseData.content.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();

        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end >= start) {
            cleaned = cleaned.substring(start, end + 1);
        } else {
            throw new Error("No JSON boundaries found in user revision response");
        }

        let parsed: any;
        try {
            parsed = JSON5.parse(cleaned);
        } catch (e) {
            console.warn(`[UserRevision] JSON5 parse failed, attempting repair...`);
            parsed = JSON5.parse(repairJSON(cleaned));
        }

        if (parsed && typeof parsed === 'object' && parsed.finalContent) {
            return {
                finalContent: parsed.finalContent,
                qualityScore: parsed.qualityScore || 90,
            };
        }

        throw new Error("Invalid response format from Claude for user revision: finalContent missing.");
    } catch (e) {
        console.error('Failed to run user revision step:', e);
        throw e;
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

    const createOnProgress = (stepId: AgentStepId) => (msg: string, pct?: number) => {
        currentState = updateStepStatus(currentState, stepId, 'running', msg);
        if (pct !== undefined) {
            currentState.steps = currentState.steps.map(s => s.id === stepId ? { ...s, progress: pct } : s);
        }
        if (config.onProgress) {
            config.onProgress(stepId, pct ?? 0, msg);
        }
        onStateChange(currentState);
    };

    const numbering: CCENumbering = {
        assemblyNumber: currentState.meetingNumber,
        nextResolution: 1,
        nextComment: 'A',
    };

    const maxReflectionIterations = config.maxReflectionIterations ?? 3;

    try {
        const isStepDone = (stepId: AgentStepId) => {
            const step = currentState.steps.find(s => s.id === stepId);
            return step && (step.status === 'completed' || step.status === 'skipped') && currentState.results[stepId] !== undefined;
        };

        // ================================================================
        // STEP 1: TRANSCRIPTION
        // ================================================================
        if (isStepDone('transcription')) {
            console.log("[PVAgent] Resuming: skipping Transcription step as it is already completed");
        } else if (config.skipTranscription && config.existingTranscription) {
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
        if (isStepDone('identification')) {
            console.log("[PVAgent] Resuming: skipping Speaker Identification step as it is already completed");
        } else if (config.skipIdentification) {
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
        if (isStepDone('cleaning')) {
            console.log("[PVAgent] Resuming: skipping Cleaning step as it is already completed");
        } else {
            currentState = updateStepStatus(currentState, 'cleaning', 'running');
            onStateChange(currentState);

            const cleaning = await runCleaningStep(config, transcriptionResult, identificationResult);

            currentState = updateStepResult(currentState, 'cleaning', cleaning, 'completed');
            onStateChange(currentState);
        }

        const cleaning = currentState.results.cleaning!;

        // ================================================================
        // STEP 4: ANALYSE ODJ
        // ================================================================
        if (isStepDone('odj_analysis')) {
            console.log("[PVAgent] Resuming: skipping ODJ Analysis step as it is already completed");
        } else {
            currentState = updateStepStatus(currentState, 'odj_analysis', 'running');
            onStateChange(currentState);

            const odjAnalysis = await runODJAnalysisStep(config, cleaning, createOnProgress('odj_analysis'));

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
        }

        const finalODJAnalysis = currentState.results.odj_analysis!;

        // ================================================================
        // STEP 5: CLASSIFICATION
        // ================================================================
        if (isStepDone('classification')) {
            console.log("[PVAgent] Resuming: skipping Classification step as it is already completed");
        } else {
            currentState = updateStepStatus(currentState, 'classification', 'running');
            onStateChange(currentState);

            const classification = await runClassificationStep(config, finalODJAnalysis, createOnProgress('classification'));

            currentState = updateStepResult(currentState, 'classification', classification, 'completed');
            onStateChange(currentState);
        }

        const classification = currentState.results.classification!;

        // ================================================================
        // STEP 6: RÉDACTION
        // ================================================================
        if (isStepDone('drafting')) {
            console.log("[PVAgent] Resuming: skipping Drafting step as it is already completed");
        } else {
            currentState = updateStepStatus(currentState, 'drafting', 'running');
            onStateChange(currentState);

            const drafting = await runDraftingStep(
                config,
                finalODJAnalysis,
                classification,
                cleaning,
                numbering,
                createOnProgress('drafting')
            );

            currentState = updateStepResult(currentState, 'drafting', drafting, 'completed');
            onStateChange(currentState);
        }

        const drafting = currentState.results.drafting!;

        // ================================================================
        // STEP 7: RÉFLEXION (loop)
        // ================================================================
        if (isStepDone('reflection')) {
            console.log("[PVAgent] Resuming: skipping Reflection step as it is already completed");
        } else {
            currentState = updateStepStatus(currentState, 'reflection', 'running');
            onStateChange(currentState);

            const reflection = await runReflectionStep(
                config,
                drafting,
                cleaning,
                maxReflectionIterations,
                createOnProgress('reflection')
            );

            currentState = updateStepResult(currentState, 'reflection', reflection, 'completed');
            onStateChange(currentState);
        }

        const reflection = currentState.results.reflection!;

        // ================================================================
        // STEP 8: COMPARAISON (optional)
        // ================================================================
        let comparison: ComparisonResult;

        if (isStepDone('comparison')) {
            console.log("[PVAgent] Resuming: skipping Comparison step as it is already completed");
            comparison = currentState.results.comparison!;
        } else if (config.enableHistoricalComparison !== false) {
            currentState = updateStepStatus(currentState, 'comparison', 'running');
            onStateChange(currentState);

            comparison = await runComparisonStep(
                config,
                reflection.finalContent, // Pass the output of reflection into comparison
                currentState.meetingNumber,
                createOnProgress('comparison')
            );

            currentState = updateStepResult(currentState, 'comparison', comparison, 'completed');
            onStateChange(currentState);
        } else {
            comparison = {
                historicalPVs: [],
                consistencyChecks: [],
                formatScore: 100,
                corrections: [],
                finalContent: reflection.finalContent,
            };
            currentState = updateStepStatus(currentState, 'comparison', 'skipped');
            currentState = updateStepResult(currentState, 'comparison', comparison, 'skipped');
            onStateChange(currentState);
        }

        // ================================================================
        // STEP 9: VALIDATION USER
        // ================================================================
        currentState = updateStepStatus(currentState, 'user_validation', 'awaiting');
        onStateChange(currentState);

        let userValidation: UserValidationResult = {
            approved: true,
            validatedAt: new Date().toISOString(),
        };

        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('user_validation', {
                pvContent: comparison.finalContent,
                qualityScore: reflection.qualityScore,
                formatScore: comparison.formatScore,
                drafting,
                reflection,
                comparison
            });

            if (validationResult === false) {
                throw new Error('PV rejeté par l\'utilisateur');
            }

            if (typeof validationResult === 'object' && validationResult !== null) {
                userValidation = {
                    approved: true,
                    userEdits: (validationResult as any).userEdits, // This holds the final text the user edited/approved
                    userComments: (validationResult as any).userComments,
                    validatedAt: new Date().toISOString(),
                };
            }
        }

        currentState = updateStepResult(currentState, 'user_validation', userValidation, 'completed');
        onStateChange(currentState);

        // ================================================================
        // STEP 9.5: RÉVISION FINALE (User Comments)
        // ================================================================
        let userRevision: UserRevisionResult | undefined;

        if (userValidation.userComments && userValidation.userComments.trim().length > 0) {
            currentState = updateStepStatus(currentState, 'user_revision', 'running');
            onStateChange(currentState);

            // Use the baseline content (either comparison or user manual edits)
            const baselineContent = userValidation.userEdits || comparison.finalContent;

            userRevision = await runUserRevisionStep(
                baselineContent,
                userValidation.userComments
            );

            currentState = updateStepResult(currentState, 'user_revision', userRevision, 'completed');
            onStateChange(currentState);
        } else {
            currentState = updateStepStatus(currentState, 'user_revision', 'skipped');
            onStateChange(currentState);
        }

        // Content is finalized after user validation/revision
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
    status: AgentStep['status'],
    message?: string
): AgentState => ({
    ...state,
    steps: state.steps.map(s => s.id === stepId
        ? { ...s, status, ...(message !== undefined ? { statusMessage: message } : {}) }
        : s),
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