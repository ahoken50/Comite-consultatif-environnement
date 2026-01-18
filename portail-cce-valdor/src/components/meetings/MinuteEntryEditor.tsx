import React, { useState } from 'react';
import { Box, Grid, TextField, MenuItem, IconButton, Tooltip, CircularProgress, InputAdornment } from '@mui/material';
import { AutoMode } from '@mui/icons-material';
import type { MinuteEntry } from '../../types/meeting.types';
import { searchMeetings } from '../../services/typesenseService';
import { aiService } from '../../services/ai/UnifiedAIService';

interface MinuteEntryEditorProps {
    entry: MinuteEntry;
    entryIndex: number;
    itemId: string;
    onChange: (itemId: string, entryIndex: number, field: string, value: any) => void;
    readOnly?: boolean;
    itemTitle: string;
    itemDescription: string;
}

/**
 * Editable minute entry component for resolutions and comments.
 * Extracted from MinutesEditor to reduce component size and improve reusability.
 */
const MinuteEntryEditor: React.FC<MinuteEntryEditorProps> = ({
    entry,
    entryIndex,
    itemId,
    onChange,
    readOnly = false,
    itemTitle,
    itemDescription
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isDrafting, setIsDrafting] = useState(false);

    const handleFieldChange = (field: string, value: any) => {
        onChange(itemId, entryIndex, field, value);
    };

    const handleMagicDraft = async () => {
        if (!itemTitle) return;
        setIsDrafting(true);
        try {
            // 1. Search for similar resolutions in Typesense
            // The service automatically handles vector embedding for queries > 3 chars
            const searchResults = await searchMeetings(itemTitle, {
                perPage: 3,
                // We could filter by status if needed, e.g. filterBy: 'status:=Published'
            });

            // Extract resolutions from the matching meetings
            // Since we don't have item-level granularity in the index yet, we take resolutions from the top matching meetings
            const similarResolutions = searchResults.hits
                .flatMap(hit => {
                    const doc = hit.document;
                    // Return all resolutions from this matching meeting
                    return (doc.resolutions || []).map(r => ({
                        content: r,
                        similarity: 0.8, // Approximation
                        source: `${doc.title} (${new Date(doc.date).toLocaleDateString()})`
                    }));
                })
                .slice(0, 5) // Take a few more candidates
                .filter(r => r.content.length > 50); // specific resolutions usually have length

            // 2. Call AI to draft
            const draft = await aiService.draftResolution({
                title: itemTitle,
                description: itemDescription,
                similarResolutions: similarResolutions.slice(0, 3) // Pass top 3
            });

            // 3. Update field
            handleFieldChange('content', draft);
            setIsExpanded(true);

        } catch (error) {
            console.error("Magic Draft failed:", error);
            alert("Erreur lors de la génération: " + (error instanceof Error ? error.message : String(error)));
        } finally {
            setIsDrafting(false);
        }
    };

    const borderColor = entry.type === 'resolution' ? 'primary.main' : 'warning.main';
    const contentLabel = entry.type === 'resolution'
        ? "Contenu de la résolution"
        : "Contenu du commentaire";
    const contentPlaceholder = entry.type === 'resolution'
        ? "CONSIDÉRANT que...\n\nIL EST RÉSOLU..."
        : "Saisir le commentaire...";

    return (
        <Box
            id={`resolution-${itemId}-${entryIndex}`}
            sx={{
                mb: 2,
                p: 2,
                bgcolor: 'grey.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor
            }}
        >
            <Grid container spacing={2} sx={{ mb: 1 }}>
                <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                        select
                        fullWidth
                        label="Type"
                        size="small"
                        value={entry.type}
                        onChange={(e) => handleFieldChange('type', e.target.value)}
                        disabled={readOnly}
                    >
                        <MenuItem value="resolution">📋 Résolution</MenuItem>
                        <MenuItem value="comment">💬 Commentaire</MenuItem>
                    </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                        fullWidth
                        label="Numéro (ex: 09-35)"
                        size="small"
                        value={entry.number || ''}
                        onChange={(e) => handleFieldChange('number', e.target.value)}
                        disabled={readOnly}
                    />
                </Grid>
            </Grid>
            <TextField
                fullWidth
                multiline
                rows={isExpanded ? 12 : 4}
                label={contentLabel}
                placeholder={contentPlaceholder}
                value={entry.content || ''}
                onChange={(e) => handleFieldChange('content', e.target.value)}
                onFocus={() => setIsExpanded(true)}
                onBlur={() => setIsExpanded(false)}
                variant="outlined"
                size="small"
                disabled={readOnly}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                            {!readOnly && entry.type === 'resolution' && (
                                <Tooltip title="✨ 'Magic Draft' : Rédiger avec IA en s'inspirant de la jurisprudence">
                                    <IconButton
                                        onClick={handleMagicDraft}
                                        color="primary"
                                        disabled={isDrafting}
                                        size="small"
                                        sx={{
                                            bgcolor: 'primary.50',
                                            '&:hover': { bgcolor: 'primary.100' },
                                            border: '1px solid',
                                            borderColor: 'primary.main'
                                        }}
                                    >
                                        {isDrafting ? <CircularProgress size={20} /> : <AutoMode fontSize="small" />}
                                    </IconButton>
                                </Tooltip>
                            )}
                        </InputAdornment>
                    ),
                }}
                sx={{
                    transition: 'all 0.3s ease-in-out',
                    '& .MuiInputBase-root': {
                        transition: 'all 0.3s ease-in-out',
                        pr: 1
                    }
                }}
            />
        </Box>
    );
};

export default MinuteEntryEditor;
