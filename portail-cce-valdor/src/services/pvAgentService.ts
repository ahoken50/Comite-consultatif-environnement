/**
 * SmartPV Agent Service
 * 
 * Orchestrates the 5-step PV generation workflow using Vercel AI SDK.
 * Provides semi-automatic mode with validation at each step.
 */

// import { createGoogleGenerativeAI } from '@ai-sdk/google'; // Available for future use
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import type {
    AgentConfig,
    AgentState,
    AgentStep,
    AgentStepId,
    TranscriptionResult,
    AnalysisResult,
    ExtractionResult,
    ValidationResult,
    GenerationResult,
    CCENumbering,
} from '../types/pvAgent.types';
import type { AgendaItem, MinuteEntry } from '../types/meeting.types';

// ============================================================================
// AI Provider Configuration
// ============================================================================

// Gemini provider (available for future use)
// const getGemini = () => createGoogleGenerativeAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const getClaude = () => createAnthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
});

const getGroq = () => createGroq({
    apiKey: import.meta.env.VITE_GROQ_API_KEY,
});

// ============================================================================
// Step Definitions
// ============================================================================

export const AGENT_STEPS: Omit<AgentStep, 'status' | 'result' | 'error'>[] = [
    {
        id: 'transcription',
        label: 'Transcription',
        description: 'Conversion de l\'audio en texte avec identification des intervenants',
    },
    {
        id: 'analysis',
        label: 'Analyse de structure',
        description: 'Association des discussions aux points de l\'ordre du jour',
    },
    {
        id: 'extraction',
        label: 'Extraction des résolutions',
        description: 'Identification des résolutions, commentaires et votes',
    },
    {
        id: 'validation',
        label: 'Validation croisée',
        description: 'Vérification de la couverture et cohérence du PV',
    },
    {
        id: 'generation',
        label: 'Génération finale',
        description: 'Production du PV formaté selon le template CCE',
    },
];

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
});

// ============================================================================
// Step 1: Transcription
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
        };
    }

    // If audio file provided, transcribe using existing service
    if (config.audioFile) {
        // Use existing transcription service (Gemini)
        const { transcribeLocalFile } = await import('./geminiService');
        const result = await transcribeLocalFile(config.meeting.id, config.audioFile);

        if (!result.success || !result.transcription) {
            throw new Error(result.error || 'Échec de la transcription');
        }

        return {
            text: result.transcription,
            duration: 0,
            speakers: extractSpeakersFromText(result.transcription, config.members.map(m => m.displayName)),
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
// Step 2: Analysis (Map to ODJ)
// ============================================================================

export const runAnalysisStep = async (
    config: AgentConfig,
    transcription: TranscriptionResult
): Promise<AnalysisResult> => {
    const groq = getGroq();

    const odjTitles = config.meeting.agendaItems?.map((item, i) =>
        `${i + 1}. ${item.title}`
    ).join('\n') || 'Aucun ordre du jour défini';

    const { text: rawResult } = await generateText({
        model: groq('qwen/qwen3-32b'),
        prompt: `Tu es un expert en analyse de procès-verbaux municipaux.

ORDRE DU JOUR DE LA RÉUNION:
${odjTitles}

TRANSCRIPTION DE LA RÉUNION:
${transcription.text.substring(0, 30000)}

TÂCHE:
Associe chaque segment de la transcription à un point de l'ordre du jour.
Retourne un JSON avec cette structure:
{
  "mappedItems": [
    {
      "odjItemIndex": 0,
      "odjTitle": "Titre du point",
      "transcriptSegment": "Résumé du segment pertinent",
      "confidence": 0.95
    }
  ],
  "unmappedSegments": ["Segments qui ne correspondent à aucun point"]
}

Réponds UNIQUEMENT avec le JSON, sans markdown.`,
        temperature: 0.3,
    });

    try {
        // Clean response (remove <think> block and code fences)
        let cleaned = rawResult.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/```(?:json)?/g, '').replace(/```/g, '');

        // Find JSON object
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
        }

        const parsed = JSON.parse(cleaned);

        return {
            mappedItems: parsed.mappedItems.map((item: any) => ({
                odjItemId: config.meeting.agendaItems?.[item.odjItemIndex]?.id || `odj-${item.odjItemIndex}`,
                odjTitle: item.odjTitle,
                transcriptSegment: item.transcriptSegment,
                confidence: item.confidence,
            })),
            unmappedSegments: parsed.unmappedSegments || [],
        };
    } catch (e) {
        console.error('Failed to parse analysis result:', e);
        throw new Error('Échec de l\'analyse de structure');
    }
};

