import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Grid, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    IconButton, LinearProgress, InputAdornment, MenuItem, Select, FormControl, InputLabel,
    Alert
} from '@mui/material';
import {
    CloudUpload, Search, Delete, Add
} from '@mui/icons-material';
import { searchRegulations, type SearchableRegulation } from '../../services/supabaseSearchService';
import { aiService } from '../../services/ai/UnifiedAIService';
import { useToast } from '../../hooks/useToast';
import { db } from '../../services/firebase';
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

const CATEGORIES = [
    'Urbanisme', 'Zonage', 'Construction', 'Environnement', 'Lotissement', 'Permis', 'Autre'
];

const STATUSES = ['En vigueur', 'Abrogé', 'Projet'];

const RegulationManager: React.FC = () => {
    const { showToast } = useToast();

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [regulations, setRegulations] = useState<SearchableRegulation[]>([]);
    const [loading, setLoading] = useState(false);
    const [collectionMissing, setCollectionMissing] = useState(false);

    // Upload State
    const [uploadMode, setUploadMode] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [processing, setProcessing] = useState(false);
    const [processStep, setProcessStep] = useState<string>('');
    const [formData, setFormData] = useState({
        title: '',
        category: 'Urbanisme',
        year: new Date().getFullYear(),
        status: 'En vigueur',
        content: ''
    });

    const fetchRegulations = async () => {
        setLoading(true);
        try {
            const results = await searchRegulations(searchQuery, { matchCount: 20 });
            setRegulations(results.hits.map(h => h.document));
            setCollectionMissing(false);
        } catch (error) {
            // Check if it's a "Collection not found" error
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('404') || errorMessage.includes('Collection not found')) {
                console.info('Typesense regulations collection not yet created');
                setCollectionMissing(true);
                setRegulations([]);
            } else {
                console.error('Search failed', error);
                showToast('Erreur lors du chargement des règlements', 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRegulations();
    }, [searchQuery]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const selectedFile = event.target.files[0];
            setFile(selectedFile);
            // Auto-fill title from filename
            setFormData(prev => ({
                ...prev,
                title: selectedFile.name.replace(/\.(pdf|docx)$/i, '')
            }));
        }
    };

    const handleIndexing = async () => {
        if (!file || !formData.title) return;

        setProcessing(true);
        try {
            // 1. OCR / Text Extraction
            setProcessStep('Extraction du texte...');
            let content = formData.content;

            if (!content && file) {
                if (file.name.toLowerCase().endsWith('.docx')) {
                    setProcessStep('Lecture du fichier Word...');
                    const { extractTextFromDOCX } = await import('../../services/docxParserService');
                    content = await extractTextFromDOCX(file);
                } else {
                    setProcessStep('Extraction du texte via IA (Gemini multimodal)...');
                    content = await aiService.extractText(file);
                }
                setFormData(prev => ({ ...prev, content }));
            }

            if (!content) throw new Error("Impossible d'extraire le contenu du fichier.");

            // 2. Indexing
            setProcessStep('Sauvegarde et Indexation...');

            // Save to Firestore first to have a permanent record
            const regulationData = {
                title: formData.title,
                content: content,
                category: formData.category,
                year: Number(formData.year),
                status: formData.status,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            await addDoc(collection(db, 'regulations'), regulationData);

            /*
            const newReg: SearchableRegulation = {
                id: docRef.id,
                title: formData.title,
                content: content,
                category: formData.category,
                year: Number(formData.year),
                status: formData.status
            };
            */
            // await typesenseService.indexRegulation(newReg, true); // Handled by Cloud Function

            showToast('Règlement indexé avec succès !', 'success');
            setUploadMode(false);
            setFile(null);
            setFormData({ title: '', category: 'Urbanisme', year: new Date().getFullYear(), status: 'En vigueur', content: '' });
            fetchRegulations();

        } catch (error) {
            console.error('Indexing failed', error);
            showToast('Erreur : ' + (error instanceof Error ? error.message : String(error)), 'error');
        } finally {
            setProcessing(false);
            setProcessStep('');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce règlement ?')) return;
        try {
            await deleteDoc(doc(db, 'regulations', id));
            // await typesenseService.deleteFromIndex('regulations', id); // Handled by Cloud Function
            // Wait a sec for propagation
            setTimeout(fetchRegulations, 500);
            showToast('Supprimé', 'success');
        } catch (e) {
            showToast('Erreur suppression', 'error');
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 4 }}>
                <Typography variant="h4" fontWeight="bold">
                    🏛️ Bibliothèque des Règlements
                </Typography>
                <Button
                    variant="contained"
                    startIcon={uploadMode ? <Search /> : <Add />}
                    onClick={() => setUploadMode(!uploadMode)}
                >
                    {uploadMode ? 'Retour à la recherche' : 'Nouveau Règlement'}
                </Button>
            </Box>

            {/* UPLOAD FORM */}
            {uploadMode && (
                <Paper sx={{ p: 3, mb: 4 }}>
                    <Typography variant="h6" gutterBottom>Ajouter un règlement</Typography>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Button
                                variant="outlined"
                                component="label"
                                fullWidth
                                startIcon={<CloudUpload />}
                                sx={{ height: '56px' }}
                            >
                                {file ? file.name : "Choisir un PDF ou Word"}
                                <input type="file" hidden accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileSelect} />
                            </Button>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                label="Titre officiel"
                                fullWidth
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <FormControl fullWidth>
                                <InputLabel>Catégorie</InputLabel>
                                <Select
                                    value={formData.category}
                                    label="Catégorie"
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                >
                                    {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <TextField
                                label="Année"
                                type="number"
                                fullWidth
                                value={formData.year}
                                onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <FormControl fullWidth>
                                <InputLabel>Statut</InputLabel>
                                <Select
                                    value={formData.status}
                                    label="Statut"
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                >
                                    {STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <Button
                                    variant="contained"
                                    color="success"
                                    size="large"
                                    disabled={!file || !formData.title || processing}
                                    onClick={handleIndexing}
                                >
                                    {processing ? 'Traitement...' : 'Lancer l\'indexation IA'}
                                </Button>
                                {processing && (
                                    <Box sx={{ flex: 1 }}>
                                        <LinearProgress />
                                        <Typography variant="caption" color="text.secondary">{processStep}</Typography>
                                    </Box>
                                )}
                            </Box>
                        </Grid>
                    </Grid>
                </Paper>
            )}

            {/* SEARCH & LIST */}
            {!uploadMode && (
                <>
                    <Paper sx={{ p: 2, mb: 3 }}>
                        <TextField
                            fullWidth
                            placeholder="Rechercher un règlement (ex: 'zonage', '2024-02', 'piscine')..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start"><Search /></InputAdornment>
                            }}
                        />
                    </Paper>

                    {loading ? <LinearProgress /> : (
                        <TableContainer component={Paper}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Titre</TableCell>
                                        <TableCell>Catégorie</TableCell>
                                        <TableCell>Année</TableCell>
                                        <TableCell>Statut</TableCell>
                                        <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {regulations.map((reg) => (
                                        <TableRow key={reg.id}>
                                            <TableCell component="th" scope="row">
                                                <Typography variant="subtitle2">{reg.title}</Typography>
                                                {reg.content && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {reg.content.substring(0, 100)}...
                                                    </Typography>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Chip label={reg.category} size="small" />
                                            </TableCell>
                                            <TableCell>{reg.year}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={reg.status}
                                                    size="small"
                                                    color={reg.status === 'En vigueur' ? 'success' : 'default'}
                                                />
                                            </TableCell>
                                            <TableCell align="right">
                                                <IconButton color="error" onClick={() => handleDelete(reg.id)}>
                                                    <Delete />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {regulations.length === 0 && !collectionMissing && (
                                        <TableRow>
                                            <TableCell colSpan={5} align="center">
                                                Aucun règlement trouvé.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {collectionMissing && (
                                        <TableRow>
                                            <TableCell colSpan={5}>
                                                <Alert severity="info" sx={{ m: 2 }}>
                                                    <Typography variant="subtitle2" gutterBottom>Collection Typesense non configurée</Typography>
                                                    <Typography variant="body2">
                                                        La collection "regulations" doit être créée dans Typesense Cloud.
                                                        Ajoutez un règlement pour initialiser automatiquement la collection.
                                                    </Typography>
                                                </Alert>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            )}
        </Box>
    );
};

export default RegulationManager;
