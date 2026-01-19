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
    Close as CloseIcon,
} from '@mui/icons-material';

interface PVModeSelectorProps {
    open: boolean;
    onClose: () => void;
    onSelectMode: (mode: 'classic' | 'smartpv') => void;
    hasTranscription?: boolean;
}

const PVModeSelector: React.FC<PVModeSelectorProps> = ({
    open,
    onClose,
    onSelectMode,
    hasTranscription = false,
}) => {
    const [selectedMode, setSelectedMode] = React.useState<'classic' | 'smartpv'>('smartpv');

    const handleConfirm = () => {
        onSelectMode(selectedMode);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AutoAwesomeIcon color="primary" />
                    <Typography variant="h6">Mode de génération du PV</Typography>
                </Box>
            </DialogTitle>

            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Choisissez comment vous souhaitez créer le procès-verbal pour cette réunion.
                </Typography>

                <RadioGroup
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as 'classic' | 'smartpv')}
                >
                    {/* Classic Mode */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            mb: 2,
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
                                            Mode Classique
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Transcription + édition manuelle des points
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Contrôle total"
                                            color="default"
                                            variant="outlined"
                                        />
                                        <Chip
                                            size="small"
                                            icon={<CloseIcon />}
                                            label="Plus de travail"
                                            color="default"
                                            variant="outlined"
                                        />
                                    </Box>
                                </Box>
                            }
                            sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                        />
                    </Paper>

                    {/* SmartPV Mode */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            cursor: 'pointer',
                            borderColor: selectedMode === 'smartpv' ? 'primary.main' : 'divider',
                            borderWidth: selectedMode === 'smartpv' ? 2 : 1,
                            bgcolor: selectedMode === 'smartpv' ? 'action.selected' : 'transparent',
                            position: 'relative',
                        }}
                        onClick={() => setSelectedMode('smartpv')}
                    >
                        <Chip
                            label="✨ NOUVEAU"
                            size="small"
                            color="secondary"
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
                                            Mode SmartPV (Agent IA)
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Génération autonome en 5 étapes avec validation
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Rapide"
                                            color="success"
                                            variant="outlined"
                                        />
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Validation par étape"
                                            color="success"
                                            variant="outlined"
                                        />
                                        <Chip
                                            size="small"
                                            icon={<CheckIcon />}
                                            label="Format CCE automatique"
                                            color="success"
                                            variant="outlined"
                                        />
                                    </Box>
                                </Box>
                            }
                            sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                        />
                    </Paper>
                </RadioGroup>

                {!hasTranscription && selectedMode === 'smartpv' && (
                    <Typography
                        variant="body2"
                        color="warning.main"
                        sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        ⚠️ Aucune transcription disponible. Veuillez d'abord téléverser un fichier audio.
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
                    disabled={!hasTranscription && selectedMode === 'smartpv'}
                >
                    Continuer avec ce mode
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PVModeSelector;
