import React, { useEffect, useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    Chip,
    Alert,
    CircularProgress,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Divider,
    Collapse,
    IconButton,
    Button,
    Tooltip
} from '@mui/material';
import {
    CheckCircle,
    Pending,
    Warning,
    ExpandMore,
    ExpandLess,
    Person,
    Comment,
    Done,
    Delete,
    Refresh
} from '@mui/icons-material';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

interface ApprovalToken {
    id: string;
    name: string;
    role: string;
    token: string;
    status?: 'pending' | 'approved' | 'changes_requested';
    comments?: string;
    createdAt: string;
    approvedAt?: string;
    updatedAt?: string;
    expiresAt: string;
    used: boolean;
}

interface ApprovalRequestsPanelProps {
    meetingId: string;
}

const ApprovalRequestsPanel: React.FC<ApprovalRequestsPanelProps> = ({ meetingId }) => {
    const [approvals, setApprovals] = useState<ApprovalToken[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Mark change request as handled (set status back to pending for re-approval)
    const handleResendRequest = async (approvalId: string) => {
        try {
            setActionLoading(approvalId);
            const approvalRef = doc(db, 'meetings', meetingId, 'approval_tokens', approvalId);
            await updateDoc(approvalRef, {
                status: 'pending',
                comments: '',
                updatedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error('Error resetting approval:', err);
            alert('Erreur lors de la reinitialisation');
        } finally {
            setActionLoading(null);
        }
    };

    // Mark as fully approved by coordinator (override)
    const handleAcceptChanges = async (approvalId: string) => {
        try {
            setActionLoading(approvalId);
            const approvalRef = doc(db, 'meetings', meetingId, 'approval_tokens', approvalId);
            await updateDoc(approvalRef, {
                status: 'approved',
                approvedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error('Error accepting changes:', err);
            alert('Erreur lors de l\'acceptation');
        } finally {
            setActionLoading(null);
        }
    };

    // Delete the approval request
    const handleDismiss = async (approvalId: string) => {
        if (!window.confirm('Supprimer cette demande d\'approbation ?')) return;
        try {
            setActionLoading(approvalId);
            const approvalRef = doc(db, 'meetings', meetingId, 'approval_tokens', approvalId);
            await deleteDoc(approvalRef);
        } catch (err) {
            console.error('Error deleting approval:', err);
            alert('Erreur lors de la suppression');
        } finally {
            setActionLoading(null);
        }
    };

    useEffect(() => {
        if (!meetingId) return;

        const approvalsRef = collection(db, 'meetings', meetingId, 'approval_tokens');
        const q = query(approvalsRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const approvalData: ApprovalToken[] = [];
            snapshot.forEach((doc) => {
                approvalData.push({ id: doc.id, ...doc.data() } as ApprovalToken);
            });
            setApprovals(approvalData);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching approvals:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [meetingId]);

    const getStatusIcon = (status?: string) => {
        switch (status) {
            case 'approved':
                return <CheckCircle color="success" />;
            case 'changes_requested':
                return <Warning color="warning" />;
            default:
                return <Pending color="disabled" />;
        }
    };

    const getStatusChip = (status?: string) => {
        switch (status) {
            case 'approved':
                return <Chip label="Approuve" color="success" size="small" />;
            case 'changes_requested':
                return <Chip label="Modifications demandees" color="warning" size="small" />;
            default:
                return <Chip label="En attente" color="default" size="small" />;
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString('fr-CA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    };

    if (loading) {
        return (
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
                <Box display="flex" justifyContent="center" alignItems="center" py={3}>
                    <CircularProgress size={24} />
                    <Typography sx={{ ml: 2 }}>Chargement des demandes d'approbation...</Typography>
                </Box>
            </Paper>
        );
    }

    if (approvals.length === 0) {
        return null; // Don't show panel if no approvals
    }

    const changesRequested = approvals.filter(a => a.status === 'changes_requested');
    const approved = approvals.filter(a => a.status === 'approved');
    const pending = approvals.filter(a => !a.status || a.status === 'pending');

    return (
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
            <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                sx={{ cursor: 'pointer' }}
                onClick={() => setExpanded(!expanded)}
            >
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CheckCircle color="primary" />
                    Demandes d'approbation ({approvals.length})
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                    {changesRequested.length > 0 && (
                        <Chip
                            label={`${changesRequested.length} modification(s)`}
                            color="warning"
                            size="small"
                        />
                    )}
                    {approved.length > 0 && (
                        <Chip
                            label={`${approved.length} approuve(s)`}
                            color="success"
                            size="small"
                        />
                    )}
                    {pending.length > 0 && (
                        <Chip
                            label={`${pending.length} en attente`}
                            color="default"
                            size="small"
                        />
                    )}
                    <IconButton size="small">
                        {expanded ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                </Box>
            </Box>

            <Collapse in={expanded}>
                {changesRequested.length > 0 && (
                    <Alert severity="warning" sx={{ mt: 2, mb: 2 }}>
                        <strong>{changesRequested.length} membre(s)</strong> ont demande des modifications au PV.
                    </Alert>
                )}

                <List sx={{ mt: 2 }}>
                    {approvals.map((approval, index) => (
                        <React.Fragment key={approval.id}>
                            {index > 0 && <Divider component="li" />}
                            <ListItem
                                alignItems="flex-start"
                                sx={{
                                    bgcolor: approval.status === 'changes_requested' ? 'warning.light' : 'transparent',
                                    borderRadius: 1,
                                    mb: 1
                                }}
                            >
                                <ListItemIcon>
                                    {getStatusIcon(approval.status)}
                                </ListItemIcon>
                                <ListItemText
                                    primary={
                                        <Box display="flex" justifyContent="space-between" alignItems="center">
                                            <Typography variant="subtitle1" fontWeight="bold">
                                                <Person sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                                                {approval.name}
                                            </Typography>
                                            {getStatusChip(approval.status)}
                                        </Box>
                                    }
                                    secondary={
                                        <Box>
                                            <Typography variant="body2" color="text.secondary">
                                                Role: {approval.role} | Envoye: {formatDate(approval.createdAt)}
                                            </Typography>
                                            {approval.status === 'approved' && approval.approvedAt && (
                                                <Typography variant="body2" color="success.main">
                                                    Approuve le {formatDate(approval.approvedAt)}
                                                </Typography>
                                            )}
                                            {approval.status === 'changes_requested' && approval.updatedAt && (
                                                <Typography variant="body2" color="warning.main">
                                                    Modifie le {formatDate(approval.updatedAt)}
                                                </Typography>
                                            )}
                                            {approval.comments && (
                                                <Box
                                                    sx={{
                                                        mt: 1,
                                                        p: 1.5,
                                                        bgcolor: 'background.paper',
                                                        borderLeft: '3px solid',
                                                        borderColor: approval.status === 'changes_requested' ? 'warning.main' : 'success.main',
                                                        borderRadius: 1
                                                    }}
                                                >
                                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                                        <Comment fontSize="small" />
                                                        <strong>Commentaires:</strong>
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                                        {approval.comments}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {/* Action buttons for coordinator */}
                                            <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                                {approval.status === 'changes_requested' && (
                                                    <>
                                                        <Tooltip title="Marquer comme traite et renvoyer le lien d'approbation">
                                                            <Button
                                                                size="small"
                                                                variant="outlined"
                                                                color="primary"
                                                                startIcon={<Refresh />}
                                                                onClick={() => handleResendRequest(approval.id)}
                                                                disabled={actionLoading === approval.id}
                                                            >
                                                                Reinitialiser
                                                            </Button>
                                                        </Tooltip>
                                                        <Tooltip title="Approuver malgre les commentaires">
                                                            <Button
                                                                size="small"
                                                                variant="contained"
                                                                color="success"
                                                                startIcon={<Done />}
                                                                onClick={() => handleAcceptChanges(approval.id)}
                                                                disabled={actionLoading === approval.id}
                                                            >
                                                                Accepter
                                                            </Button>
                                                        </Tooltip>
                                                    </>
                                                )}
                                                <Tooltip title="Supprimer cette demande">
                                                    <IconButton
                                                        size="small"
                                                        color="error"
                                                        onClick={() => handleDismiss(approval.id)}
                                                        disabled={actionLoading === approval.id}
                                                    >
                                                        <Delete fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </Box>
                                    }
                                />
                            </ListItem>
                        </React.Fragment>
                    ))}
                </List>
            </Collapse>
        </Paper>
    );
};

export default ApprovalRequestsPanel;
