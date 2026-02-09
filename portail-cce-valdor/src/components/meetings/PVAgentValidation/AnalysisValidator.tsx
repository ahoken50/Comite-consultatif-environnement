/**
 * AnalysisValidator — Validation de l'analyse ODJ (Step 4)
 *
 * Permet à l'utilisateur de vérifier et corriger l'association
 * entre les points de l'ordre du jour et les segments de transcription.
 * Compatible avec le nouveau type ODJAnalysisResult.
 */

import React, { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    List,
    Chip,
    IconButton,
    TextField,
    Button,
} from '@mui/material';
import {
    Edit as EditIcon,
    Check as CheckIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import type { AgendaItem } from '../../../types/meeting.types';
import type { ODJAnalysisResult } from '../../../types/pvAgent.types';

interface AnalysisValidatorProps {
    analysis: ODJAnalysisResult;
    agendaItems: AgendaItem[];
    onChange: (updatedAnalysis: ODJAnalysisResult) => void;
}

const AnalysisValidator: React.FC<AnalysisValidatorProps> = ({
    analysis,
    agendaItems,
    onChange,
}) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const handleEditStart = (odjId: string, currentSegments: string[]) => {
        setEditingId(odjId);
        setEditValue(currentSegments.join('\n\n'));
    };

    const handleEditSave = () => {
        if (!editingId) return;

        const updatedMapped = analysis.mappedItems.map(item =>
            item.odjItemId === editingId
                ? {
                    ...item,
                    transcriptSegments: editValue.split('\n\n').filter(s => s.trim()),
                }
                : item
        );

        onChange({
            ...analysis,
            mappedItems: updatedMapped,
        });
        setEditingId(null);
    };

    return (
        <Box>
            <Typography variant="subtitle2" gutterBottom color="info.main">
                Vérifiez et corrigez l'association entre les points de l'ordre du jour et les discussions.
            </Typography>

            {/* Coverage indicator */}
            {analysis.coveragePercent !== undefined && (
                <Chip
                    label={`Couverture: ${analysis.coveragePercent.toFixed(0)}%`}
                    color={analysis.coveragePercent >= 90 ? 'success' : analysis.coveragePercent >= 70 ? 'warning' : 'error'}
                    size="small"
                    sx={{ mb: 2 }}
                />
            )}

            <List disablePadding>
                {agendaItems.map((item, index) => {
                    const mapped = analysis.mappedItems.find(m => m.odjItemId === item.id);
                    const isEditing = editingId === item.id;

                    // Support both old (transcriptSegment) and new (transcriptSegments) format
                    const segments = mapped?.transcriptSegments
                        || (mapped as any)?.transcriptSegment
                            ? [(mapped as any).transcriptSegment]
                            : [];

                    return (
                        <Paper key={item.id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                            <Box sx={{
                                p: 1.5,
                                bgcolor: mapped ? 'success.light' : 'grey.100',
                                color: mapped ? 'success.contrastText' : 'text.primary',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}>
                                <Typography variant="subtitle2" fontWeight="bold">
                                    {index + 1}. {item.title}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                    {mapped?.speakers && mapped.speakers.length > 0 && (
                                        <Chip
                                            label={`${mapped.speakers.length} intervenant(s)`}
                                            size="small"
                                            variant="outlined"
                                            sx={{ bgcolor: 'white', border: 'none' }}
                                        />
                                    )}
                                    {mapped && (
                                        <Chip
                                            label={`${((mapped.confidence || 0) * 100).toFixed(0)}% confiance`}
                                            size="small"
                                            color={mapped.confidence > 0.8 ? 'success' : 'warning'}
                                            variant="outlined"
                                            sx={{ bgcolor: 'white', border: 'none' }}
                                        />
                                    )}
                                </Box>
                            </Box>

                            {mapped ? (
                                <Box sx={{ p: 2 }}>
                                    {isEditing ? (
                                        <Box>
                                            <TextField
                                                fullWidth
                                                multiline
                                                minRows={3}
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                variant="outlined"
                                                size="small"
                                                autoFocus
                                                helperText="Séparez les segments par une ligne vide"
                                            />
                                            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                                <Button size="small" onClick={() => setEditingId(null)} startIcon={<CloseIcon />}>
                                                    Annuler
                                                </Button>
                                                <Button size="small" variant="contained" onClick={handleEditSave} startIcon={<CheckIcon />}>
                                                    Enregistrer
                                                </Button>
                                            </Box>
                                        </Box>
                                    ) : (
                                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                            <Box sx={{ flexGrow: 1 }}>
                                                {(mapped.transcriptSegments || segments).map((seg: string, i: number) => (
                                                    <Typography
                                                        key={i}
                                                        variant="body2"
                                                        sx={{
                                                            whiteSpace: 'pre-wrap',
                                                            mb: i < (mapped.transcriptSegments || segments).length - 1 ? 1 : 0,
                                                            pl: 1,
                                                            borderLeft: '2px solid',
                                                            borderColor: 'divider',
                                                        }}
                                                    >
                                                        {seg}
                                                    </Typography>
                                                ))}
                                                {mapped.speakers && mapped.speakers.length > 0 && (
                                                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                                        {mapped.speakers.map((speaker: string, i: number) => (
                                                            <Chip
                                                                key={i}
                                                                label={speaker}
                                                                size="small"
                                                                variant="outlined"
                                                                color="primary"
                                                            />
                                                        ))}
                                                    </Box>
                                                )}
                                            </Box>
                                            <IconButton
                                                size="small"
                                                onClick={() => handleEditStart(item.id, mapped.transcriptSegments || segments)}
                                            >
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    )}
                                </Box>
                            ) : (
                                <Box sx={{ p: 2 }}>
                                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                        Aucune discussion associée automatiquement.
                                    </Typography>
                                </Box>
                            )}
                        </Paper>
                    );
                })}
            </List>

            {analysis.unmappedSegments.length > 0 && (
                <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" color="warning.main" gutterBottom>
                        ⚠️ Segments non associés ({analysis.unmappedSegments.length})
                    </Typography>
                    {analysis.unmappedSegments.map((seg, i) => (
                        <Paper key={i} sx={{ p: 1.5, mb: 1, bgcolor: 'warning.light' }}>
                            <Typography variant="body2" fontSize="0.85rem">
                                {seg.substring(0, 200)}...
                            </Typography>
                        </Paper>
                    ))}
                </Box>
            )}
        </Box>
    );
};

export default AnalysisValidator;