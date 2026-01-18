import transcriptionPrompt from '../../prompts/transcription.md?raw';
import minutesDraftPrompt from '../../prompts/minutes-draft.md?raw';
import draftFinalizePrompt from '../../prompts/draft-finalize.md?raw';
import sanitizePrompt from '../../prompts/sanitize.md?raw';
import actionItemsPrompt from '../../prompts/action-items.md?raw';
import pvAnalysisPrompt from '../../prompts/pv-analysis.md?raw';
import chunkProcessPrompt from '../../prompts/chunk-process.md?raw';
import fusionPrompt from '../../prompts/fusion.md?raw';

/**
 * Registry for all AI prompts.
 * Allows centralized management and template injection.
 */
export const PromptRegistry = {
    transcription: {
        get: () => transcriptionPrompt
    },
    minutesDraft: {
        get: (data: {
            meetingTitle: string;
            meetingDate: string;
            meetingLocation: string;
            attendeesList: string;
            agendaList: string;
            transcription: string;
            historicalContext: string;
        }) => {
            return minutesDraftPrompt
                .replace('{{meetingTitle}}', data.meetingTitle)
                .replace('{{meetingDate}}', data.meetingDate)
                .replace('{{meetingLocation}}', data.meetingLocation)
                .replace('{{attendeesList}}', data.attendeesList)
                .replace('{{agendaList}}', data.agendaList)
                .replace('{{transcription}}', data.transcription)
                .replace('{{historicalContext}}', data.historicalContext);
        }
    },
    draftFinalize: {
        get: (data: { currentDraft: string; userFeedback: string }) => {
            return draftFinalizePrompt
                .replace('{{currentDraft}}', data.currentDraft)
                .replace('{{userFeedback}}', data.userFeedback);
        }
    },
    sanitize: {
        get: (data: { content: string }) => {
            return sanitizePrompt.replace('{{content}}', data.content);
        }
    },
    actionItems: {
        get: (data: {
            meetingTitle: string;
            meetingDate: string;
            meetingType: string;
            generalNotes: string;
            agendaItems: string;
        }) => {
            return actionItemsPrompt
                .replace('{{meetingTitle}}', data.meetingTitle)
                .replace('{{meetingDate}}', data.meetingDate)
                .replace('{{meetingType}}', data.meetingType)
                .replace('{{generalNotes}}', data.generalNotes)
                .replace('{{agendaItems}}', data.agendaItems);
        }
    },
    pvAnalysis: {
        get: (data: { pvText: string }) => {
            return pvAnalysisPrompt.replace('{{pvText}}', data.pvText);
        }
    },
    chunkProcess: {
        get: (data: { meetingTitle: string; agendaList: string; chunkId: number; chunkContent: string }) => {
            return chunkProcessPrompt
                .replace('{{meetingTitle}}', data.meetingTitle)
                .replace('{{agendaList}}', data.agendaList)
                .replace('{{chunkId}}', data.chunkId.toString())
                .replace('{{chunkContent}}', data.chunkContent);
        }
    },
    fusion: {
        get: (data: { meetingTitle: string; meetingDate: string; partialSummaries: string; agendaList: string }) => {
            return fusionPrompt
                .replace('{{meetingTitle}}', data.meetingTitle)
                .replace('{{meetingDate}}', data.meetingDate)
                .replace('{{partialSummaries}}', data.partialSummaries)
                .replace('{{agendaList}}', data.agendaList);
        }
    }
};
