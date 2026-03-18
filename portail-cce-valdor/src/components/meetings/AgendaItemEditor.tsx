import React from 'react';
import { Box, Grid, TextField, MenuItem, Typography, Button, Switch, FormControlLabel, Checkbox, FormGroup } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Add } from '@mui/icons-material';
import type { AgendaItem } from '../../types/meeting.types';
import MinuteEntryEditor from './MinuteEntryEditor';

interface AgendaItemEditorProps {
    item: AgendaItem;
    index: number;
    itemDecision: string;
    onAgendaItemChange: (itemId: string, field: keyof AgendaItem, value: any) => void;
    onMinuteEntryChange: (itemId: string, entryIndex: number, field: string, value: any) => void;
    onAddMinuteEntry: (itemId: string) => void;
    onDeleteMinuteEntry: (itemId: string, entryIndex: number) => void;
    onDecisionChange: (itemId: string, value: string) => void;
    readOnly?: boolean;
    meetingId?: string;
    meetingDate?: string;
    userRole?: string;
}

/**
 * Editor component for a single agenda item's minutes.
 * Extracted from MinutesEditor to reduce component size.
 */
const AgendaItemEditor: React.FC<AgendaItemEditorProps> = ({
    item,
    index,
    itemDecision,
    onAgendaItemChange,
    onMinuteEntryChange,
    onAddMinuteEntry,
    onDeleteMinuteEntry,
    onDecisionChange,
    readOnly = false,
    meetingId,
    meetingDate,
    userRole
}) => {
    const navigate = useNavigate();
    
    return (
        <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
                {index + 1}. {item.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" paragraph>
                {item.objective} - {item.presenter}
            </Typography>

            {/* Editable minute entries (resolutions + comments) */}
            {item.minuteEntries && item.minuteEntries.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography
                        variant="caption"
                        fontWeight="bold"
                        color="primary"
                        gutterBottom
                        sx={{ display: 'block', mb: 1 }}
                    >
                        {item.minuteEntries.length} entrée(s) du PV :
                    </Typography>
                    {item.minuteEntries.map((entry, entryIndex) => (
                        <MinuteEntryEditor
                            key={entryIndex}
                            entry={entry}
                            entryIndex={entryIndex}
                            itemId={item.id}
                            onChange={onMinuteEntryChange}
                            onDelete={onDeleteMinuteEntry}
                            readOnly={readOnly}
                            itemTitle={item.title}
                            itemDescription={item.description || ''}
                            meetingId={meetingId}
                            meetingDate={meetingDate}
                            userRole={userRole}
                        />
                    ))}
                </Box>
            )}

            {/* Button to add new entry */}
            {!readOnly && (
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Add />}
                    onClick={() => onAddMinuteEntry(item.id)}
                    sx={{ mb: 2 }}
                >
                    Ajouter entrée
                </Button>
            )}

            {/* Recommendation Settings */}
            {item.minuteEntries && item.minuteEntries.length > 0 && (
                <Box sx={{ mt: 3, p: 2, bgcolor: 'warning.50', borderRadius: 1, border: '1px solid', borderColor: 'warning.main' }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={!!item.isRecommendationToCouncil}
                                onChange={(e) => onAgendaItemChange(item.id, 'isRecommendationToCouncil', e.target.checked)}
                                disabled={readOnly}
                                color="warning"
                            />
                        }
                        label={
                            <Typography variant="subtitle2" fontWeight="bold" color="warning.dark">
                                Créer une recommandation au conseil basée sur ce sujet
                            </Typography>
                        }
                    />

                    {item.isRecommendationToCouncil && (
                        <Box sx={{ mt: 2, ml: 2 }}>
                            <Typography variant="body2" gutterBottom color="text.secondary">
                                Sélectionnez les éléments à inclure dans le rapport de recommandation :
                            </Typography>
                            <FormGroup>
                                {item.minuteEntries.map((entry, idx) => {
                                    // If undefined, we assume all are included by default, or none? 
                                    // Let's assume if it's undefined, we start with an empty array or all selected.
                                    const includedSet = new Set(item.councilIncludedEntryIndices || []);
                                    // Let's default to newly checked if we just toggled it, but if user explicitly unchecks, it's removed.
                                    // Actually better: If undefined, all are included.
                                    const isIncluded = item.councilIncludedEntryIndices 
                                        ? includedSet.has(idx) 
                                        : true;

                                    return (
                                        <FormControlLabel
                                            key={idx}
                                            control={
                                                <Checkbox
                                                    checked={isIncluded}
                                                    onChange={(e) => {
                                                        const current = item.councilIncludedEntryIndices 
                                                            ? [...item.councilIncludedEntryIndices] 
                                                            : item.minuteEntries!.map((_, i) => i);
                                                        
                                                        let next;
                                                        if (e.target.checked) {
                                                            next = [...current, idx];
                                                        } else {
                                                            next = current.filter(i => i !== idx);
                                                        }
                                                        onAgendaItemChange(item.id, 'councilIncludedEntryIndices', next);
                                                    }}
                                                    disabled={readOnly}
                                                    size="small"
                                                />
                                            }
                                            label={
                                                <Typography variant="body2" sx={{ 
                                                    whiteSpace: 'nowrap', 
                                                    overflow: 'hidden', 
                                                    textOverflow: 'ellipsis', 
                                                    maxWidth: '500px' 
                                                }}>
                                                    {entry.type === 'resolution' ? 'Résolution' : entry.type === 'comment' ? 'Commentaire' : 'Note'} : {entry.content || '(Vide)'}
                                                </Typography>
                                            }
                                        />
                                    );
                                })}
                            </FormGroup>
                            
                            {!readOnly && (
                                <Button
                                    variant="contained"
                                    color="warning"
                                    size="small"
                                    sx={{ mt: 2 }}
                                    onClick={() => {
                                        if (!meetingId || !meetingDate) {
                                            alert("Erreur: Informations de réunion manquantes");
                                            return;
                                        }

                                        const includedSet = new Set(item.councilIncludedEntryIndices || item.minuteEntries!.map((_, i) => i));
                                        const selectedEntries = item.minuteEntries!.filter((_, i) => includedSet.has(i));
                                        
                                        const resolutionEntries = selectedEntries.filter(e => e.type === 'resolution');
                                        const resolutionsArray = resolutionEntries.map(e => ({
                                            number: e.number || item.minuteNumber || '',
                                            title: item.title,
                                            text: e.content
                                        }));

                                        const notesComments = selectedEntries.filter(e => e.type !== 'resolution').map(e => `[${e.type === 'comment' ? 'Commentaire' : 'Note'}]: ${e.content}`).join('\n\n');

                                        navigate('/recommendations', {
                                            state: {
                                                createRecommendation: {
                                                    meetingId: meetingId,
                                                    meetingDate: meetingDate,
                                                    projectName: item.title,
                                                    notes: notesComments,
                                                    resolutions: resolutionsArray,
                                                    considerants: [] 
                                                }
                                            }
                                        });
                                    }}
                                >
                                    Rédiger la recommandation (Ouvrir)
                                </Button>
                            )}
                        </Box>
                    )}
                </Box>
            )}

            {/* Legacy form fields - only show if no minuteEntries */}
            {(!item.minuteEntries || item.minuteEntries.length === 0) && (
                <>
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 12, sm: 4 }}>
                            <TextField
                                select
                                fullWidth
                                label="Type de note"
                                size="small"
                                value={item.minuteType || 'other'}
                                onChange={(e) => onAgendaItemChange(item.id, 'minuteType', e.target.value)}
                                disabled={readOnly}
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
                                onChange={(e) => onAgendaItemChange(item.id, 'minuteNumber', e.target.value)}
                                disabled={readOnly}
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
                                    onChange={(e) => onAgendaItemChange(item.id, 'proposer', e.target.value)}
                                    disabled={readOnly}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <TextField
                                    fullWidth
                                    label="Appuyé par"
                                    size="small"
                                    value={item.seconder || ''}
                                    onChange={(e) => onAgendaItemChange(item.id, 'seconder', e.target.value)}
                                    disabled={readOnly}
                                />
                            </Grid>
                        </Grid>
                    )}

                    <TextField
                        fullWidth
                        multiline
                        rows={4}
                        label="Contenu du PV"
                        placeholder={
                            item.minuteType === 'resolution'
                                ? "CONSIDÉRANT que...\n\nIL EST RÉSOLU..."
                                : "Saisir le commentaire ou la note..."
                        }
                        value={itemDecision || ''}
                        onChange={(e) => onDecisionChange(item.id, e.target.value)}
                        variant="outlined"
                        disabled={readOnly}
                    />
                </>
            )}
        </Box>
    );
};
export default React.memo(AgendaItemEditor);
