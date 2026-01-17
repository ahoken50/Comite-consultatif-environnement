import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, TextField } from '@mui/material';
import { Edit, Check, Save } from '@mui/icons-material';

interface QuickNotesPanelProps {
    itemId: string;
    itemTitle: string;
    onSave: (note: string) => void;
    initialNote?: string;
}

const QuickNotesPanel: React.FC<QuickNotesPanelProps> = ({ itemId, itemTitle, onSave, initialNote = '' }) => {
    const [note, setNote] = useState(initialNote);
    const [isSaved, setIsSaved] = useState(true);

    useEffect(() => {
        setNote(initialNote);
        setIsSaved(true);
    }, [itemId, initialNote]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNote(e.target.value);
        setIsSaved(false);
    };

    const handleSave = () => {
        onSave(note);
        setIsSaved(true);
    };

    return (
        <Box sx={{ bgcolor: '#fffbeb', height: '100%', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #fcd34d' }}>
            <Box sx={{ p: 2, bgcolor: 'rgba(254, 243, 199, 0.5)', borderBottom: '1px solid #fcd34d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
                    <Edit sx={{ color: '#b45309', fontSize: 18 }} />
                    <Typography variant="subtitle2" sx={{ color: '#78350f', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        Notes : {itemTitle}
                    </Typography>
                </Box>
                {!isSaved && (
                    <Typography variant="caption" sx={{ color: '#d97706', fontWeight: 'bold', animation: 'pulse 1s infinite' }}>
                        En cours...
                    </Typography>
                )}
            </Box>

            <Box sx={{ flex: 1, p: 2, position: 'relative' }}>
                <TextField
                    multiline
                    fullWidth
                    value={note}
                    onChange={handleChange}
                    placeholder="Commencez à saisir vos notes ici..."
                    variant="standard"
                    InputProps={{
                        disableUnderline: true,
                        sx: { height: '100%', alignItems: 'start', fontSize: '0.875rem', color: '#451a03' }
                    }}
                    sx={{ height: '100%' }}
                />

                <Box sx={{ position: 'absolute', bottom: 16, right: 16 }}>
                    <Button
                        onClick={handleSave}
                        variant="contained"
                        size="small"
                        startIcon={isSaved ? <Check /> : <Save />}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 'bold',
                            bgcolor: isSaved ? 'rgba(253, 230, 138, 0.5)' : '#059669',
                            color: isSaved ? '#b45309' : 'white',
                            boxShadow: isSaved ? 'none' : 2,
                            '&:hover': {
                                bgcolor: isSaved ? 'rgba(253, 230, 138, 0.5)' : '#047857'
                            }
                        }}
                    >
                        {isSaved ? 'Enregistré' : 'Sauvegarder'}
                    </Button>
                </Box>
            </Box>
        </Box>
    );
};

export default QuickNotesPanel;
