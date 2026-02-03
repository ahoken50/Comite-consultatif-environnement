
import React, { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    List,
    ListItem,
    ListItemText,
    Chip,
    IconButton,
    TextField,
    Divider,
    Button,
    Collapse
} from '@mui/material';
import {
    Edit as EditIcon,
    Check as CheckIcon,
    Close as CloseIcon,
    DragIndicator as DragIcon
} from '@mui/icons-material';
import type { AgendaItem } from '../../../types/meeting.types';
import type { AnalysisResult } from '../../../types/pvAgent.types';

interface AnalysisValidatorProps {
    analysis: AnalysisResult;
    agendaItems: AgendaItem[];
    onChange: (updatedAnalysis: AnalysisResult) => void;
}

const AnalysisValidator: React.FC<AnalysisValidatorProps> = ({
    analysis,
    agendaItems,
    onChange
}) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const handleEditStart = (odjId: string, currentText: string) => {
        setEditingId(odjId);
        setEditValue(currentText);
    };

    const handleEditSave = () => {
        if (!editingId) return;

        const updatedMapped = analysis.mappedItems.map(item =>
            item.odjItemId === editingId
                ? { ...item, transcriptSegment: editValue }
                : item
        );

        onChange({
            ...analysis,
            mappedItems: updatedMapped
        });
        setEditingId(null);
    };

    const handleReassign = (mappingIndex: number, newOdjId: string, newTitle: string) => {
        // Find if target item already has a mapping
        const existingMappingIndex = analysis.mappedItems.findIndex(m => m.odjItemId === newOdjId);

        // If we are moving content to an item that already has content, we might need to merge or ask
        // For this MVP, we will just update the ID and Title of the current mapping item
        // Note: This logic assumes 1-to-1 mapping which is the current Agent logic

        const updatedMapped = [...analysis.mappedItems];
        updatedMapped[mappingIndex] = {
            ...updatedMapped[mappingIndex],
            odjItemId: newOdjId,
            odjTitle: newTitle
        };

        onChange({
            ...analysis,
            mappedItems: updatedMapped
        });
    };

    return (
        <Box>
            <Typography variant="subtitle2" gutterBottom color="info.main">
                Vérifiez et corrigez l'association entre les points de l'ordre du jour et les discussions.
            </Typography>

            <List disablePadding>
                {agendaItems.map((item, index) => {
                    const mapped = analysis.mappedItems.find(m => m.odjItemId === item.id);
                    const isEditing = editingId === item.id;

                    return (
                        <Paper key={item.id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                            <Box sx={{
                                p: 1.5,
                                bgcolor: mapped ? 'success.light' : 'grey.100',
                                color: mapped ? 'success.contrastText' : 'text.primary',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <Typography variant="subtitle2" fontWeight="bold">
                                    {index + 1}. {item.title}
                                </Typography>
                                {mapped && (
                                    <Chip
                                        label={`${(mapped.confidence * 100).toFixed(0)}% confiance`}
                                        size="small"
                                        color={mapped.confidence > 0.8 ? 'success' : 'warning'}
                                        variant="outlined"
                                        sx={{ bgcolor: 'white', border: 'none' }}
                                    />
                                )}
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
                                            <Typography variant="body2" sx={{ flexGrow: 1, whiteSpace: 'pre-wrap' }}>
                                                {mapped.transcriptSegment}
                                            </Typography>
                                            <IconButton size="small" onClick={() => handleEditStart(item.id, mapped.transcriptSegment)}>
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
