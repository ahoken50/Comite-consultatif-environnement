import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    Box,
    Container,
    Typography,
    Paper,
    Button,
    CircularProgress,
    Alert,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Divider,
    Card,
    CardContent
} from '@mui/material';
import { CheckCircle, Edit, InfoOutlined } from '@mui/icons-material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, functions } from '../../services/firebase';
import { httpsCallable } from 'firebase/functions';
import type { Meeting } from '../../types/meeting.types';
import DOMPurify from 'dompurify';

const ApprovalPage: React.FC = () => {
    const { meetingId, token } = useParams<{ meetingId: string; token: string }>();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [approvalData, setApprovalData] = useState<any>(null);

    // Comments state
    const [itemComments, setItemComments] = useState<Record<string, string>>({});
    const [generalComment, setGeneralComment] = useState('');

    const [showRejectDialog, setShowRejectDialog] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Re-implementing correctly with Query
    useEffect(() => {
        const fetchContext = async () => {
            if (!meetingId || !token) {
                setError("Paramètres manquants.");
                setLoading(false);
                return;
            }

            try {
                const { collection, query, where, getDocs } = await import('firebase/firestore');

                // 1. Validate Token - must match collection name used in Cloud Function
                const approvalsRef = collection(db, 'meetings', meetingId, 'approval_tokens');
                const q = query(approvalsRef, where('token', '==', token));
                const snapshot = await getDocs(q);

                if (snapshot.empty) {
                    setError("Lien invalide ou expiré.");
                    setLoading(false);
                    return;
                }

                const approvalDoc = snapshot.docs[0];
                const data = approvalDoc.data();

                // Check expiry
                if (new Date(data.expiresAt) < new Date()) {
                    setError("Ce lien a expiré.");
                    setLoading(false);
                    return;
                }

                if (data.status === 'approved') {
                    setSuccessMessage("Vous avez déjà approuvé ce procès-verbal.");
                }

                setApprovalData({ id: approvalDoc.id, ...data });

                // 2. Fetch Meeting
                const meetingRef = doc(db, 'meetings', meetingId);
                const meetingSnap = await getDoc(meetingRef);

                if (meetingSnap.exists()) {
                    const meetingData = meetingSnap.data();
                    const normalizedMeeting = {
                        id: meetingSnap.id,
                        ...meetingData,
                        date: meetingData.date?.toDate ? meetingData.date.toDate().toISOString() : meetingData.date,
                        dateCreated: meetingData.dateCreated?.toDate ? meetingData.dateCreated.toDate().toISOString() : meetingData.dateCreated,
                        dateUpdated: meetingData.dateUpdated?.toDate ? meetingData.dateUpdated.toDate().toISOString() : meetingData.dateUpdated,
                    } as Meeting;
                    setMeeting(normalizedMeeting);
                } else {
                    setError("Réunion introuvable.");
                }

            } catch (err) {
                console.error("Error fetching approval context:", err);
                setError("Impossible de vérifier le lien.");
            } finally {
                setLoading(false);
            }
        };

        fetchContext();
    }, [meetingId, token]);

    const handleItemCommentChange = (itemId: string, value: string) => {
        setItemComments(prev => ({
            ...prev,
            [itemId]: value
        }));
    };

    const getAggregatedComments = (): string => {
        let aggregated = '';

        // Add item-specific comments
        if (meeting?.agendaItems) {
            meeting.agendaItems.forEach(item => {
                const comment = itemComments[item.id];
                if (comment?.trim()) {
                    aggregated += `[${item.title}]:\n${comment.trim()}\n\n`;
                }
            });
        }

        // Add general comment
        if (generalComment.trim()) {
            aggregated += `Commentaire général:\n${generalComment.trim()}`;
        }

        return aggregated.trim();
    };

    const handleApprove = async () => {
        setActionLoading(true);
        try {
            const aggregatedComments = getAggregatedComments();

            // Update approval status in approval_tokens collection
            const approvalRef = doc(db, 'meetings', meetingId!, 'approval_tokens', approvalData.id);
            await updateDoc(approvalRef, {
                status: 'approved',
                approvedAt: new Date().toISOString(),
                comments: aggregatedComments
            });

            // Send notification to coordinator
            try {
                const sendNotification = httpsCallable(functions, 'send_approval_notification');
                await sendNotification({
                    meetingId,
                    meetingTitle: meeting?.title || 'Réunion',
                    reviewerName: approvalData?.name || 'Réviseur',
                    comments: aggregatedComments || 'Aucun commentaire',
                    type: 'approved'
                });
            } catch (notifErr) {
                console.error('Failed to send notification:', notifErr);
            }

            setSuccessMessage("Merci ! Votre approbation a été enregistrée avec succès.");
        } catch (err) {
            console.error(err);
            alert("Erreur lors de l'approbation.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleRequestChanges = async () => {
        const aggregatedComments = getAggregatedComments();

        if (!aggregatedComments) {
            alert("Veuillez expliquer les modifications souhaitées dans les champs de commentaires appropriés.");
            return;
        }

        setActionLoading(true);
        try {
            const approvalRef = doc(db, 'meetings', meetingId!, 'approval_tokens', approvalData.id);
            await updateDoc(approvalRef, {
                status: 'changes_requested',
                updatedAt: new Date().toISOString(),
                comments: aggregatedComments
            });

            // Send notification to coordinator
            try {
                const sendNotification = httpsCallable(functions, 'send_approval_notification');
                await sendNotification({
                    meetingId,
                    meetingTitle: meeting?.title || 'Réunion',
                    reviewerName: approvalData?.name || 'Réviseur',
                    comments: aggregatedComments,
                    type: 'changes_requested'
                });
            } catch (notifErr) {
                console.error('Failed to send notification:', notifErr);
            }

            setSuccessMessage("Vos commentaires ont été envoyés au coordonnateur.");
            setShowRejectDialog(false);
        } catch (err) {
            console.error(err);
            alert("Erreur lors de l'envoi.");
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return (
            <Container sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
                <CircularProgress />
            </Container>
        );
    }

    if (error) {
        return (
            <Container maxWidth="sm" sx={{ mt: 10 }}>
                <Alert severity="error" variant="filled">
                    {error}
                </Alert>
            </Container>
        );
    }

    if (successMessage) {
        return (
            <Container maxWidth="sm" sx={{ mt: 10, textAlign: 'center' }}>
                <CheckCircle color="success" sx={{ fontSize: 80, mb: 2 }} />
                <Typography variant="h5" gutterBottom>
                    Action Confirmée
                </Typography>
                <Typography color="text.secondary" paragraph>
                    {successMessage}
                </Typography>
                <Button variant="outlined" onClick={() => window.close()}>
                    Fermer la fenêtre
                </Button>
            </Container>
        );
    }

    const hasStructuredMinutes = meeting?.agendaItems && meeting.agendaItems.some(item => item.minuteEntries && item.minuteEntries.length > 0);
    const isCircular = meeting?.type === 'circular';

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ mb: 4, textAlign: 'center' }}>
                <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: isCircular ? '#1e4e3d' : '#1976d2' }}>
                    {isCircular ? "Signature de la Résolution Écrite (PV Spécial)" : "Approbation du Procès-verbal"}
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    {meeting?.title} - {meeting?.date && !isNaN(new Date(meeting.date).getTime()) ? new Date(meeting.date).toLocaleDateString('fr-CA') : 'Date inconnue'}
                </Typography>
                {isCircular && (
                    <Typography variant="body2" color="error" sx={{ fontWeight: 'bold', mt: 1 }}>
                        ⚠️ Règle municipale : Accord unanime requis
                    </Typography>
                )}
                <Typography variant="body2" sx={{ mt: 1.5 }}>
                    Connecté en tant que : <strong>{approvalData?.name} ({
                        approvalData?.role === 'president' ? 'Présidente' : 
                        approvalData?.role === 'vice_president' ? 'Vice-Président' : 
                        approvalData?.role === 'elected_official' ? 'Élu(e) Responsable' : 
                        approvalData?.role === 'coordinator' ? 'Secrétaire (Coordonnateur)' : 
                        approvalData?.role === 'member' ? 'Membre' : 
                        approvalData?.role
                    })</strong>
                </Typography>
            </Box>

            {!hasStructuredMinutes && (
                <Paper elevation={3} sx={{ p: 4, mb: 4, minHeight: '50vh', bgcolor: '#fdfdfd' }}>
                    <Alert severity="info" sx={{ mb: 3 }}>
                        Ce procès-verbal utilise l'ancien format d'affichage. Vous pouvez laisser un commentaire global ci-dessous.
                    </Alert>
                    <div
                        className="minutes-content"
                        dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(meeting?.minutesDraft?.content || meeting?.minutes || "<p>Contenu non disponible.</p>")
                        }}
                    />
                </Paper>
            )}

            {hasStructuredMinutes && (
                <Box sx={{ mb: 4 }}>
                    <Typography variant="h5" gutterBottom sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <InfoOutlined color="primary" /> Vues par sujet
                    </Typography>

                    {meeting?.agendaItems.map((item, index) => (
                        <Card key={item.id} elevation={2} sx={{ mb: 3, overflow: 'visible' }}>
                            <CardContent sx={{ p: 3 }}>
                                <Typography variant="h6" color="primary" gutterBottom>
                                    {index + 1}. {item.title}
                                </Typography>

                                {item.description && (
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        {item.description}
                                    </Typography>
                                )}

                                {item.minuteEntries && item.minuteEntries.length > 0 ? (
                                    <Box sx={{ mt: 2, mb: 3, pl: 2, borderLeft: '3px solid #e0e0e0' }}>
                                        {item.minuteEntries.map((entry, idx) => (
                                            <Box key={idx} sx={{ mb: 2 }}>
                                                {entry.number && (
                                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                                        {entry.type === 'comment' ? 'Commentaire' : entry.type === 'note' ? 'Note' : 'Résolution'} {entry.number}
                                                    </Typography>
                                                )}
                                                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                                                    {entry.content}
                                                </Typography>
                                                {(entry.proposer || entry.seconder) && (
                                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                                                        Proposé par: {entry.proposer || 'Non spécifié'}
                                                        {entry.seconder ? ` | Appuyé par: ${entry.seconder}` : ''}
                                                    </Typography>
                                                )}
                                            </Box>
                                        ))}
                                    </Box>
                                ) : (
                                    <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic', mb: 3 }}>
                                        Aucune note ou résolution pour ce sujet.
                                    </Typography>
                                )}

                                <Divider sx={{ my: 2 }} />

                                <TextField
                                    fullWidth
                                    variant="outlined"
                                    size="small"
                                    label={`Vos commentaires pour ${item.title}`}
                                    multiline
                                    rows={2}
                                    value={itemComments[item.id] || ''}
                                    onChange={(e) => handleItemCommentChange(item.id, e.target.value)}
                                    placeholder="Ajouter une correction ou une précision pour ce sujet spécifique..."
                                />
                            </CardContent>
                        </Card>
                    ))}
                </Box>
            )}

            <Paper elevation={1} sx={{ p: 3, mb: 4, bgcolor: '#f8f9fa', borderLeft: isCircular ? '4px solid #c5a065' : 'none' }}>
                <Typography variant="h6" gutterBottom>
                    {isCircular ? "Remarques ou commentaires d'accompagnement" : "Commentaire général"}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {isCircular 
                        ? "Utilisez cet espace pour toute remarque additionnelle ou commentaire d'accompagnement à associer à cette résolution écrite."
                        : "Utilisez cet espace pour tout commentaire global sur le procès-verbal."}
                </Typography>
                <TextField
                    fullWidth
                    variant="outlined"
                    label={isCircular ? "Remarques additionnelles" : "Commentaire général"}
                    multiline
                    rows={3}
                    value={generalComment}
                    onChange={(e) => setGeneralComment(e.target.value)}
                />
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, pb: 4 }}>
                <Button
                    variant="outlined"
                    color="error"
                    size="large"
                    startIcon={<Edit />}
                    onClick={() => setShowRejectDialog(!showRejectDialog)}
                    disabled={actionLoading}
                >
                    Demander des modifications
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    size="large"
                    startIcon={<CheckCircle />}
                    onClick={handleApprove}
                    disabled={actionLoading}
                >
                    Approuver et Signer
                </Button>
            </Box>

            {/* Reject Confirmation Dialog */}
            <Dialog open={showRejectDialog} onClose={() => setShowRejectDialog(false)}>
                <DialogTitle>Confirmer la demande de modifications</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                        Vous êtes sur le point d'envoyer vos commentaires au coordonnateur.
                    </Typography>

                    {getAggregatedComments() ? (
                        <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1, maxHeight: 200, overflow: 'auto' }}>
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                {getAggregatedComments()}
                            </Typography>
                        </Box>
                    ) : (
                        <Alert severity="warning">
                            Vous n'avez écrit aucun commentaire. Veuillez utiliser les champs ci-dessus ou le champ global.
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowRejectDialog(false)}>Annuler</Button>
                    <Button
                        onClick={handleRequestChanges}
                        color="error"
                        variant="contained"
                        disabled={!getAggregatedComments()}
                    >
                        Signaler au coordonnateur
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default ApprovalPage;
