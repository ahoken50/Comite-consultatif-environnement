import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    TextField,
    Button,
    Paper,
    Divider,
    Grid,
    Alert,
    Snackbar
} from '@mui/material';
import { Save, PictureAsPdf, UploadFile, DeleteSweep, Shield } from '@mui/icons-material';
import type { Meeting, AgendaItem, AudioRecording, MinutesDraft } from '../../types/meeting.types';
import { generateMinutesPDF } from '../../services/pdfServiceMinutes';
// import { sanitizeMinutes } from '../../services/geminiService'; // Removed in favor of Claude
import MinutesImportDialog from './MinutesImportDialog';
import AudioUpload from './AudioUpload';
import TranscriptionViewer from './TranscriptionViewer';
import AgendaItemEditor from './AgendaItemEditor';
import CrossValidationPanel from './CrossValidationPanel';
import { useMinutesFile } from '../../hooks/useMinutesFile';
import { useToast } from '../../hooks/useToast';
import { generateNextResolutionNumber } from '../../utils/resolutionUtils';
import { useTranscriptionProcessor } from '../../hooks/useTranscriptionProcessor';
// Note: parseAgendaDOCX is imported dynamically when needed

interface MinutesEditorProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

const MinutesEditor: React.FC<MinutesEditorProps> = ({ meeting, onUpdate }) => {
    const { showSuccess, showError } = useToast();
    const [globalNotes, setGlobalNotes] = useState(meeting.minutes || '');
    const [itemDecisions, setItemDecisions] = useState<Record<string, string>>({});
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);

    // Local state for agenda item fields that need to be saved manually
    const [localAgendaItems, setLocalAgendaItems] = useState<AgendaItem[]>(meeting.agendaItems || []);
    // Use custom hook for file management
    const { localFile, handleFileUpload: uploadFile, handleDeleteFile } = useMinutesFile({
        meeting,
        onUpdate
    });
    // Use custom hook for transcription processing
    const { handleApplyTranscription } = useTranscriptionProcessor({
        localAgendaItems,
        setGlobalNotes,
        setLocalAgendaItems,
        setItemDecisions,
        setHasUnsavedChanges
    });
    // Sync state when meeting changes
    useEffect(() => {
        setGlobalNotes(meeting.minutes || '');
        setLocalAgendaItems(meeting.agendaItems || []);

        // Populate decision map from existing items
        const decisions: Record<string, string> = {};
        meeting.agendaItems?.forEach(item => {
            if (item.decision) {
                decisions[item.id] = item.decision;
            }
        });
        setItemDecisions(decisions);

        setHasUnsavedChanges(false);
    }, [meeting.id, meeting.minutes, meeting.agendaItems]);

    const handleGlobalNotesChange = (value: string) => {
        setGlobalNotes(value);
        setHasUnsavedChanges(true);
    };

    const handleDecisionChange = (itemId: string, value: string) => {
        setItemDecisions(prev => ({
            ...prev,
            [itemId]: value
        }));
        setHasUnsavedChanges(true);
    };

    // Handler for agenda item field changes (now stored locally until save)
    const handleAgendaItemChange = (itemId: string, field: keyof AgendaItem, value: any) => {
        setLocalAgendaItems(prev => prev.map(item =>
            item.id === itemId ? { ...item, [field]: value } : item
        ));
        setHasUnsavedChanges(true);
    };

    // Handler for editing a specific minuteEntry
    const handleMinuteEntryChange = (itemId: string, entryIndex: number, field: string, value: any) => {
        setLocalAgendaItems(prev => prev.map(item => {
            if (item.id === itemId && item.minuteEntries) {
                const updatedEntries = [...item.minuteEntries];
                updatedEntries[entryIndex] = { ...updatedEntries[entryIndex], [field]: value };
                return { ...item, minuteEntries: updatedEntries };
            }
            return item;
        }));
        setHasUnsavedChanges(true);
    };

    // Handler for adding a new minuteEntry
    const handleAddMinuteEntry = (itemId: string) => {
        setLocalAgendaItems(prev => {
            // Calculate next resolution number based on all existing entries in the meeting
            const existingNumbers = prev
                .flatMap(i => i.minuteEntries || [])
                .map(e => e.number || '')
                .filter(n => n !== '');

            const nextNumber = generateNextResolutionNumber(meeting.date, existingNumbers);

            return prev.map(item => {
                if (item.id === itemId) {
                    const entries = item.minuteEntries || [];
                    const newEntry = {
                        type: 'resolution' as const, // Default to resolution for convenience
                        number: nextNumber,
                        content: ''
                    };
                    return { ...item, minuteEntries: [...entries, newEntry] };
                }
                return item;
            });
        });
        setHasUnsavedChanges(true);
    };

    const handleSave = () => {
        // Save agenda items
        const updatedAgendaItems = localAgendaItems.map(item => {
            // Check if we are in 'Legacy/Simple' mode for this item (no structured entries)
            const isLegacyMode = !item.minuteEntries || item.minuteEntries.length === 0;

            if (isLegacyMode) {
                // In legacy mode, we SAVE the decision field from the tracked state
                // In legacy mode, we SAVE the decision field from the tracked state
                // This ensures manual edits to the "Contenu du PV" box are saved
                return {
                    ...item,
                    decision: itemDecisions[item.id] || item.decision || '',
                    minuteEntries: []
                };
            } else {
                // In structured mode (Parsed PV), we PRESERVE the ODJ decision field (don't overwrite with empty)
                // and save the structured minuteEntries (Resolutions/Comments)
                return {
                    ...item,
                    minuteEntries: item.minuteEntries
                    // decision is kept as-is (from ODJ)
                };
            }
        });

        console.log('[DEBUG] handleSave called');
        console.log('[DEBUG] globalNotes:', globalNotes);
        console.log('[DEBUG] First agenda item after merge:', updatedAgendaItems[0]);

        onUpdate({
            minutes: globalNotes,
            agendaItems: updatedAgendaItems
        });

        setHasUnsavedChanges(false);
        setShowSaveSuccess(true);
    };

    const handleGeneratePDF = () => {
        // Create a temporary meeting object with current state
        // Use localAgendaItems directly without overwriting decision
        const meetingForPdf: Meeting = {
            ...meeting,
            minutes: globalNotes,
            agendaItems: localAgendaItems
        };
        generateMinutesPDF(meetingForPdf, globalNotes);
    };

    const handleSanitize = async () => {
        // Validation: Check if there is content to anonymize
        if (!globalNotes && (!localAgendaItems || localAgendaItems.length === 0)) {
            showError('Aucun contenu à anonymiser.');
            return;
        }

        if (!window.confirm("Cette action va générer un fichier PDF contenant une version anonymisée du procès-verbal (Noms masqués, adresses simplifiées).\n\nNOTE : Votre brouillon actuel ne sera PAS modifié. Le PDF s'ouvrira dans une nouvelle fenêtre.\n\nContinuer ?")) return;

        // Open window immediately to satisfy browser popup blockers
        const printWindow = window.open('', '_blank', 'width=816,height=1056');
        if (printWindow) {
            printWindow.document.write('<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column;">' +
                '<h2>Génération du PDF Anonymisé en cours...</h2>' +
                '<p>Veuillez patienter pendant que l\'IA traite le document (15-30 secondes).</p>' +
                '<div style="width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>' +
                '<style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>' +
                '</body></html>');
            printWindow.document.close();
        } else {
            showError("Veuillez autoriser les pop-ups pour voir le PDF.");
            return;
        }

        try {
            // 1. Prepare the meeting data exactly as it would be saved (Merging local state)
            const updatedAgendaItems = localAgendaItems.map(item => {
                const isLegacyMode = !item.minuteEntries || item.minuteEntries.length === 0;
                if (isLegacyMode) {
                    return {
                        ...item,
                        decision: itemDecisions[item.id] || item.decision || '',
                        minuteEntries: []
                    };
                } else {
                    return { ...item, minuteEntries: item.minuteEntries };
                }
            });

            const meetingSnapshot: Meeting = {
                ...meeting,
                minutes: globalNotes,
                agendaItems: updatedAgendaItems
            };

            showSuccess('Anonymisation en cours via Claude...');

            // Dynamically import
            const { sanitizeMeetingClaude } = await import('../../services/claudeService');

            // 2. Call AI
            const result = await sanitizeMeetingClaude(meetingSnapshot);

            if (result.success && result.sanitizedMeeting) {
                // 3. Generate PDF with the SANITIZED object, using the existing window
                await generateMinutesPDF(result.sanitizedMeeting, result.sanitizedMeeting.minutes, printWindow);
                showSuccess('PDF Anonymisé généré !');
            } else {
                if (printWindow) printWindow.close();
                showError("Erreur lors de l'anonymisation: " + (result.error || 'Inconnue'));
            }
        } catch (error) {
            console.error('Sanitization failed:', error);
            if (printWindow) printWindow.close();
            showError("Erreur technique lors de l'appel IA");
        }
    };

    const handleImport = (parsedItems: Partial<AgendaItem>[]) => {
        const newItems = [...localAgendaItems];
        let parseIndex = 0;

        // Map parsed items to agenda items sequentially
        const updatedItems = newItems.map((item) => {
            if (parseIndex < parsedItems.length) {
                const parsed = parsedItems[parseIndex];
                parseIndex++;
                // Use fallbacks to prevent undefined values (Firestore rejects undefined)
                return {
                    ...item,
                    minuteType: parsed.minuteType ?? item.minuteType,
                    minuteNumber: parsed.minuteNumber ?? item.minuteNumber ?? '',
                    decision: parsed.decision ?? item.decision ?? '',
                    proposer: parsed.proposer ?? item.proposer ?? '',
                    seconder: parsed.seconder ?? item.seconder ?? ''
                };
            }
            return item;
        });

        // Update local state
        setLocalAgendaItems(updatedItems);
        const newDecisions = { ...itemDecisions };
        updatedItems.forEach(item => {
            if (item.decision) {
                newDecisions[item.id] = item.decision;
            }
        });
        setItemDecisions(newDecisions);
        setHasUnsavedChanges(true);
    };

    // Wrapper for file upload including DOCX parsing logic
    const handleFileUploadWrapper = async (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
            const file = await uploadFile(e);
            if (!file) return;

            // If it's a DOCX file, automatically parse and extract resolution/comment data
            if (file.name.toLowerCase().endsWith('.docx')) {
                try {
                    console.log('[DEBUG] Parsing DOCX file for agenda items...');
                    const { parseAgendaDOCX: parseDocx, matchPVToAgenda } = await import('../../services/docxParserService');
                    const parsedData = await parseDocx(file);
                    console.log('[DEBUG] Parsed data:', parsedData);

                    if (parsedData.agendaItems && parsedData.agendaItems.length > 0) {
                        console.log('[DEBUG] Found', parsedData.agendaItems.length, 'agenda items in DOCX');

                        // If meeting has no agenda items, CREATE new ones from parsed data
                        if (localAgendaItems.length === 0) {
                            console.log('[DEBUG] Meeting has no agenda items - creating from parsed DOCX');

                            // Create new agenda items from parsed data
                            const newAgendaItems: AgendaItem[] = parsedData.agendaItems.map((parsed, index) => ({
                                id: `agenda-${Date.now()}-${index}`,
                                order: index + 1,
                                title: parsed.title || `Point ${index + 1}`,
                                description: '',
                                duration: 10,
                                presenter: '',
                                objective: 'Information',
                                decision: parsed.decision || '',
                                minuteType: parsed.minuteType,
                                minuteNumber: parsed.minuteNumber || '',
                                proposer: parsed.proposer || '',
                                seconder: parsed.seconder || '',
                                minuteEntries: parsed.minuteEntries || []
                            }));

                            setLocalAgendaItems(newAgendaItems);

                            // Update item decisions state
                            const newDecisions: Record<string, string> = {};
                            newAgendaItems.forEach(item => {
                                if (item.decision) {
                                    newDecisions[item.id] = item.decision;
                                }
                            });
                            setItemDecisions(newDecisions);
                            setHasUnsavedChanges(true);

                            // Also save to Firebase immediately
                            onUpdate({ agendaItems: newAgendaItems });

                            console.log('[DEBUG] Created', newAgendaItems.length, 'new agenda items from DOCX');
                        } else {
                            // Use title-based matching instead of just index
                            const matchMap = matchPVToAgenda(parsedData.agendaItems, localAgendaItems);
                            console.log('[DEBUG] Matched', matchMap.size, 'items by title similarity');

                            // Update items that have a match
                            const updatedItems = localAgendaItems.map((item) => {
                                const matchedPV = matchMap.get(item.id);

                                if (matchedPV) {
                                    return {
                                        ...item,
                                        // NEW: Copy all minute entries (resolutions + comments)
                                        minuteEntries: matchedPV.minuteEntries ?? item.minuteEntries,
                                        // Legacy fields (kept for backward compatibility)
                                        minuteType: matchedPV.minuteType ?? item.minuteType,
                                        minuteNumber: matchedPV.minuteNumber ?? item.minuteNumber ?? '',
                                        decision: matchedPV.decision ?? item.decision ?? '',
                                        proposer: matchedPV.proposer ?? item.proposer ?? '',
                                        seconder: matchedPV.seconder ?? item.seconder ?? ''
                                    };
                                }
                                return item;
                            });

                            setLocalAgendaItems(updatedItems);

                            // Update item decisions state
                            const newDecisions = { ...itemDecisions };
                            updatedItems.forEach(item => {
                                if (item.decision) {
                                    newDecisions[item.id] = item.decision;
                                }
                            });
                            setItemDecisions(newDecisions);
                            setHasUnsavedChanges(true);

                            console.log('[DEBUG] Updated local agenda items with parsed data');
                        }
                    }

                    // Also update attendees if parsed from DOCX
                    if (parsedData.attendees && parsedData.attendees.length > 0) {
                        console.log('[DEBUG] Found', parsedData.attendees.length, 'attendees in DOCX');
                        // Update meeting with parsed attendees
                        onUpdate({
                            attendees: parsedData.attendees
                        });
                        console.log('[DEBUG] Updated meeting attendees from parsed data');
                    }
                } catch (parseError) {
                    console.warn('[DEBUG] Failed to parse DOCX content:', parseError);
                    // Don't fail the upload if parsing fails - file is already uploaded
                }
            }

        } catch (error) {
            console.error("Upload process failed", error);
        }
    };


    const handleClearAll = () => {
        if (!window.confirm('Êtes-vous sûr de vouloir effacer tout le contenu du procès-verbal ? Cette action ne peut pas être annulée.')) {
            return;
        }

        console.log('[DEBUG] handleClearAll called - clearing all PV content');

        // Clear global notes
        setGlobalNotes('');

        // Clear all decisions
        setItemDecisions({});

        // Reset agenda items minute fields
        // IMPORTANT: Firestore does NOT accept undefined values
        // We must exclude minuteType entirely (destructure it out) rather than setting it to undefined
        setLocalAgendaItems(prev => prev.map(item => {
            // Destructure to remove minuteType from the item
            const { minuteType, ...itemWithoutMinuteType } = item;
            return {
                ...itemWithoutMinuteType,
                minuteNumber: '',
                decision: '',
                proposer: '',
                seconder: '',
                minuteEntries: [] // Also clear imported entries
            };
        }));

        console.log('[DEBUG] Local state cleared, hasUnsavedChanges set to true');
        setHasUnsavedChanges(true);
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6">Rédaction du Procès-Verbal</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                        variant="outlined"
                        component="label"
                        startIcon={<UploadFile />}
                    >
                        Téléverser PV Signé (PDF/DOCX)
                        <input
                            type="file"
                            hidden
                            accept=".pdf,.docx,.doc"
                            onChange={handleFileUploadWrapper}
                        />
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<UploadFile />}
                        onClick={() => setIsImportOpen(true)}
                    >
                        Importer Texte
                    </Button>
                    <Button
                        variant="outlined"
                        color="error"
                        startIcon={<DeleteSweep />}
                        onClick={handleClearAll}
                    >
                        Réinitialiser
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<PictureAsPdf />}
                        onClick={handleGeneratePDF}
                    >
                        Générer PDF
                    </Button>
                    <Button
                        variant="outlined"
                        color="secondary"
                        startIcon={<Shield />}
                        onClick={handleSanitize}
                        disabled={!globalNotes && (!localAgendaItems || localAgendaItems.length === 0)}
                        title="Générer un PDF anonymisé via IA (ne modifie pas le brouillon)"
                    >
                        PDF Anonymisé (IA)
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<Save />}
                        onClick={handleSave}
                        disabled={!hasUnsavedChanges}
                    >
                        Enregistrer
                    </Button>
                </Box>
            </Box>

            {/* Section Transcription IA */}
            <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    🎤 Transcription IA (Beta)
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                    Importez un enregistrement audio/vidéo de l'assemblée pour générer automatiquement un brouillon de procès-verbal.
                </Typography>
                <AudioUpload
                    meetingId={meeting.id}
                    audioRecording={meeting.audioRecording}
                    onUploadComplete={(recording: AudioRecording) => {
                        onUpdate({ audioRecording: recording });
                    }}
                    onDelete={() => {
                        onUpdate({ audioRecording: undefined as any });
                    }}
                    onTranscriptionComplete={() => {
                        // Force refresh by toggling a state or calling parent
                        console.log('Transcription complete, refresh meeting data!');
                    }}
                />

                {/* Transcription Viewer and Draft Generator */}
                {meeting.audioRecording?.transcription && (


                    // ... inside return ...

                    {/* Transcription Viewer and Draft Generator */ }
                {meeting.audioRecording?.transcription && (
                    <TranscriptionViewer
                        meeting={meeting}
                        onDraftGenerated={(draft: MinutesDraft) => {
                            onUpdate({ minutesDraft: draft });
                        }}
                        onApplyToMinutes={handleApplyTranscription}
                        onTranscriptionUpdate={(newTranscription: string) => {
                            if (meeting.audioRecording) {
                                onUpdate({
                                    audioRecording: {
                                        ...meeting.audioRecording,
                                        transcription: newTranscription
                                    }
                                });
                            }
                        }}
                    />
                )}
            </Paper>

            {(localFile.url || meeting.minutesFileUrl) && (
                <Alert severity={localFile.url ? "success" : "warning"} sx={{ mb: 3 }} action={
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {localFile.url && (
                            <Button color="inherit" size="small" href={localFile.url} target="_blank">
                                Voir le fichier
                            </Button>
                        )}
                        <Button color="error" size="small" onClick={() => {
                            console.log('[DEBUG] Supprimer button clicked!');
                            handleDeleteFile();
                        }}>
                            Supprimer
                        </Button>
                    </Box>
                }>
                    {localFile.url
                        ? `Fichier joint : ${localFile.name || 'Document'}`
                        : `Référence orpheline : ${meeting.minutesFileName || 'Document supprimé'} (cliquez Supprimer pour nettoyer)`
                    }
                </Alert>
            )}

            <MinutesImportDialog
                open={isImportOpen}
                onClose={() => setIsImportOpen(false)}
                onImport={handleImport}
            />

            {/* Cross Validation Panel - Compare ODJ with PV */}
            {meeting.agendaItems && meeting.agendaItems.length > 0 && localAgendaItems.length > 0 && (
                <CrossValidationPanel
                    odjItems={meeting.agendaItems}
                    pvItems={localAgendaItems}
                    onSync={(missingItems) => {
                        // Add missing items to local agenda
                        const newItems = [...localAgendaItems, ...missingItems];
                        setLocalAgendaItems(newItems);
                        setHasUnsavedChanges(true);
                    }}
                />
            )}

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom fontWeight="bold">Notes Générales / Introduction</Typography>
                <TextField
                    fullWidth
                    multiline
                    rows={4}
                    placeholder="Saisir les notes d'introduction, les présences particulières, etc."
                    value={globalNotes}
                    onChange={(e) => handleGlobalNotesChange(e.target.value)}
                    sx={{ mb: 3 }}
                />

                <Divider sx={{ my: 3 }} />

                <Typography variant="subtitle1" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>Points de l'Ordre du Jour</Typography>

                <Grid container spacing={3}>
                    {localAgendaItems.map((item, index) => (
                        <Grid size={{ xs: 12 }} key={item.id}>
                            <AgendaItemEditor
                                item={item}
                                index={index}
                                itemDecision={itemDecisions[item.id] || ''}
                                onAgendaItemChange={handleAgendaItemChange}
                                onMinuteEntryChange={handleMinuteEntryChange}
                                onAddMinuteEntry={handleAddMinuteEntry}
                                onDecisionChange={handleDecisionChange}
                            />
                        </Grid>
                    ))}
                </Grid>
            </Paper>

            <Snackbar
                open={showSaveSuccess}
                autoHideDuration={3000}
                onClose={() => setShowSaveSuccess(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="success" sx={{ width: '100%' }}>
                    Procès-verbal enregistré avec succès
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MinutesEditor;
