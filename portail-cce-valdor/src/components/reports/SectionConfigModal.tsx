import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Typography,
    Divider
} from '@mui/material';
import type { ReportSection } from '../../types/report.types';

interface SectionConfigModalProps {
    open: boolean;
    section: ReportSection;
    onClose: () => void;
    onSave: (section: ReportSection) => void;
}

const SectionConfigModal: React.FC<SectionConfigModalProps> = ({
    open,
    section,
    onClose,
    onSave
}) => {
    const [title, setTitle] = useState(section.title);
    const [subtitle, setSubtitle] = useState(section.subtitle || '');
    const [config, setConfig] = useState(section.config || {});

    // Reset state when section config opens
    useEffect(() => {
        if (open) {
            setTitle(section.title);
            setSubtitle(section.subtitle || '');
            setConfig(section.config || {});
        }
    }, [open, section]);

    const handleSave = () => {
        onSave({
            ...section,
            title,
            subtitle,
            config
        });
    };

    const renderConfigFields = () => {
        switch (section.type) {
            case 'cover':
                return (
                    <>
                        <TextField
                            fullWidth
                            label="Année du rapport"
                            type="number"
                            value={config.year || new Date().getFullYear()}
                            onChange={(e) => setConfig({ ...config, year: parseInt(e.target.value) })}
                            margin="normal"
                        />
                        <TextField
                            fullWidth
                            label="Sous-titre de la couverture"
                            value={subtitle}
                            onChange={(e) => setSubtitle(e.target.value)}
                            margin="normal"
                        />
                    </>
                );
            case 'projects':
                return (
                    <>
                        <FormControl fullWidth margin="normal">
                            <InputLabel>Filtrer par Année</InputLabel>
                            <Select
                                value={config.year || 'all'}
                                label="Filtrer par Année"
                                onChange={(e) => setConfig({ ...config, year: e.target.value })}
                            >
                                <MenuItem value="all">Toutes les années</MenuItem>
                                <MenuItem value={2023}>2023</MenuItem>
                                <MenuItem value={2024}>2024</MenuItem>
                                <MenuItem value={2025}>2025</MenuItem>
                            </Select>
                        </FormControl>
                        <FormGroup>
                            <FormControlLabel
                                control={<Checkbox checked={config.showStatus !== false} onChange={(e) => setConfig({ ...config, showStatus: e.target.checked })} />}
                                label="Afficher le statut"
                            />
                            <FormControlLabel
                                control={<Checkbox checked={config.showBudget !== false} onChange={(e) => setConfig({ ...config, showBudget: e.target.checked })} />}
                                label="Afficher le budget"
                            />
                        </FormGroup>
                    </>
                );
            case 'stats':
                return (
                    <Box>
                        <Typography variant="subtitle2" gutterBottom>Métriques à inclure :</Typography>
                        <FormGroup>
                            <FormControlLabel
                                control={<Checkbox defaultChecked onChange={(e) => setConfig({ ...config, showProjectCount: e.target.checked })} />}
                                label="Nombre total de projets"
                            />
                            <FormControlLabel
                                control={<Checkbox defaultChecked onChange={(e) => setConfig({ ...config, showMeetingCount: e.target.checked })} />}
                                label="Nombre de réunions"
                            />
                            <FormControlLabel
                                control={<Checkbox defaultChecked onChange={(e) => setConfig({ ...config, showResolutionCount: e.target.checked })} />}
                                label="Nombre de résolutions"
                            />
                        </FormGroup>
                    </Box>
                );
            case 'text':
            case 'intro':
            case 'conclusion':
                return (
                    <TextField
                        fullWidth
                        multiline
                        rows={6}
                        label="Contenu du texte"
                        value={config.content || ''}
                        onChange={(e) => setConfig({ ...config, content: e.target.value })}
                        margin="normal"
                        placeholder="Saisissez votre texte ici..."
                    />
                );
            case 'recommendations':
                return (
                    <FormControl fullWidth margin="normal">
                        <InputLabel>Statut des recommandations</InputLabel>
                        <Select
                            value={config.statusFilter || 'all'}
                            label="Statut des recommandations"
                            onChange={(e) => setConfig({ ...config, statusFilter: e.target.value })}
                        >
                            <MenuItem value="all">Touts les statuts</MenuItem>
                            <MenuItem value="accepted">Acceptées</MenuItem>
                            <MenuItem value="pending">En attente</MenuItem>
                        </Select>
                    </FormControl>
                );
            default:
                return <Typography color="text.secondary">Aucune configuration spécifique pour ce type de section.</Typography>;
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Configurer : {section.title}</DialogTitle>
            <DialogContent dividers>
                <TextField
                    fullWidth
                    label="Titre de la section"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    margin="dense"
                    variant="outlined"
                    sx={{ mb: 2 }}
                />

                <Divider sx={{ my: 2 }}>
                    <Typography variant="caption" color="text.secondary">PARAMÈTRES SPÉCIFIQUES</Typography>
                </Divider>

                {renderConfigFields()}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Annuler</Button>
                <Button onClick={handleSave} variant="contained" color="primary">
                    Enregistrer
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SectionConfigModal;
