import React, { useState } from 'react';
import { Box, Grid, TextField, MenuItem } from '@mui/material';
import type { MinuteEntry } from '../../types/meeting.types';

interface MinuteEntryEditorProps {
    entry: MinuteEntry;
    entryIndex: number;
    itemId: string;
    onChange: (itemId: string, entryIndex: number, field: string, value: any) => void;
}

/**
 * Editable minute entry component for resolutions and comments.
 * Extracted from MinutesEditor to reduce component size and improve reusability.
 */
const MinuteEntryEditor: React.FC<MinuteEntryEditorProps> = ({
    entry,
    entryIndex,
    itemId,
    onChange
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleFieldChange = (field: string, value: any) => {
        onChange(itemId, entryIndex, field, value);
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
                sx={{
                    transition: 'all 0.3s ease-in-out',
                    '& .MuiInputBase-root': {
                        transition: 'all 0.3s ease-in-out',
                    }
                }}
            />
        </Box>
    );
};

export default MinuteEntryEditor;
