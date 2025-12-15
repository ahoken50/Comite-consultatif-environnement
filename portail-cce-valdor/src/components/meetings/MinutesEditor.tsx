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
    Snackbar,
    MenuItem
} from '@mui/material';
import { Save, PictureAsPdf, UploadFile, DeleteSweep } from '@mui/icons-material';
import type { Meeting, AgendaItem } from '../../types/meeting.types';
import { generateMinutesPDF } from '../../services/pdfServiceMinutes';
import MinutesImportDialog from './MinutesImportDialog';
import { documentsAPI } from '../../features/documents/documentsAPI';
import { parseAgendaDOCX } from '../../services/docxParserService';

interface MinutesEditorProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

const MinutesEditor: React.FC<MinutesEditorProps> = ({ meeting, onUpdate }) => {
    const [globalNotes, setGlobalNotes] = useState(meeting.minutes || '');
    const [itemDecisions, setItemDecisions] = useState<Record<string, string>>({});
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);

    // Local state for agenda item fields that need to be saved manually
    const [localAgendaItems, setLocalAgendaItems] = useState<AgendaItem[]>(meeting.agendaItems || []);

    const [localFile, setLocalFile] = useState<{
        url: string | null | undefined;
        name: string | null | undefined;
        path: string | null | undefined;
    }>({
        url: meeting.minutesFileUrl ?? null,
        name: meeting.minutesFileName ?? null,
        path: meeting.minutesFileStoragePath ?? null
    });

    // Initialize local state from meeting data
    // Only update agendaItems from meeting if meeting has actual items
    // This prevents data corruption from overwriting local state with empty arrays
    useEffect(() => {
        setGlobalNotes(meeting.minutes || '');

        // Only sync agendaItems if meeting.agendaItems has actual content
        // Don't overwrite with empty array to prevent corruption
        if (meeting.agendaItems && meeting.agendaItems.length > 0) {
            setLocalAgendaItems(meeting.agendaItems);
            const decisions: Record<string, string> = {};
            meeting.agendaItems.forEach(item => {
                decisions[item.id] = item.decision || '';
            });
            setItemDecisions(decisions);
        }
    }, [meeting.id, meeting.minutes, meeting.agendaItems]);

    // Sync local file state if meeting prop updates externally
    // Use strict comparison to handle null/undefined properly
    useEffect(() => {
        const meetingUrl = meeting.minutesFileUrl ?? null;
        const localUrl = localFile.url ?? null;

        if (meetingUrl !== localUrl) {
            setLocalFile({
                url: meeting.minutesFileUrl ?? null,
                name: meeting.minutesFileName ?? null,
                path: meeting.minutesFileStoragePath ?? null
            });
        }
    }, [meeting.minutesFileUrl, meeting.minutesFileName, meeting.minutesFileStoragePath]);

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

    const handleSave = () => {
        // Merge decisions into agenda items
        const updatedAgendaItems = localAgendaItems.map(item => ({
            ...item,
            decision: itemDecisions[item.id] || item.decision || ''
        }));

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
        const meetingForPdf: Meeting = {
            ...meeting,
            minutes: globalNotes,
            agendaItems: localAgendaItems.map(item => ({
                ...item,
                decision: itemDecisions[item.id] || ''
            }))
        };
        generateMinutesPDF(meetingForPdf, globalNotes);
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        try {
            const file = e.target.files[0];

            // Upload file to storage
            const doc = await documentsAPI.upload(
                file,
                meeting.id,
                'meeting',
                'user' // Placeholder
            );

            // Optimistic local update
            setLocalFile({
                url: doc.url,
                name: file.name,
                path: doc.storagePath
            });

            // File upload is saved immediately (auto-save)
            onUpdate({
                minutesFileUrl: doc.url,
                minutesFileName: file.name,
                minutesFileStoragePath: doc.storagePath,
                minutesFileDocumentId: doc.id
            });

            // If it's a DOCX file, automatically parse and extract resolution/comment data
            if (file.name.toLowerCase().endsWith('.docx')) {
                try {
                    console.log('[DEBUG] Parsing DOCX file for agenda items...');
                    const parsedData = await parseAgendaDOCX(file);
                    console.log('[DEBUG] Parsed data:', parsedData);

                    if (parsedData.agendaItems && parsedData.agendaItems.length > 0) {
                        console.log('[DEBUG] Found', parsedData.agendaItems.length, 'agenda items in DOCX');

                        // Map parsed items to existing local agenda items
                        // Match by order/index since the PV items should correspond to agenda items
                        const updatedItems = localAgendaItems.map((item, index) => {
                            // Find matching parsed item by checking if any parsed item has the same index
                            const matchingParsed = parsedData.agendaItems?.find(
                                (p, pIndex) => pIndex === index || p.order === index
                            );

                            if (matchingParsed) {
                                return {
                                    ...item,
                                    minuteType: matchingParsed.minuteType ?? item.minuteType,
                                    minuteNumber: matchingParsed.minuteNumber ?? item.minuteNumber ?? '',
                                    decision: matchingParsed.decision ?? item.decision ?? '',
                                    proposer: matchingParsed.proposer ?? item.proposer ?? '',
                                    seconder: matchingParsed.seconder ?? item.seconder ?? ''
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
                } catch (parseError) {
                    console.warn('[DEBUG] Failed to parse DOCX content:', parseError);
                    // Don't fail the upload if parsing fails - file is already uploaded
                }
            }

        } catch (error) {
            console.error("Upload failed", error);
        }
    };

    const handleDeleteFile = async () => {
        console.log('[DEBUG] handleDeleteFile called');
        console.log('[DEBUG] Current meeting file state:', {
            url: meeting.minutesFileUrl,
            name: meeting.minutesFileName,
            path: meeting.minutesFileStoragePath,
            docId: meeting.minutesFileDocumentId
        });

        // Optimistic update for immediate UI feedback
        setLocalFile({
            url: null,
            name: null,
            path: null
        });

        // Try to delete physical file if IDs are available
        if (meeting.minutesFileDocumentId && meeting.minutesFileStoragePath) {
            try {
                console.log('[DEBUG] Attempting to delete physical file...');
                await documentsAPI.delete(
                    meeting.minutesFileDocumentId,
                    meeting.minutesFileStoragePath
                );
                console.log('[DEBUG] Physical file deleted successfully');
            } catch (e) {
                console.warn('[DEBUG] Failed to delete physical file (may already be deleted):', e);
            }
        } else {
            console.log('[DEBUG] No documentId or storagePath, skipping physical file deletion');
        }

        // ALWAYS unlink from meeting, regardless of whether physical deletion succeeded
        console.log('[DEBUG] Calling onUpdate to clear file references in meeting...');
        try {
            onUpdate({
                minutesFileUrl: null as any,
                minutesFileName: null as any,
                minutesFileStoragePath: null as any,
                minutesFileDocumentId: null as any
            });
            console.log('[DEBUG] onUpdate called successfully');
        } catch (e) {
            console.error('[DEBUG] Error calling onUpdate:', e);
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
                seconder: ''
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
                            onChange={handleFileUpload}
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
                        variant="contained"
                        startIcon={<Save />}
                        onClick={handleSave}
                        disabled={!hasUnsavedChanges}
                    >
                        Enregistrer
                    </Button>
                </Box>
            </Box>

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
                            <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1 }}>
                                <Typography variant="subtitle2" gutterBottom>
                                    {index + 1}. {item.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" paragraph>
                                    {item.objective} - {item.presenter}
                                </Typography>

                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    <Grid size={{ xs: 12, sm: 4 }}>
                                        <TextField
                                            select
                                            fullWidth
                                            label="Type de note"
                                            size="small"
                                            value={item.minuteType || 'other'}
                                            onChange={(e) => handleAgendaItemChange(item.id, 'minuteType', e.target.value)}
                                        >
                                            <MenuItem value="other">Note simple</MenuItem>
                                            <MenuItem value="resolution">Résolution</MenuItem>
                                            <MenuItem value="comment">Commentaire</MenuItem>
                                        </TextField>
                                    </Grid>
                                    <Grid size={{ xs: 12, sm: 4 }}>
                                        <TextField
                                            fullWidth
                                            label="Numéro (ex: 09-35)"
                                            size="small"
                                            value={item.minuteNumber || ''}
                                            onChange={(e) => handleAgendaItemChange(item.id, 'minuteNumber', e.target.value)}
                                        />
                                    </Grid>
                                </Grid>

                                {item.minuteType === 'resolution' && (
                                    <Grid container spacing={2} sx={{ mb: 2 }}>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <TextField
                                                fullWidth
                                                label="Proposé par"
                                                size="small"
                                                value={item.proposer || ''}
                                                onChange={(e) => handleAgendaItemChange(item.id, 'proposer', e.target.value)}
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <TextField
                                                fullWidth
                                                label="Appuyé par"
                                                size="small"
                                                value={item.seconder || ''}
                                                onChange={(e) => handleAgendaItemChange(item.id, 'seconder', e.target.value)}
                                            />
                                        </Grid>
                                    </Grid>
                                )}

                                <TextField
                                    fullWidth
                                    multiline
                                    rows={4}
                                    label="Contenu du PV"
                                    placeholder={item.minuteType === 'resolution' ? "CONSIDÉRANT que...\n\nIL EST RÉSOLU..." : "Saisir le commentaire ou la note..."}
                                    value={itemDecisions[item.id] || ''}
                                    onChange={(e) => handleDecisionChange(item.id, e.target.value)}
                                    variant="outlined"
                                />
                            </Box>
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
