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
    ListSubheader,
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
import type { Meeting } from '../../types/meeting.types';

interface ApprovalRequestDialogProps {
    open: boolean;
    onClose: () => void;
    meetingId: string;
    meeting?: Meeting;
    onSuccess: () => void;
}

const ApprovalRequestDialog: React.FC<ApprovalRequestDialogProps> = ({ open, onClose, meetingId, meeting, onSuccess }) => {
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

    const isCircular = meeting?.type === 'circular';
    const signatures = meeting?.approvalSignatures || [];

    // Filter circular candidates: active required signers who haven't signed yet
    const circularCandidates = members.filter((m: Member) => 
        m.isActive && 
        ['president', 'vice_president', 'member', 'elected_official'].includes(m.role) &&
        !signatures.some(s => s.signedBy === m.id)
    );

    // Filter groups (for regular meetings)
    const presidents = members.filter(m => m.isActive && (m.role === 'president' || m.role === 'vice_president'));
    const elected = members.filter(m => m.isActive && m.role === 'elected_official');
    const substitutes = members.filter(m => m.isActive && m.isSubstitute);
    const coordinators = members.filter(m => m.isActive && m.role === 'coordinator'); // For testing

    const hasCandidates = isCircular ? circularCandidates.length > 0 : (presidents.length > 0 || elected.length > 0 || substitutes.length > 0 || coordinators.length > 0);

    const handleSend = async () => {
        if (!selectedMemberId) return;

        setLoading(true);
        setError(null);

        try {
            const sendApprovalLink = httpsCallable(functions, 'send_approval_link');

            if (selectedMemberId === 'all_pending') {
                const promises = circularCandidates.map(m => 
                    sendApprovalLink({
                        meetingId,
                        memberId: m.id,
                        email: m.email,
                        name: m.displayName,
                        role: m.role
                    })
                );
                await Promise.all(promises);
            } else {
                const member = members.find((m: Member) => m.id === selectedMemberId);
                if (!member) return;

                await sendApprovalLink({
                    meetingId,
                    memberId: member.id,
                    email: member.email,
                    name: member.displayName,
                    role: member.role
                });
            }

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
                            {isCircular ? (
                                <>
                                    {circularCandidates.length > 1 && (
                                        <MenuItem value="all_pending" style={{ fontWeight: 'bold', color: '#1a365d' }}>
                                            📢 Envoyer à tous les membres en attente ({circularCandidates.length})
                                        </MenuItem>
                                    )}
                                    <ListSubheader>Membres en attente de signature</ListSubheader>
                                    {circularCandidates.map(m => (
                                        <MenuItem key={m.id} value={m.id}>
                                            {m.displayName} ({m.role === 'president' ? 'Président' : m.role === 'vice_president' ? 'Vice-Président' : m.role === 'elected_official' ? 'Élu' : 'Membre'})
                                        </MenuItem>
                                    ))}
                                </>
                            ) : (
                                <>
                                    {/* Présidence */}
                                    {presidents.length > 0 && [
                                        <ListSubheader key="header-pres" style={{ pointerEvents: 'none' }}>Présidence</ListSubheader>,
                                        ...presidents.map(m => (
                                            <MenuItem key={m.id} value={m.id}>{m.displayName} ({m.role === 'vice_president' ? 'Vice-Président' : 'Président'})</MenuItem>
                                        ))
                                    ]}

                                    {/* Élus */}
                                    {elected.length > 0 && [
                                        <ListSubheader key="header-elected" style={{ pointerEvents: 'none' }}>Élus Responsables</ListSubheader>,
                                        ...elected.map(m => (
                                            <MenuItem key={m.id} value={m.id}>{m.displayName}</MenuItem>
                                        ))
                                    ]}

                                    {/* Suppléants */}
                                    {substitutes.length > 0 && [
                                        <ListSubheader key="header-sub" style={{ pointerEvents: 'none' }}>Suppléants</ListSubheader>,
                                        ...substitutes.map(m => (
                                            <MenuItem key={m.id} value={m.id}>{m.displayName}</MenuItem>
                                        ))
                                    ]}

                                    {/* Tests */}
                                    {coordinators.length > 0 && [
                                        <ListSubheader key="header-test" style={{ pointerEvents: 'none' }}>Tests (Coordination)</ListSubheader>,
                                        ...coordinators.map(m => (
                                            <MenuItem key={m.id} value={m.id}>{m.displayName}</MenuItem>
                                        ))
                                    ]}
                                </>
                            )}
                        </Select>
                    </FormControl>

                    {!hasCandidates && !membersLoading && members.length > 0 && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            {isCircular ? "Tous les membres requis ont déjà signé cette résolution écrite." : "Aucun membre avec le rôle approprié trouvé (Président, Élu, Suppléant)."}
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
