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
    IconButton,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    LinearProgress
} from '@mui/material';
import {
    Add as AddIcon,
    Delete as DeleteIcon,
    ViewKanban as KanbanIcon,
    TableRows as TableIcon,
    CheckCircle as AcceptIcon,
    Cancel as RejectIcon,
    HourglassEmpty as DeferIcon,
    BorderColor as ModifyIcon,
    AccessTime as PendingIcon
} from '@mui/icons-material';
import type { AppDispatch } from '../../store/store';
import { fetchRecommendations, selectRecommendations, deleteRecommendation, updateRecommendation } from '../../features/governance/governanceSlice';
import type { CouncilRecommendation } from '../../types/recommendation.types';
import RecommendationBuilder from '../../components/governance/RecommendationBuilder';
import type { RecommendationInitialData } from '../../components/governance/RecommendationBuilder';
import { useLocation } from 'react-router-dom';
import RecommendationDetailsDialog from '../../components/governance/RecommendationDetailsDialog';
import { AccessControl } from '../../components/auth/AccessControl';
import { useAuth } from '../../hooks/useAuth';

const COLUMNS: Array<{ status: CouncilRecommendation['status']; label: string; color: string; bgColor: string; borderColor: string; icon: React.ReactNode }> = [
    { status: 'pending', label: 'En attente', color: '#757575', bgColor: 'rgba(117, 117, 117, 0.04)', borderColor: '#757575', icon: <PendingIcon fontSize="small" sx={{ color: '#757575' }} /> },
    { status: 'deferred', label: 'Reportée', color: '#0288d1', bgColor: 'rgba(2, 136, 209, 0.04)', borderColor: '#0288d1', icon: <DeferIcon fontSize="small" sx={{ color: '#0288d1' }} /> },
    { status: 'accepted', label: 'Acceptée', color: '#2e7d32', bgColor: 'rgba(46, 125, 50, 0.04)', borderColor: '#2e7d32', icon: <AcceptIcon fontSize="small" sx={{ color: '#2e7d32' }} /> },
    { status: 'modified', label: 'Acceptée avec modif.', color: '#ed6c02', bgColor: 'rgba(237, 108, 2, 0.04)', borderColor: '#ed6c02', icon: <ModifyIcon fontSize="small" sx={{ color: '#ed6c02' }} /> },
    { status: 'rejected', label: 'Refusée', color: '#d32f2f', bgColor: 'rgba(211, 47, 47, 0.04)', borderColor: '#d32f2f', icon: <RejectIcon fontSize="small" sx={{ color: '#d32f2f' }} /> }
];

