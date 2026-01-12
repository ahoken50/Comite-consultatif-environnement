import { useCallback } from 'react';
import type { AgendaItem } from '../types/meeting.types';
import { useToast } from './useToast';

interface UseTranscriptionProcessorProps {
    localAgendaItems: AgendaItem[];
    meetingDate?: Date | string; // Added for auto-numbering
    setGlobalNotes: (notes: string) => void;
    setLocalAgendaItems: (items: AgendaItem[]) => void;
    setItemDecisions: (decisions: Record<string, string>) => void;
    setHasUnsavedChanges: (hasChanges: boolean) => void;
}

export const useTranscriptionProcessor = ({
    localAgendaItems,
    meetingDate,
    setGlobalNotes,
    setLocalAgendaItems,
    setItemDecisions,
    setHasUnsavedChanges
}: UseTranscriptionProcessorProps) => {
    const { showSuccess, showError } = useToast();

    const handleApplyTranscription = useCallback(async (content: string) => {
        try {
            // Dynamic imports to keep initial bundle small
            const { parseMinutesDraft } = await import('../services/minutesParserService');
            const { matchPVToAgenda } = await import('../services/docxParserService');

            // Pass meetingDate for auto-numbering resolutions and comments
            const { items: parsedItems, intro } = parseMinutesDraft(content, {
                meetingDate,
                autoNumber: true
            });

            // 1. Put Intro text in Global Notes
            if (intro) {
                setGlobalNotes(intro);
            } else if (parsedItems.length === 0) {
                // Fallback: Dump everything if no structure
                setGlobalNotes(content);
                showSuccess('Texte ajouté aux notes générales (Structure non détectée)');
                setHasUnsavedChanges(true);
                return;
            }

            // 2. Map parsed items to Agenda Items
            if (parsedItems.length > 0) {
                const matchMap = matchPVToAgenda(parsedItems, localAgendaItems);

                const updatedItems = localAgendaItems.map(item => {
                    const matched = matchMap.get(item.id);
                    if (matched) {
                        return {
                            ...item,
                            minuteEntries: matched.minuteEntries, // Helper to sync arrays
                            // Legacy
                            minuteType: matched.minuteType,
                            minuteNumber: matched.minuteNumber,
                            decision: matched.decision
                        };
                    }
                    return item;
                });

                setLocalAgendaItems(updatedItems);

                // Sync decisions for UI
                const newDecisions: Record<string, string> = {};
                updatedItems.forEach(item => { // Re-scan updated items for decisions
                    if (item.decision) {
                        newDecisions[item.id] = item.decision;
                    }
                    // Also keep existing decisions for unmatched items if any (though state update replaces them)
                    // The simplest is to rebuild from the updatedItems list as it's the source of truth now for the view
                });

                // Merge with existing decisions just in case? No, rebuild is safer to stay in sync
                setItemDecisions(newDecisions);

                showSuccess(`${matchMap.size} points mis à jour et Introduction appliquée`);
            } else {
                showSuccess('Introduction appliquée (Aucun point matché)');
            }

            setHasUnsavedChanges(true);

        } catch (e) {
            console.error('Error parsing minutes:', e);
            showError("Erreur lors de l'application intelligente");
        }
    }, [localAgendaItems, meetingDate, setGlobalNotes, setLocalAgendaItems, setItemDecisions, setHasUnsavedChanges, showSuccess, showError]);

    return {
        handleApplyTranscription
    };
};
