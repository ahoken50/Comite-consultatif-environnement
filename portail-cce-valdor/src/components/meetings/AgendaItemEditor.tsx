import React from 'react';
import { Box, Grid, TextField, MenuItem, Typography, Button } from '@mui/material';
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
    onDecisionChange: (itemId: string, value: string) => void;
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
    onDecisionChange
}) => {
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
                        />
                    ))}
                </Box>
            )}

            {/* Button to add new entry */}
            <Button
                variant="outlined"
                size="small"
                startIcon={<Add />}
                onClick={() => onAddMinuteEntry(item.id)}
                sx={{ mb: 2 }}
            >
                Ajouter résolution/commentaire
            </Button>

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
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <TextField
                                    fullWidth
                                    label="Appuyé par"
                                    size="small"
                                    value={item.seconder || ''}
                                    onChange={(e) => onAgendaItemChange(item.id, 'seconder', e.target.value)}
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
                    />
                </>
            )}
        </Box>
    );
};

export default AgendaItemEditor;