const CouncilTrackingPage: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const recommendations = useSelector(selectRecommendations);
    const { user } = useAuth();
    const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
    const [activeDragColumn, setActiveDragColumn] = useState<string | null>(null);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const location = useLocation();
    const [initialBuilderData, setInitialBuilderData] = useState<RecommendationInitialData | null>(null);

    // Details Dialog State
    const [selectedRec, setSelectedRec] = useState<CouncilRecommendation | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    // Delete Confirmation State
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [recToDelete, setRecToDelete] = useState<string | null>(null);

    // Check for navigation state to open builder automatically
    useEffect(() => {
        if (location.state && location.state.createRecommendation) {
            setInitialBuilderData(location.state.createRecommendation);
            setIsBuilderOpen(true);
            // Clear state to prevent reopening on refresh (optional, but good practice)
            window.history.replaceState({}, document.title);
        }
    }, [location]);

    useEffect(() => {
        dispatch(fetchRecommendations());
    }, [dispatch]);

    const handleDeleteClick = (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent opening details dialog
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

    const handleOpenDetails = (rec: CouncilRecommendation) => {
        setSelectedRec(rec);
        setIsDetailsOpen(true);
    };

    // Quick Action Trigger
    const handleStatusChange = async (id: string, newStatus: CouncilRecommendation['status'], e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent opening details dialog
        try {
            await dispatch(updateRecommendation({ id, updates: { status: newStatus } })).unwrap();
        } catch (error) {
            console.error("Status update failed:", error);
        }
    };

    // HTML5 Drag and Drop API
    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = async (e: React.DragEvent, newStatus: CouncilRecommendation['status']) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) {
            try {
                await dispatch(updateRecommendation({ id, updates: { status: newStatus } })).unwrap();
            } catch (error) {
                console.error("Drop status update failed:", error);
            }
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

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending': return 'En attente';
            case 'accepted': return 'Acceptée';
            case 'rejected': return 'Refusée';
            case 'modified': return 'Modifiée';
            case 'deferred': return 'Reportée';
            default: return status.toUpperCase();
        }
    };

    // Calculate stats
    const total = recommendations.length;
    const accepted = recommendations.filter(r => r.status === 'accepted').length;
    const modified = recommendations.filter(r => r.status === 'modified').length;
    const totalApproved = accepted + modified;
    const acceptanceRate = total > 0 ? Math.round((totalApproved / total) * 100) : 0;
    const pendingCount = recommendations.filter(r => r.status === 'pending').length;

    return (
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', minHeight: '85vh' }}>
            {/* Page Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
                <Box>
                    <Typography variant="h4" component="h1" fontWeight="bold" sx={{ color: '#1e4e3d' }}>
                        Suivi des Recommandations au Conseil
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                        Pilotez l'avancement et le taux d'adoption des avis environnementaux du CCE par le Conseil de Ville.
                    </Typography>
                </Box>
                <Box display="flex" alignItems="center" gap={2}>
                    <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={(_, value) => value && setViewMode(value)}
                        size="small"
                        sx={{ bgcolor: 'white' }}
                    >
                        <ToggleButton value="kanban" sx={{ '&.Mui-selected': { bgcolor: '#1e4e3d', color: 'white', '&:hover': { bgcolor: '#143529' } } }}>
                            <KanbanIcon sx={{ mr: 1, fontSize: 18 }} /> Pipeline
                        </ToggleButton>
                        <ToggleButton value="table" sx={{ '&.Mui-selected': { bgcolor: '#1e4e3d', color: 'white', '&:hover': { bgcolor: '#143529' } } }}>
                            <TableIcon sx={{ mr: 1, fontSize: 18 }} /> Tableau
                        </ToggleButton>
                    </ToggleButtonGroup>
                    <AccessControl allowedRoles={['coordinator']}>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => setIsBuilderOpen(true)}
                            sx={{ bgcolor: '#1e4e3d', '&:hover': { bgcolor: '#143529' } }}
                        >
                            Nouvelle Recommandation
                        </Button>
                    </AccessControl>
                </Box>
            </Box>

            {/* KPI Cards Dashboard */}
            <Grid container spacing={3} mb={4}>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ borderLeft: '4px solid #c5a065', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                        <CardContent sx={{ pb: '16px !important' }}>
                            <Typography color="textSecondary" variant="subtitle2" fontWeight="medium" gutterBottom>
                                Taux d'Adoption Global
                            </Typography>
                            <Box display="flex" alignItems="baseline" justifyContent="space-between" mb={1}>
                                <Typography variant="h3" fontWeight="bold" color="#1e4e3d">
                                    {acceptanceRate}%
                                </Typography>
                                <Typography variant="body2" color="textSecondary">
                                    {totalApproved} / {total} avis acceptés
                                </Typography>
                            </Box>
                            <LinearProgress
                                variant="determinate"
                                value={acceptanceRate}
                                sx={{
                                    height: 8,
                                    borderRadius: 4,
                                    bgcolor: '#e0e0e0',
                                    '& .MuiLinearProgress-bar': { bgcolor: '#c5a065' }
                                }}
                            />
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ borderLeft: '4px solid #757575', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="subtitle2" fontWeight="medium" gutterBottom>
                                En attente de réponse municipale
                            </Typography>
                            <Typography variant="h3" fontWeight="bold" color="#333333">
                                {pendingCount}
                            </Typography>
                            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                                Recommandations actives transmises au Conseil de Ville
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ borderLeft: '4px solid #0288d1', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="subtitle2" fontWeight="medium" gutterBottom>
                                Décisions Reportées
                            </Typography>
                            <Typography variant="h3" fontWeight="bold" color="#0288d1">
                                {recommendations.filter(r => r.status === 'deferred').length}
                            </Typography>
                            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                                Sujets en suspens nécessitant des clarifications
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* VIEW MODE: KANBAN WORKFLOW PIPELINE */}
            {viewMode === 'kanban' ? (
                <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Grid container spacing={2} sx={{ flexGrow: 1, flexWrap: { xs: 'wrap', lg: 'nowrap' }, minHeight: 600 }}>
                        {COLUMNS.map((col) => {
                            const colRecs = recommendations.filter(r => r.status === col.status);
                            const isColumnHovered = activeDragColumn === col.status;

                            return (
                                <Grid
                                    key={col.status}
                                    size={{ xs: 12, lg: 2.4 }}
                                    sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        minWidth: { lg: 240 },
                                        height: '100%'
                                    }}
                                >
                                    {/* Column Header */}
                                    <Paper
                                        elevation={0}
                                        sx={{
                                            p: 2,
                                            mb: 2,
                                            borderTop: `4px solid ${col.color}`,
                                            bgcolor: '#ffffff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                                            borderRadius: 1
                                        }}
                                    >
                                        <Box display="flex" alignItems="center" gap={1}>
                                            {col.icon}
                                            <Typography variant="subtitle2" fontWeight="bold">
                                                {col.label}
                                            </Typography>
                                        </Box>
                                        <Chip
                                            label={colRecs.length}
                                            size="small"
                                            sx={{
                                                bgcolor: col.bgColor,
                                                color: col.color,
                                                fontWeight: 'bold',
                                                fontSize: '0.75rem'
                                            }}
                                        />
                                    </Paper>

                                    {/* Column Body Container */}
                                    <Paper
                                        elevation={0}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            if (user?.role === 'coordinator') {
                                                setActiveDragColumn(col.status);
                                            }
                                        }}
                                        onDragLeave={() => setActiveDragColumn(null)}
                                        onDrop={(e) => {
                                            if (user?.role === 'coordinator') {
                                                handleDrop(e, col.status);
                                            }
                                            setActiveDragColumn(null);
                                        }}
                                        sx={{
                                            p: 1.5,
                                            flexGrow: 1,
                                            bgcolor: isColumnHovered ? 'rgba(30, 78, 61, 0.05)' : col.bgColor,
                                            border: isColumnHovered 
                                                ? `2px dashed #1e4e3d` 
                                                : `1px solid rgba(0, 0, 0, 0.04)`,
                                            borderRadius: 2,
                                            minHeight: 400,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 1.5,
                                            transition: 'all 0.2s ease-in-out',
                                            overflowY: 'auto'
                                        }}
                                    >
                                        {colRecs.length === 0 ? (
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexGrow: 1,
                                                    color: 'text.secondary',
                                                    border: '1px dashed #cccccc',
                                                    borderRadius: 1,
                                                    p: 2,
                                                    textAlign: 'center',
                                                    minHeight: 150
                                                }}
                                            >
                                                <Typography variant="caption" color="textSecondary">
                                                    Glisser-déposer ici
                                                </Typography>
                                            </Box>
                                        ) : (
                                            colRecs.map((rec) => (
                                                <Card
                                                    key={rec.id}
                                                    draggable={user?.role === 'coordinator'}
                                                    onDragStart={(e) => handleDragStart(e, rec.id)}
                                                    onClick={() => handleOpenDetails(rec)}
                                                    sx={{
                                                        cursor: 'pointer',
                                                        boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                                                        border: '1px solid rgba(0,0,0,0.05)',
                                                        '&:hover': {
                                                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                                            borderColor: '#1e4e3d'
                                                        },
                                                        transition: 'all 0.15s ease-in-out',
                                                        position: 'relative',
                                                        borderRadius: 1.5,
                                                        bgcolor: '#ffffff'
                                                    }}
                                                >
                                                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                                            <Typography variant="caption" color="textSecondary" fontWeight="bold">
                                                                {rec.meetingDate ? new Date(rec.meetingDate).toLocaleDateString('fr-CA') : 'Date inconnue'}
                                                            </Typography>
                                                            {rec.sourceResolutionNumber && (
                                                                <Chip
                                                                    label={`#${rec.sourceResolutionNumber}`}
                                                                    size="small"
                                                                    variant="outlined"
                                                                    sx={{ height: 16, fontSize: '0.65rem', color: '#1e4e3d', borderColor: '#1e4e3d', fontWeight: 'bold' }}
                                                                />
                                                            )}
                                                        </Box>

                                                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="#333333">
                                                            {rec.projectName || 'Avis CCE'}
                                                        </Typography>

                                                        <Typography
                                                            variant="body2"
                                                            color="textSecondary"
                                                            paragraph
                                                            sx={{
                                                                display: '-webkit-box',
                                                                overflow: 'hidden',
                                                                WebkitBoxOrient: 'vertical',
                                                                WebkitLineClamp: 3,
                                                                fontSize: '0.8rem',
                                                                mb: 1.5
                                                            }}
                                                        >
                                                            {rec.description}
                                                        </Typography>

                                                        {/* Decision Support Badges */}
                                                        {rec.impactAnalysis && (rec.impactAnalysis.environmentalImpact || rec.impactAnalysis.implementationEffort) && (
                                                            <Box display="flex" gap={0.5} flexWrap="wrap" mb={2}>
                                                                {rec.impactAnalysis.environmentalImpact && (
                                                                    <Chip
                                                                        label={`Env: ${rec.impactAnalysis.environmentalImpact === 'positive' ? 'Positif' : rec.impactAnalysis.environmentalImpact === 'neutral' ? 'Neutre' : 'Négatif'}`}
                                                                        size="small"
                                                                        variant="outlined"
                                                                        color={rec.impactAnalysis.environmentalImpact === 'positive' ? 'success' : rec.impactAnalysis.environmentalImpact === 'neutral' ? 'warning' : 'error'}
                                                                        sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'medium' }}
                                                                    />
                                                                )}
                                                                {rec.impactAnalysis.implementationEffort && (
                                                                    <Chip
                                                                        label={`Effort: ${rec.impactAnalysis.implementationEffort === 'low' ? 'Faible' : rec.impactAnalysis.implementationEffort === 'medium' ? 'Moyen' : 'Élevé'}`}
                                                                        size="small"
                                                                        variant="outlined"
                                                                        color={rec.impactAnalysis.implementationEffort === 'low' ? 'success' : rec.impactAnalysis.implementationEffort === 'medium' ? 'warning' : 'error'}
                                                                        sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'medium' }}
                                                                    />
                                                                )}
                                                            </Box>
                                                        )}

                                                        {/* Quick Action Touch Buttons & Delete */}
                                                        <Box display="flex" alignItems="center" justifyContent="space-between" pt={1} borderTop="1px solid #f1f5f1">
                                                            <Box display="flex" gap={0.5}>
                                                                <AccessControl allowedRoles={['coordinator']}>
                                                                    {col.status !== 'pending' && (
                                                                        <Tooltip title="Mettre En attente">
                                                                            <IconButton size="small" onClick={(e) => handleStatusChange(rec.id, 'pending', e)} sx={{ p: 0.5, color: '#757575' }}>
                                                                                <PendingIcon fontSize="inherit" />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                                    {col.status !== 'deferred' && (
                                                                        <Tooltip title="Mettre Reportée">
                                                                            <IconButton size="small" onClick={(e) => handleStatusChange(rec.id, 'deferred', e)} sx={{ p: 0.5, color: '#0288d1' }}>
                                                                                <DeferIcon fontSize="inherit" />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                                    {col.status !== 'accepted' && (
                                                                        <Tooltip title="Mettre Acceptée">
                                                                            <IconButton size="small" onClick={(e) => handleStatusChange(rec.id, 'accepted', e)} sx={{ p: 0.5, color: '#2e7d32' }}>
                                                                                <AcceptIcon fontSize="inherit" />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                                    {col.status !== 'modified' && (
                                                                        <Tooltip title="Mettre Acceptée avec modifications">
                                                                            <IconButton size="small" onClick={(e) => handleStatusChange(rec.id, 'modified', e)} sx={{ p: 0.5, color: '#ed6c02' }}>
                                                                                <ModifyIcon fontSize="inherit" />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                                    {col.status !== 'rejected' && (
                                                                        <Tooltip title="Mettre Refusée">
                                                                            <IconButton size="small" onClick={(e) => handleStatusChange(rec.id, 'rejected', e)} sx={{ p: 0.5, color: '#d32f2f' }}>
                                                                                <RejectIcon fontSize="inherit" />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                                </AccessControl>
                                                            </Box>
                                                            <Box display="flex">
                                                                <Button size="small" onClick={() => handleOpenDetails(rec)} sx={{ minWidth: 0, p: 0, textTransform: 'none', color: '#1e4e3d', fontWeight: 'bold', fontSize: '0.75rem' }}>
                                                                    Détails
                                                                </Button>
                                                                <AccessControl allowedRoles={['coordinator']}>
                                                                    <IconButton size="small" color="error" onClick={(e) => handleDeleteClick(rec.id, e)} title="Supprimer la recommandation" sx={{ ml: 1, p: 0.5 }}>
                                                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                </AccessControl>
                                                            </Box>
                                                        </Box>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}
                                    </Paper>
                                </Grid>
                            );
                        })}
                    </Grid>
                </Box>
            ) : (
                /* VIEW MODE: CLASSIC TABULAR TABLE */
                <TableContainer component={Paper} sx={{ boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderRadius: 2 }}>
                    <Table>
                        <TableHead sx={{ bgcolor: 'background.default' }}>
                            <TableRow>
                                <TableCell><strong>Date CCE</strong></TableCell>
                                <TableCell><strong>Réf. Extrait</strong></TableCell>
                                <TableCell><strong>Description</strong></TableCell>
                                <TableCell><strong>Projet Lié</strong></TableCell>
                                <TableCell><strong>Envoyé le</strong></TableCell>
                                <TableCell><strong>Statut Conseil</strong></TableCell>
                                <TableCell align="right"><strong>Actions</strong></TableCell>
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
                                    <TableRow key={rec.id} hover onClick={() => handleOpenDetails(rec)} sx={{ cursor: 'pointer' }}>
                                        <TableCell>
                                            {rec.meetingDate ? new Date(rec.meetingDate).toLocaleDateString() : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {rec.sourceResolutionNumber ? (
                                                <Chip label={rec.sourceResolutionNumber} size="small" variant="outlined" sx={{ fontWeight: 'bold' }} />
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                                {rec.description.length > 80 ? rec.description.substring(0, 80) + '...' : rec.description}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>{rec.projectName || '-'}</TableCell>
                                        <TableCell>{rec.dateSent}</TableCell>
                                        <TableCell>
                                            <Chip
                                                label={getStatusLabel(rec.status)}
                                                color={getStatusColor(rec.status) as any}
                                                size="small"
                                                variant="outlined"
                                                sx={{ fontWeight: 'bold' }}
                                            />
                                        </TableCell>
                                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                            <Box display="flex" justifyContent="flex-end" alignItems="center">
                                                <Button size="small" onClick={() => handleOpenDetails(rec)} sx={{ color: '#1e4e3d' }}>
                                                    Détails
                                                </Button>
                                                <AccessControl allowedRoles={['coordinator']}>
                                                    <IconButton size="small" color="error" onClick={(e) => handleDeleteClick(rec.id, e)} title="Supprimer la recommandation">
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </AccessControl>
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Recommendation Builder Dialog (New/Edit) */}
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

            {/* Details and Actions Dialog */}
            <RecommendationDetailsDialog
                key={selectedRec?.id || 'dialog'}
                open={isDetailsOpen}
                onClose={() => {
                    setIsDetailsOpen(false);
                    setSelectedRec(null);
                }}
                recommendation={selectedRec}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
                <Box sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom color="error" fontWeight="bold">
                        Confirmer la suppression
                    </Typography>
                    <Typography variant="body1" mb={3}>
                        Êtes-vous sûr de vouloir supprimer cette recommandation au Conseil ? Cette action supprimera également son historique de suivi.
                    </Typography>
                    <Box display="flex" justifyContent="flex-end" gap={2}>
                        <Button onClick={() => setDeleteConfirmOpen(false)}>Annuler</Button>
                        <Button variant="contained" color="error" onClick={handleConfirmDelete}>
                            Supprimer
                        </Button>
                    </Box>
                </Box>
            </Dialog>
        </Box>
    );
};

export default CouncilTrackingPage;
