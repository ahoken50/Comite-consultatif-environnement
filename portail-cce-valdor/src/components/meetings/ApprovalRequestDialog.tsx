import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    Box,
    CircularProgress,
    Alert
} from '@mui/material';
import { Send } from '@mui/icons-material';
import { functions } from '../../services/firebase';
import { httpsCallable } from 'firebase/functions';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import type { AppDispatch } from '../../store/store';
import { fetchMembers } from '../../features/members/membersSlice';
import type { Member } from '../../types/member.types';

interface ApprovalRequestDialogProps {
    open: boolean;
    onClose: () => void;
    meetingId: string;
    onSuccess: () => void;
}

const ApprovalRequestDialog: React.FC<ApprovalRequestDialogProps> = ({ open, onClose, meetingId, onSuccess }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: members, loading: membersLoading } = useSelector((state: RootState) => state.members);

    const [selectedMemberId, setSelectedMemberId] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open && members.length === 0) {
            dispatch(fetchMembers());
        }
    }, [open, dispatch, members.length]);

    // Filter potential approvers (President, Vice-President, Elected Official)
    const candidates = members.filter((m: Member) =>
        m.isActive &&
        (m.role === 'president' || m.role === 'vice_president' || m.role === 'elected_official')
    );

    const handleSend = async () => {
        if (!selectedMemberId) return;

        const member = members.find((m: Member) => m.id === selectedMemberId);
        if (!member) return;

        setLoading(true);
        setError(null);

        try {
            const sendApprovalLink = httpsCallable(functions, 'send_approval_link');
            await sendApprovalLink({
                meetingId,
                memberId: member.id,
                email: member.email,
                name: member.displayName,
                role: member.role
            });

            setLoading(false);
            onSuccess();
            onClose();
        } catch (err: any) {
            console.error("Failed to send approval link:", err);
            setError(err.message || "Erreur lors de l'envoi de la demande.");
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Demander l'approbation du PV</DialogTitle>
            <DialogContent>
                <Box sx={{ pt: 1 }}>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        Sélectionnez le membre officiel (Président ou Élu) qui doit signer ce procès-verbal.
                        Un lien sécurisé lui sera envoyé par courriel.
                    </Typography>

                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                    <FormControl fullWidth size="small" disabled={loading}>
                        <InputLabel>Signataire</InputLabel>
                        <Select
                            value={selectedMemberId}
                            label="Signataire"
                            onChange={(e) => setSelectedMemberId(e.target.value)}
                        >
                            {candidates.map((member: Member) => (
                                <MenuItem key={member.id} value={member.id}>
                                    {member.displayName} ({member.role === 'elected_official' ? 'Élu responsable' : 'Président'})
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {candidates.length === 0 && !membersLoading && members.length > 0 && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            Aucun membre avec le rôle 'Président' ou 'Élu responsable' trouvé. Veuillez vérifier la liste des membres.
                        </Alert>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading}>Annuler</Button>
                <Button
                    onClick={handleSend}
                    variant="contained"
                    endIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Send />}
                    disabled={!selectedMemberId || loading}
                >
                    Envoyer
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ApprovalRequestDialog;
