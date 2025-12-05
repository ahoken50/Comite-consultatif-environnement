import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Alert
} from '@mui/material';
import type { AgendaItem } from '../../types/meeting.types';

interface MinutesImportDialogProps {
    open: boolean;
    onClose: () => void;
    onImport: (parsedItems: Partial<AgendaItem>[]) => void;
}

const MinutesImportDialog: React.FC<MinutesImportDialogProps> = ({ open, onClose, onImport }) => {
    const [text, setText] = useState('');

    const handleImport = () => {
        // Advanced Parsing Logic
        // Let's try a block-based approach
        const blocks = text.split(/(?=RÉSOLUTION|COMMENTAIRE)/i);
        const parsed: Partial<AgendaItem>[] = [];

        blocks.forEach(block => {
            const match = block.match(/^(RÉSOLUTION|COMMENTAIRE)\s+([0-9A-Z-]+)([\s\S]*)/i);
            if (match) {
                const type = match[1].toUpperCase() === 'RÉSOLUTION' ? 'resolution' : 'comment';
                const number = match[2].trim();
                let content = match[3].trim();

                // Extract Proposer/Seconder
                let proposer = '';
                let seconder = '';

                // Look for "Sur une proposition de..." or "Proposé par..."
                const propMatch = content.match(/(?:Sur une proposition de|Proposé par)\s+([^,.\n]+)/i);
                if (propMatch) {
                    proposer = propMatch[1].trim();
                }

                // Look for "Appuyé par..."
                const secMatch = content.match(/Appuyé par\s+([^,.\n]+)/i);
                if (secMatch) {
                    seconder = secMatch[1].trim();
                }

                parsed.push({
                    minuteType: type as any,
                    minuteNumber: number,
                    decision: content,
                    proposer,
                    seconder
                });
            }
        });

        onImport(parsed);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Importer un Procès-Verbal</DialogTitle>
            <DialogContent>
                <Alert severity="info" sx={{ mb: 2 }}>
                    Collez le texte du procès-verbal ci-dessous. Le système détectera automatiquement les Résolutions et Commentaires (ex: "RÉSOLUTION 09-35").
                </Alert>
                <TextField
                    multiline
                    rows={15}
                    fullWidth
                    variant="outlined"
                    placeholder="Collez le texte ici..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Annuler</Button>
                <Button onClick={handleImport} variant="contained" disabled={!text.trim()}>
                    Importer
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default MinutesImportDialog;
