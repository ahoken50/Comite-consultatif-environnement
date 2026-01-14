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
    DialogActions
} from '@mui/material';
import { CheckCircle, Edit } from '@mui/icons-material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase'; // Ensure this path is correct based on your structure
import type { Meeting } from '../../types/meeting.types';

// We'll reuse a simplified version of minutes viewer if available,
// or just render the HTML content directly for MVP.

const ApprovalPage: React.FC = () => {
    const { meetingId, token } = useParams<{ meetingId: string; token: string }>();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [approvalData, setApprovalData] = useState<any>(null);
    const [comment, setComment] = useState('');
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

            // Correction: Client SDK CAN query subcollections if we know the parent path
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
                    setMeeting({ id: meetingSnap.id, ...meetingSnap.data() } as Meeting);
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

    const handleApprove = async () => {
        setActionLoading(true);
        try {
            // Update approval status in approval_tokens collection
            const approvalRef = doc(db, 'meetings', meetingId!, 'approval_tokens', approvalData.id);
            await updateDoc(approvalRef, {
                status: 'approved',
                approvedAt: new Date().toISOString(),
                comments: comment // Optional final comment
            });

            // Log signature in meeting object (optional, for redundancy)
            // But main logic is in approval doc.

            setSuccessMessage("Merci ! Votre approbation a été enregistrée avec succès.");
        } catch (err) {
            console.error(err);
            alert("Erreur lors de l'approbation.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleRequestChanges = async () => {
        if (!comment.trim()) {
            alert("Veuillez expliquer les modifications souhaitées.");
            return;
        }
        setActionLoading(true);
        try {
            const approvalRef = doc(db, 'meetings', meetingId!, 'approval_tokens', approvalData.id);
            await updateDoc(approvalRef, {
                status: 'changes_requested',
                updatedAt: new Date().toISOString(),
                comments: comment
            });
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

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Box sx={{ mb: 4, textAlign: 'center' }}>
                <Typography variant="h4" gutterBottom>
                    Approbation du Procès-verbal
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    {meeting?.title} - {meeting?.date && new Date(meeting.date).toLocaleDateString('fr-CA')}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                    Connecté en tant que : <strong>{approvalData?.name} ({approvalData?.role})</strong>
                </Typography>
            </Box>

            <Paper elevation={3} sx={{ p: 4, mb: 4, minHeight: '50vh', bgcolor: '#fdfdfd' }}>
                {/* Render HTML content safely */}
                <div
                    className="minutes-content"
                    dangerouslySetInnerHTML={{
                        __html: meeting?.minutesDraft?.content || meeting?.minutes || "<p>Contenu non disponible.</p>"
                    }}
                />
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, pb: 4 }}>
                <Button
                    variant="outlined"
                    color="error"
                    startIcon={<Edit />}
                    onClick={() => setShowRejectDialog(true)}
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

            {/* Reject/Comment Dialog */}
            <Dialog open={showRejectDialog} onClose={() => setShowRejectDialog(false)}>
                <DialogTitle>Demander des modifications</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Veuillez indiquer les corrections nécessaires. Le coordonnateur en sera notifié.
                    </Typography>
                    <TextField
                        autoFocus
                        multiline
                        rows={4}
                        fullWidth
                        variant="outlined"
                        label="Vos commentaires"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowRejectDialog(false)}>Annuler</Button>
                    <Button onClick={handleRequestChanges} color="primary" variant="contained">
                        Envoyer
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default ApprovalPage;
