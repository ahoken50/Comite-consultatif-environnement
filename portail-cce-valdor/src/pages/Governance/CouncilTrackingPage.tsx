import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Button,
    Card,
    CardContent,
    Grid,
    Dialog,
    IconButton
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import type { AppDispatch } from '../../store/store';
import { fetchRecommendations, selectRecommendations, deleteRecommendation } from '../../features/governance/governanceSlice';
import type { CouncilRecommendation } from '../../types/recommendation.types';
import RecommendationBuilder from '../../components/governance/RecommendationBuilder';
import type { RecommendationInitialData } from '../../components/governance/RecommendationBuilder';
import { useLocation } from 'react-router-dom';

import RecommendationDetailsDialog from '../../components/governance/RecommendationDetailsDialog';
import { AccessControl } from '../../components/auth/AccessControl';

const CouncilTrackingPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const recommendations = useSelector(selectRecommendations);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const location = useLocation();
    const [initialBuilderData, setInitialBuilderData] = useState<RecommendationInitialData | null>(null);

    // Check for navigation state to open builder automatically
    useEffect(() => {
        if (location.state && location.state.createRecommendation) {
            setInitialBuilderData(location.state.createRecommendation);
            setIsBuilderOpen(true);
            // Clear state to prevent reopening on refresh (optional, but good practice)
            window.history.replaceState({}, document.title);
        }
    }, [location]);

    // Details Dialog State
    const [selectedRec, setSelectedRec] = useState<CouncilRecommendation | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    // Delete Confirmation State
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [recToDelete, setRecToDelete] = useState<string | null>(null);

    useEffect(() => {
        dispatch(fetchRecommendations());
    }, [dispatch]);

    const handleDeleteClick = (id: string) => {
        setRecToDelete(id);
        setDeleteConfirmOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (recToDelete) {
            await dispatch(deleteRecommendation(recToDelete)).unwrap();
            setRecToDelete(null);
            setDeleteConfirmOpen(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'accepted': return 'success';
            case 'rejected': return 'error';
            case 'modified': return 'warning';
            case 'deferred': return 'info';
            default: return 'default';
        }
    };

    const handleOpenDetails = (rec: CouncilRecommendation) => {
        setSelectedRec(rec);
        setIsDetailsOpen(true);
    };

    // Calculate stats
    const total = recommendations.length;
    const accepted = recommendations.filter(r => r.status === 'accepted').length;
    const acceptanceRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Suivi des Recommandations au Conseil
                </Typography>
                <AccessControl allowedRoles={['coordinator']}>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        color="primary"
                        onClick={() => setIsBuilderOpen(true)}
                    >
                        Nouvelle Recommandation
                    </Button>
                </AccessControl>
            </Box>

            <Grid container spacing={3} mb={3}>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card>
                        <CardContent>
                            <Typography color="textSecondary" gutterBottom>
                                Taux d'Acceptation Global
                            </Typography>
                            <Typography variant="h3">
                                {acceptanceRate}%
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card>
                        <CardContent>
                            <Typography color="textSecondary" gutterBottom>
                                En attente de réponse
                            </Typography>
                            <Typography variant="h3">
                                {recommendations.filter((r: CouncilRecommendation) => r.status === 'pending').length}
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Date CCE</TableCell>
                            <TableCell>Réf. Extrait</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell>Projet Lié</TableCell>
                            <TableCell>Envoyé le</TableCell>
                            <TableCell>Statut Conseil</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {recommendations.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center">
                                    Aucune recommandation trouvée.
                                </TableCell>
                            </TableRow>
                        ) : (
                            recommendations.map((rec: CouncilRecommendation) => (
                                <TableRow key={rec.id}>
                                    <TableCell>
                                        {rec.meetingDate ? new Date(rec.meetingDate).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell>
                                        {rec.sourceResolutionNumber ? (
                                            <Chip label={rec.sourceResolutionNumber} size="small" variant="outlined" />
                                        ) : '-'}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                            {rec.description.length > 60 ? rec.description.substring(0, 60) + '...' : rec.description}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{rec.projectName || '-'}</TableCell>
                                    <TableCell>{rec.dateSent}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={rec.status === 'pending' ? 'En attente' : rec.status.toUpperCase()}
                                            color={getStatusColor(rec.status) as any}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        <AccessControl allowedRoles={['coordinator', 'president', 'elected_official']}>
                                            <Button size="small" onClick={() => handleOpenDetails(rec)}>Détails</Button>
                                        </AccessControl>
                                        <AccessControl allowedRoles={['coordinator']}>
                                            <IconButton size="small" color="error" onClick={() => handleDeleteClick(rec.id)} title="Supprimer la recommandation">
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </AccessControl>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog
                open={isBuilderOpen}
                onClose={() => setIsBuilderOpen(false)}
                maxWidth="md"
                fullWidth
            >
                <RecommendationBuilder
                    onClose={() => {
                        setIsBuilderOpen(false);
                        setInitialBuilderData(null);
                        dispatch(fetchRecommendations());
                    }}
                    initialData={initialBuilderData}
                />
            </Dialog>

            <RecommendationDetailsDialog
                key={selectedRec?.id || 'dialog'}
                open={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                recommendation={selectedRec}
            />

            <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
                <Box sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom color="error">Confirmer la suppression</Typography>
                    <Typography variant="body1" mb={3}>Êtes-vous sûr de vouloir supprimer cette recommandation ? Cette action est irréversible.</Typography>
                    <Box display="flex" justifyContent="flex-end" gap={2}>
                        <Button onClick={() => setDeleteConfirmOpen(false)}>Annuler</Button>
                        <Button variant="contained" color="error" onClick={handleConfirmDelete}>Supprimer</Button>
                    </Box>
                </Box>
            </Dialog>
        </Box>
    );
};

export default CouncilTrackingPage;
