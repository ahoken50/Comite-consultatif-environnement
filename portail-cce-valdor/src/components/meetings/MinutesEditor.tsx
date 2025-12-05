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
import { Save, PictureAsPdf } from '@mui/icons-material';
import type { Meeting } from '../../types/meeting.types';
import { generateMinutesPDF } from '../../services/pdfServiceMinutes';

interface MinutesEditorProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

const MinutesEditor: React.FC<MinutesEditorProps> = ({ meeting, onUpdate }) => {
    const [globalNotes, setGlobalNotes] = useState(meeting.minutes || '');
    const [itemDecisions, setItemDecisions] = useState<Record<string, string>>({});
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);

    // Initialize local state from meeting data
    useEffect(() => {
        setGlobalNotes(meeting.minutes || '');
        const decisions: Record<string, string> = {};
        meeting.agendaItems.forEach(item => {
            decisions[item.id] = item.decision || '';
        });
        setItemDecisions(decisions);
    }, [meeting]);

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

    const handleSave = () => {
        const updatedAgendaItems = meeting.agendaItems.map(item => ({
            ...item,
            decision: itemDecisions[item.id] || ''
        }));

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
            agendaItems: meeting.agendaItems.map(item => ({
                ...item,
                decision: itemDecisions[item.id] || ''
            }))
        };
        generateMinutesPDF(meetingForPdf, globalNotes);
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6">Rédaction du Procès-Verbal</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
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
                    {meeting.agendaItems.map((item, index) => (
                        <Grid size={{ xs: 12 }} key={item.id}>
                            <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1 }}>
                                <Typography variant="subtitle2" gutterBottom>
                                    {index + 1}. {item.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" paragraph>
                                    {item.objective} - {item.presenter}
                                </Typography>
                                <TextField
                                    fullWidth
                                    multiline
                                    rows={3}
                                    label="Décision / Note au PV"
                                    placeholder="Inscrire la décision prise ou le résumé des discussions..."
                                    value={itemDecisions[item.id] || ''}
                                    onChange={(e) => handleDecisionChange(item.id, e.target.value)}
                                    variant="outlined"
                                    size="small"
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