// ============================================================================
// Step 3: Extraction (Resolutions/Comments)
// ============================================================================

export const runExtractionStep = async (
    _config: AgentConfig,
    transcription: TranscriptionResult,
    _analysis: AnalysisResult,
    numbering: CCENumbering
): Promise<ExtractionResult> => {
    const claude = getClaude();

    const { text: rawResult } = await generateText({
        model: claude('claude-3-5-sonnet-20241022'),
        prompt: `Tu es un rédacteur de procès-verbaux expert pour le Comité Consultatif en Environnement (CCE) de Val-d'Or.

TRANSCRIPTION:
${transcription.text.substring(0, 40000)}

NUMÉROTATION CCE:
- Assemblée #${numbering.assemblyNumber}
- Prochaine résolution: ${numbering.assemblyNumber.toString().padStart(2, '0')}-${numbering.nextResolution.toString().padStart(2, '0')}
- Prochain commentaire: ${numbering.assemblyNumber.toString().padStart(2, '0')}-${numbering.nextComment}

RÈGLES:
- Les RÉSOLUTIONS ont le format XX-NN (ex: 06-25, 06-26)
- Les COMMENTAIRES ont le format XX-L (ex: 06-A, 06-B)
- Chaque résolution doit avoir un proposeur et un secondeur si mentionné
- Identifie les membres PRÉSENTS et ABSENTS

TÂCHE:
Extrais toutes les résolutions et commentaires de la transcription.

FORMAT JSON ATTENDU:
{
  "resolutions": [
    {
      "number": "06-25",
      "content": "Texte de la résolution...",
      "proposer": "M. Ross",
      "seconder": "Mme Boutin"
    }
  ],
  "comments": [
    {
      "number": "06-A",
      "content": "Compte rendu de la discussion..."
    }
  ],
  "attendees": {
    "present": ["M. Ross", "Mme Boutin"],
    "absent": ["M. Ratté"]
  }
}

Réponds UNIQUEMENT avec le JSON.`,
        temperature: 0.2,
    });

    try {
        const parsed = JSON.parse(rawResult.replace(/```json\n?|\n?```/g, ''));
        return parsed as ExtractionResult;
    } catch (e) {
        console.error('Failed to parse extraction result:', e);
        throw new Error('Échec de l\'extraction des résolutions');
    }
};

// ============================================================================
// Step 4: Validation
// ============================================================================

export const runValidationStep = async (
    config: AgentConfig,
    analysis: AnalysisResult,
    extraction: ExtractionResult
): Promise<ValidationResult> => {
    const odjCount = config.meeting.agendaItems?.length || 0;
    const coveredCount = analysis.mappedItems.length;
    const coverage = odjCount > 0 ? (coveredCount / odjCount) * 100 : 100;

    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check coverage
    if (coverage < 100) {
        const missing = odjCount - coveredCount;
        warnings.push(`${missing} point(s) de l'ordre du jour non couvert(s)`);
    }

    // Check resolutions have proposer/seconder
    for (const res of extraction.resolutions) {
        if (!res.proposer) {
            warnings.push(`Résolution ${res.number}: proposeur manquant`);
        }
        if (!res.seconder) {
            warnings.push(`Résolution ${res.number}: secondeur manquant`);
        }
    }

    // Check attendees
    if (extraction.attendees.present.length === 0) {
        warnings.push('Aucun membre présent identifié');
    }

    // Confidence check
    const lowConfidence = analysis.mappedItems.filter(m => m.confidence < 0.7);
    if (lowConfidence.length > 0) {
        suggestions.push(`${lowConfidence.length} association(s) avec faible confiance - vérifiez manuellement`);
    }

    return {
        isValid: warnings.length === 0,
        coverage,
        warnings,
        suggestions,
    };
};

// ============================================================================
// Step 5: Generation
// ============================================================================

export const runGenerationStep = async (
    config: AgentConfig,
    analysis: AnalysisResult,
    extraction: ExtractionResult
): Promise<GenerationResult> => {
    // Map extraction results to agenda items
    const updatedAgendaItems: AgendaItem[] = (config.meeting.agendaItems || []).map(item => {
        const mapped = analysis.mappedItems.find(m => m.odjItemId === item.id);

        if (!mapped) {
            return item;
        }

        // Find resolutions/comments for this item
        const minuteEntries: MinuteEntry[] = [];

        // For simplicity, we'll distribute resolutions/comments to items
        // In production, the AI should specify which resolution belongs to which item

        return {
            ...item,
            decision: mapped.transcriptSegment,
            minuteEntries,
        };
    });

    // Generate global notes (introduction)
    const globalNotes = `Assemblée du Comité Consultatif en Environnement (CCE)

ÉTAIENT PRÉSENTS:
${extraction.attendees.present.join(', ')}

${extraction.attendees.absent.length > 0 ? `ÉTAIENT ABSENTS:\n${extraction.attendees.absent.join(', ')}` : ''}`;

    return {
        agendaItems: updatedAgendaItems,
        globalNotes,
    };
};

