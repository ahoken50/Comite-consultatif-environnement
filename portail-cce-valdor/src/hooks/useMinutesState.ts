import { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import type { Meeting, AgendaItem } from '../types/meeting.types';
import type { RootState } from '../store/rootReducer';
import pvVersioningService from '../services/pvVersioningService';
import { generateNextResolutionNumber } from '../utils/resolutionUtils';
import { useToast } from './useToast';

interface UseMinutesStateProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

export const useMinutesState = ({ meeting, onUpdate }: UseMinutesStateProps) => {
    const { showSuccess, showError } = useToast();
    const user = useSelector((state: RootState) => state.auth.user);
    const userRole = user?.role;

    const [globalNotes, setGlobalNotes] = useState(meeting.minutes || '');
    const [itemDecisions, setItemDecisions] = useState<Record<string, string>>({});
    const [localAgendaItems, setLocalAgendaItems] = useState<AgendaItem[]>(meeting.agendaItems || []);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);

    // Track meeting ID to detect actual navigation vs Firestore echo
    const prevMeetingIdRef = useRef(meeting.id);
    // Track whether we initiated the save (to suppress Firestore echo re-sync)
    const selfSaveRef = useRef(false);

    // Sync state when meeting changes (initial load or navigation to different meeting)
    useEffect(() => {
        // If we initiated the save, skip the re-sync (Firestore echo)
        if (selfSaveRef.current) {
            selfSaveRef.current = false;
            return;
        }

        const isMeetingChange = prevMeetingIdRef.current !== meeting.id;
        prevMeetingIdRef.current = meeting.id;

        if (isMeetingChange) {
            // Full reset — navigated to a different meeting
            setGlobalNotes(meeting.minutes || '');
            // Safety: ensure every item has a stable ID to prevent cloning
            const safeItems = (meeting.agendaItems || []).map(item =>
                item.id ? item : { ...item, id: `item-${Date.now()}-${Math.random().toString(36).slice(2)}` }
            );
            setLocalAgendaItems(safeItems);

            const decisions: Record<string, string> = {};
            meeting.agendaItems?.forEach(item => {
                if (item.decision) decisions[item.id] = item.decision;
            });
            setItemDecisions(decisions);
            setHasUnsavedChanges(false);
        }
        // If same meeting, do NOT overwrite local state — the user is editing
    }, [meeting.id, meeting.minutes, meeting.agendaItems]);

    const handleGlobalNotesChange = useCallback((value: string) => {
        setGlobalNotes(value);
        setHasUnsavedChanges(true);
    }, []);

    const handleAgendaItemChange = useCallback((itemId: string, field: keyof AgendaItem, value: any) => {
        setLocalAgendaItems(prev => prev.map(item =>
            item.id === itemId ? { ...item, [field]: value } : item
        ));
        setHasUnsavedChanges(true);
    }, []);

    const handleMinuteEntryChange = useCallback((itemId: string, entryIndex: number, field: string, value: any) => {
        setLocalAgendaItems(prev => prev.map(item => {
            if (item.id === itemId && item.minuteEntries) {
                const updatedEntries = [...item.minuteEntries];
                updatedEntries[entryIndex] = { ...updatedEntries[entryIndex], [field]: value };
                return { ...item, minuteEntries: updatedEntries };
            }
            return item;
        }));
        setHasUnsavedChanges(true);
    }, []);

    const handleAddMinuteEntry = useCallback((itemId: string) => {
        setLocalAgendaItems(prev => {
            const existingNumbers = prev
                .flatMap(i => i.minuteEntries || [])
                .map(e => e.number || '')
                .filter(n => n !== '');

            const nextNumber = generateNextResolutionNumber(meeting.date, existingNumbers);

            return prev.map(item => {
                if (item.id === itemId) {
                    const entries = item.minuteEntries || [];
                    const newEntry = {
                        type: 'resolution' as const,
                        number: nextNumber,
                        content: ''
                    };
                    return { ...item, minuteEntries: [...entries, newEntry] };
                }
                return item;
            });
        });
        setHasUnsavedChanges(true);
    }, [meeting.date]);

    const handleDeleteMinuteEntry = useCallback((itemId: string, entryIndex: number) => {
        if (window.confirm("Voulez-vous vraiment supprimer cette entrée ?")) {
            setLocalAgendaItems(prev => prev.map(i => {
                if (i.id === itemId) {
                    const newEntries = [...(i.minuteEntries || [])];
                    newEntries.splice(entryIndex, 1);
                    return { ...i, minuteEntries: newEntries };
                }
                return i;
            }));
            setHasUnsavedChanges(true);
        }
    }, []);

    // Unified Save Handler
    const handleSave = useCallback(async (createVersion: boolean = false) => {
        setIsSaving(true);
        try {
            const updatedAgendaItems = localAgendaItems.map(item => {
                const isLegacyMode = !item.minuteEntries || item.minuteEntries.length === 0;
                if (isLegacyMode) {
                    return {
                        ...item,
                        decision: itemDecisions[item.id] || item.decision || '',
                        minuteEntries: []
                    };
                } else {
                    return {
                        ...item,
                        minuteEntries: item.minuteEntries
                    };
                }
            });

            // Flag to suppress re-sync from Firestore echo
            selfSaveRef.current = true;

            onUpdate({
                minutes: globalNotes,
                agendaItems: updatedAgendaItems
            });

            if (createVersion && user) {
                const fullMeetingState: Meeting = {
                    ...meeting,
                    minutes: globalNotes,
                    agendaItems: updatedAgendaItems
                };

                await pvVersioningService.createPVVersion(
                    meeting.id,
                    fullMeetingState,
                    user.id,
                    "Sauvegarde manuelle"
                );
                showSuccess("Version sauvegardée dans l'historique");
            }

            setHasUnsavedChanges(false);
            setLastSaved(new Date());
            if (createVersion) setShowSaveSuccess(true);
        } catch (error) {
            console.error('Save failed:', error);
            showError('Erreur lors de la sauvegarde');
        } finally {
            setIsSaving(false);
        }
    }, [localAgendaItems, itemDecisions, globalNotes, meeting, user, onUpdate, showSuccess, showError]);

    const handleDecisionChange = useCallback((itemId: string, value: string) => {
        setItemDecisions(prev => ({
            ...prev,
            [itemId]: value
        }));
        setHasUnsavedChanges(true);
    }, []);

    // Auto-save effect
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const timer = setTimeout(() => {
            handleSave(false);
        }, 30000);
        return () => clearTimeout(timer);
    }, [hasUnsavedChanges, handleSave]);

    const handleClearAll = useCallback(() => {
        if (!window.confirm('Êtes-vous sûr de vouloir réinitialiser le procès-verbal ?\n\nCette action supprimera toutes les résolutions, commentaires, notes et délibérations importées et remettra les points de l\'ordre du jour à leur état initial.')) return;

        // Restore agenda items to their original ODJ state from Firestore
        const originalItems = (meeting.agendaItems || []).map(item => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { minuteType, ...rest } = item;
            return {
                ...rest,
                minuteNumber: '',
                decision: '',
                description: item.description || '',
                proposer: '',
                seconder: '',
                minuteEntries: []
            };
        });

        setGlobalNotes('');
        setItemDecisions({});
        setLocalAgendaItems(originalItems);
        setHasUnsavedChanges(false);

        // Persist immediately to Firebase so the reset is saved
        selfSaveRef.current = true;
        onUpdate({
            minutes: '',
            agendaItems: originalItems
        });

        showSuccess('Procès-verbal réinitialisé à l\'état initial de l\'ordre du jour');
    }, [meeting.agendaItems, onUpdate, showSuccess]);

    return {
        globalNotes,
        setGlobalNotes,
        localAgendaItems,
        setLocalAgendaItems,
        hasUnsavedChanges,
        setHasUnsavedChanges,
        lastSaved,
        isSaving,
        handleGlobalNotesChange,
        handleAgendaItemChange,
        handleMinuteEntryChange,
        handleAddMinuteEntry,
        handleDeleteMinuteEntry,
        handleSave,
        handleClearAll,
        setItemDecisions,
        itemDecisions,
        showSaveSuccess,
        setShowSaveSuccess,
        handleDecisionChange,
        userRole
    };
};
