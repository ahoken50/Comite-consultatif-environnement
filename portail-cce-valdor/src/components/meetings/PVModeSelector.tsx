/**
 * PV Mode Selector Component
 * 
 * Allows users to choose between Classic mode (manual) and SmartPV Agent mode.
 */

import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Radio,
    RadioGroup,
    FormControlLabel,
    Paper,
    Chip,
} from '@mui/material';
import {
    Edit as EditIcon,
    AutoAwesome as AutoAwesomeIcon,
    Check as CheckIcon,
} from '@mui/icons-material';

interface PVModeSelectorProps {
    open: boolean;
    onClose: () => void;
    onSelectMode: (mode: 'classic' | 'smartpv' | 'summary') => void;
    hasTranscription?: boolean;
}

const PVModeSelector: React.FC<PVModeSelectorProps> = ({
    open,
    onClose,
    onSelectMode,
    hasTranscription = false,
}) => {
    const [selectedMode, setSelectedMode] = React.useState<'classic' | 'smartpv' | 'summary'>('smartpv');

    const handleConfirm = () => {
        onSelectMode(selectedMode);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AutoAwesomeIcon color="primary" />
                    <Typography variant="h6">Assistant de Rédaction IA (SmartPV)</Typography>
                </Box>
            </DialogTitle>

            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Sélectionnez la méthode de rédaction ou d'assistance IA pour le procès-verbal de cette réunion.
                </Typography>

                <RadioGroup
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as 'classic' | 'smartpv' | 'summary')}
                >
                    {/* SmartPV Mode */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            mb: 2,
                            cursor: 'pointer',
                            borderColor: selectedMode === 'smartpv' ? 'primary.main' : 'divider',
                            borderWidth: selectedMode === 'smartpv' ? 2 : 1,
                            bgcolor: selectedMode === 'smartpv' ? 'action.selected' : 'transparent',
                            position: 'relative',
                        }}
                        onClick={() => setSelectedMode('smartpv')}
                    >
                        <Chip
                            label="✨ RECOMMANDÉ"
                            size="small"
                            color="primary"
                            sx={{
                                position: 'absolute',
                                top: -10,
                                right: 16,
                            }}
                        />
                        <FormControlLabel
                            value="smartpv"
                            control={<Radio />}
                            label={
                                <Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <AutoAwesomeIcon fontSize="small" color="primary" />
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            Génération Complète du PV (SmartPV)
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Rédige de façon autonome l'entièreté du PV en analysant la transcription audio en 5 étapes clés avec validation intermédiaire.
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Complet (Points & Résolutions)"
                                            color="success"
                                            variant="outlined"
                                        />
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Validation des étapes"
                                            color="success"
                                            variant="outlined"
                                        />
                                    </Box>
                                </Box>
                            }
                            sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                        />
                    </Paper>

                    {/* Summary Mode */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            mb: 2,
                            cursor: 'pointer',
                            borderColor: selectedMode === 'summary' ? 'primary.main' : 'divider',
                            borderWidth: selectedMode === 'summary' ? 2 : 1,
                            bgcolor: selectedMode === 'summary' ? 'action.selected' : 'transparent',
                        }}
                        onClick={() => setSelectedMode('summary')}
                    >
                        <FormControlLabel
                            value="summary"
                            control={<Radio />}
                            label={
                                <Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <AutoAwesomeIcon fontSize="small" color="secondary" />
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            Rédiger uniquement l'introduction
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Génère un résumé exécutif de début de séance basé sur l'audio et l'insère directement dans les notes générales.
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Rapide (moins d'une minute)"
                                            color="default"
                                            variant="outlined"
                                        />
                                    </Box>
                                </Box>
                            }
                            sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                        />
                    </Paper>

                    {/* Classic Mode */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            cursor: 'pointer',
                            borderColor: selectedMode === 'classic' ? 'primary.main' : 'divider',
                            borderWidth: selectedMode === 'classic' ? 2 : 1,
                            bgcolor: selectedMode === 'classic' ? 'action.selected' : 'transparent',
                        }}
                        onClick={() => setSelectedMode('classic')}
                    >
                        <FormControlLabel
                            value="classic"
                            control={<Radio />}
                            label={
                                <Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <EditIcon fontSize="small" />
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            Mode Classique (Saisie Manuelle)
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Aucune génération automatique globale. Saisie manuelle de l'ordre du jour assistée en ligne par point.
                                    </Typography>
                                </Box>
                            }
                            sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                        />
                    </Paper>
                </RadioGroup>

                {!hasTranscription && (selectedMode === 'smartpv' || selectedMode === 'summary') && (
                    <Typography
                        variant="body2"
                        color="warning.main"
                        sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'bold' }}
                    >
                        ⚠️ Aucune transcription audio disponible pour cette réunion. L'assistance IA nécessite un audio transcrit.
                    </Typography>
                )}
            </DialogContent>

            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={onClose} color="inherit">
                    Annuler
                </Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    disabled={!hasTranscription && (selectedMode === 'smartpv' || selectedMode === 'summary')}
                >
                    Confirmer le choix
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PVModeSelector;