// ============================================================================
// Main Orchestrator
// ============================================================================

export const runPVAgent = async (
    config: AgentConfig,
    state: AgentState,
    onStateChange: (state: AgentState) => void
): Promise<AgentState> => {
    let currentState: AgentState = { ...state, startedAt: new Date() };

    const numbering: CCENumbering = {
        assemblyNumber: currentState.meetingNumber,
        nextResolution: 1,
        nextComment: 'A',
    };

    try {
        // Step 1: Transcription
        currentState = updateStepStatus(currentState, 'transcription', 'running');
        onStateChange(currentState);

        const transcription = await runTranscriptionStep(
            config,
            config.existingTranscription || config.meeting.audioRecording?.transcription
        );

        currentState = updateStepResult(currentState, 'transcription', transcription, 'awaiting');
        onStateChange(currentState);

        // Wait for validation (handled by UI)
        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('transcription', transcription);
            if (validationResult === false) throw new Error('Étape annulée par l\'utilisateur');

            // If user modified the result, update it
            if (validationResult !== true && typeof validationResult === 'object') {
                currentState = updateStepResult(currentState, 'transcription', validationResult, 'awaiting');
            }
        }

        currentState = updateStepStatus(currentState, 'transcription', 'completed');
        onStateChange(currentState);

        // Step 2: Analysis
        currentState = updateStepStatus(currentState, 'analysis', 'running');
        onStateChange(currentState);

        const analysis = await runAnalysisStep(config, transcription);

        currentState = updateStepResult(currentState, 'analysis', analysis, 'awaiting');
        onStateChange(currentState);

        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('analysis', analysis);
            if (validationResult === false) throw new Error('Étape annulée par l\'utilisateur');

            // If user modified the result, update it
            if (validationResult !== true && typeof validationResult === 'object') {
                currentState = updateStepResult(currentState, 'analysis', validationResult, 'awaiting');
            }
        }

        currentState = updateStepStatus(currentState, 'analysis', 'completed');
        onStateChange(currentState);

        // Step 3: Extraction
        currentState = updateStepStatus(currentState, 'extraction', 'running');
        onStateChange(currentState);

        const extraction = await runExtractionStep(config, transcription, analysis, numbering);

        currentState = updateStepResult(currentState, 'extraction', extraction, 'awaiting');
        onStateChange(currentState);

        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('extraction', extraction);
            if (validationResult === false) throw new Error('Étape annulée par l\'utilisateur');

            // If user modified the result, update it
            if (validationResult !== true && typeof validationResult === 'object') {
                currentState = updateStepResult(currentState, 'extraction', validationResult, 'awaiting');
            }
        }

        currentState = updateStepStatus(currentState, 'extraction', 'completed');
        onStateChange(currentState);

        // Step 4: Validation
        currentState = updateStepStatus(currentState, 'validation', 'running');
        onStateChange(currentState);

        const validation = await runValidationStep(config, analysis, extraction);

        currentState = updateStepResult(currentState, 'validation', validation, 'awaiting');
        onStateChange(currentState);

        if (config.onValidationRequired) {
            const validationResult = await config.onValidationRequired('validation', validation);
            if (validationResult === false) throw new Error('Étape annulée par l\'utilisateur');

            // If user modified the result, update it
            if (validationResult !== true && typeof validationResult === 'object') {
                currentState = updateStepResult(currentState, 'validation', validationResult, 'awaiting');
            }
        }

        currentState = updateStepStatus(currentState, 'validation', 'completed');
        onStateChange(currentState);

        // Step 5: Generation
        currentState = updateStepStatus(currentState, 'generation', 'running');
        onStateChange(currentState);

        const generation = await runGenerationStep(config, analysis, extraction);

        currentState = updateStepResult(currentState, 'generation', generation, 'completed');
        currentState.completedAt = new Date();
        onStateChange(currentState);

        return currentState;

    } catch (error) {
        const stepId = currentState.steps.find(s => s.status === 'running')?.id;
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
