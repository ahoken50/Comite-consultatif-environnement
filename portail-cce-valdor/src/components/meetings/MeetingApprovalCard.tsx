import React, { useState, useEffect } from 'react';
import {
    Box, Paper, Typography, Button, Stepper, Step, StepLabel, Chip,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, FormControlLabel, Switch, Alert, CircularProgress,
    LinearProgress, Avatar, TextField, Tooltip, IconButton
} from '@mui/material';
import { Gavel, VerifiedUser, HowToReg, AdminPanelSettings, Warning, PictureAsPdf, Email, CheckCircle, Close } from '@mui/icons-material';
import type { Member, MemberRole } from '../../types/member.types';
import type { Meeting, ApprovalSignature } from '../../types/meeting.types';

interface MeetingApprovalCardProps {
    meeting: Meeting;
    currentUser: Member | null;
    onApprove: (role: 'president' | 'elected_official' | 'coordinator' | 'admin_bypass') => void;
}

// Roles authorized to approve PVs
const APPROVAL_ROLES: MemberRole[] = ['coordinator', 'president', 'vice_president', 'elected_official'];

import { updateMeeting } from '../../features/meetings/meetingsSlice';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { fetchMembers } from '../../features/members/membersSlice';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { generateExtractAndUpload, fetchEnrichedSignatures } from '../../services/pdfServiceExtract';

interface CircularApprovalFlowProps {
    meeting: Meeting;
    currentUser: Member | null;
}

const CircularApprovalFlow: React.FC<CircularApprovalFlowProps> = ({ meeting, currentUser }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { items: members } = useSelector((state: RootState) => state.members);
    const [consignDialogOpen, setConsignDialogOpen] = useState(false);
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);
    const [emailText, setEmailText] = useState('');
    const [viewEmailOpen, setViewEmailOpen] = useState(false);
    const [activeEmailText, setActiveEmailText] = useState('');
    const [activeEmailMemberName, setActiveEmailMemberName] = useState('');
    const [isGeneratingExtraits, setIsGeneratingExtraits] = useState(false);

    useEffect(() => {
        if (members.length === 0) {
            dispatch(fetchMembers());
        }
    }, [dispatch, members.length]);

    const votingMembers = members.filter((m: Member) => m.isActive && ['president', 'vice_president', 'member'].includes(m.role));
    const signatures = meeting.approvalSignatures || [];

    const getMemberSignature = (memberId: string) => {
        return signatures.find(s => s.signedBy === memberId);
    };

    const totalVoting = votingMembers.length;
    const signedCount = votingMembers.filter((m: Member) => getMemberSignature(m.id)).length;
    const consensusPercentage = totalVoting > 0 ? Math.round((signedCount / totalVoting) * 100) : 0;
    const isFullyApproved = signedCount === totalVoting && totalVoting > 0;

    const isCoordinator = currentUser?.role === 'coordinator';
    const isCurrentUserVoting = currentUser && currentUser.isActive && ['president', 'vice_president', 'member'].includes(currentUser.role);
    const hasCurrentUserSigned = currentUser && !!getMemberSignature(currentUser.id);

    const handleSelfSign = () => {
        if (!currentUser) return;
        const newSig: ApprovalSignature = {
            role: currentUser.role as any,
            signedBy: currentUser.id,
            signedByName: currentUser.displayName,
            signedAt: new Date().toISOString(),
            consentType: 'digital' as const
        };
        const updatedSignatures = [...signatures, newSig];
        const newSignedCount = votingMembers.filter((m: Member) => m.id === currentUser.id || getMemberSignature(m.id)).length;
        const newStatus = newSignedCount === totalVoting ? 'approved' : 'waiting_approval';

        dispatch(updateMeeting({
            id: meeting.id,
            updates: {
                approvalSignatures: updatedSignatures,
                approvalStatus: newStatus as any
            }
        }));
    };

    const handleOpenConsign = (member: Member) => {
        setSelectedMember(member);
        setEmailText('');
        setConsignDialogOpen(true);
    };

    const handleCloseConsign = () => {
        setConsignDialogOpen(false);
        setSelectedMember(null);
        setEmailText('');
    };

    const handleConfirmConsign = () => {
        if (!selectedMember) return;
        const newSig: ApprovalSignature = {
            role: selectedMember.role as any,
            signedBy: selectedMember.id,
            signedByName: selectedMember.displayName,
            signedAt: new Date().toISOString(),
            consentType: 'email' as const,
            emailConsentText: emailText
        };
        const updatedSignatures = [...signatures, newSig];
        const newSignedCount = votingMembers.filter((m: Member) => m.id === selectedMember.id || getMemberSignature(m.id)).length;
        const newStatus = newSignedCount === totalVoting ? 'approved' : 'waiting_approval';

        dispatch(updateMeeting({
            id: meeting.id,
            updates: {
                approvalSignatures: updatedSignatures,
                approvalStatus: newStatus as any
            }
        }));
        handleCloseConsign();
    };

    const handleRemoveSignature = (memberId: string) => {
        const updatedSignatures = signatures.filter(s => s.signedBy !== memberId);
        const newSignedCount = votingMembers.filter((m: Member) => m.id !== memberId && getMemberSignature(m.id)).length;
        const newStatus = newSignedCount === totalVoting ? 'approved' : (newSignedCount > 0 ? 'waiting_approval' : 'draft');

        dispatch(updateMeeting({
            id: meeting.id,
            updates: {
                approvalSignatures: updatedSignatures,
                approvalStatus: newStatus as any
            }
        }));
    };

    const handleViewEmail = (memberName: string, text: string) => {
        setActiveEmailMemberName(memberName);
        setActiveEmailText(text);
        setViewEmailOpen(true);
    };

    const handleGenerateExtraits = async () => {
        if (!meeting.agendaItems || meeting.agendaItems.length === 0) return;
        setIsGeneratingExtraits(true);
        try {
            const enrichedSignatures = await fetchEnrichedSignatures(meeting);
            let count = 0;
            for (let i = 0; i < meeting.agendaItems.length; i++) {
                const item = meeting.agendaItems[i];
                const userName = currentUser?.displayName || 'Système';
                await generateExtractAndUpload(meeting, item, userName, i + 1, enrichedSignatures);
                count++;
            }
            alert(`Succès! ${count} extraits générés et enregistrés dans le registre.`);
        } catch (error) {
            console.error('Extraction error:', error);
            alert("Erreur lors de la génération PDF.");
        } finally {
            setIsGeneratingExtraits(false);
        }
    };

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'president': return 'Président(e)';
            case 'vice_president': return 'Vice-Président(e)';
            case 'member': return 'Membre Votant';
            default: return role;
        }
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Gavel color="primary" />
                    <Typography variant="h6" fontWeight="bold">Résolution Écrite (Procès-Verbal Spécial)</Typography>
                    {isFullyApproved && <Chip label="Unanimité Atteinte" color="success" size="small" />}
                </Box>
            </Box>

            <Alert severity="info" sx={{ mb: 3 }}>
                Conformément à l'article 1.3 du règlement, une résolution écrite doit être approuvée formellement par <strong>la totalité des membres ayant droit de vote (100%)</strong> pour posséder la même valeur qu'une résolution adoptée en séance.
            </Alert>

            {/* Progress and Stats */}
            <Box sx={{ mb: 4, p: 2, bgcolor: 'background.default', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Taux de consensus</Typography>
                    <Typography variant="subtitle1" fontWeight="bold" color="primary.main">
                        {consensusPercentage}% ({signedCount} / {totalVoting} votants)
                    </Typography>
                </Box>
                <LinearProgress 
                    variant="determinate" 
                    value={consensusPercentage} 
                    sx={{ height: 10, borderRadius: 5, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { borderRadius: 5 } }}
                />
            </Box>

            {/* Voting Members List */}
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>Membres Votants et Statut des Signatures</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 4 }}>
                {votingMembers.map((member: Member) => {
                    const signature = getMemberSignature(member.id);
                    const isSigned = !!signature;

                    return (
                        <Paper 
                            key={member.id} 
                            variant="outlined" 
                            sx={{ 
                                p: 2, 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                bgcolor: isSigned ? 'rgba(76, 175, 80, 0.04)' : 'transparent',
                                borderColor: isSigned ? 'success.light' : 'divider',
                                transition: 'all 0.2s'
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Avatar sx={{ 
                                    bgcolor: member.role === 'president' ? 'primary.main' : member.role === 'vice_president' ? 'secondary.main' : 'grey.600',
                                    color: '#fff'
                                }}>
                                    {member.displayName.charAt(0)}
                                </Avatar>
                                <Box>
                                    <Typography variant="subtitle2" fontWeight="bold">
                                        {member.displayName}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {getRoleLabel(member.role)}
                                    </Typography>
                                </Box>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {isSigned ? (
                                    <>
                                        {signature.consentType === 'email' ? (
                                            <Tooltip title="Voir l'accord courriel">
                                                <Chip 
                                                    icon={<Email />} 
                                                    label="Accord Courriel" 
                                                    color="info" 
                                                    variant="outlined"
                                                    onClick={() => handleViewEmail(member.displayName, signature.emailConsentText || '')}
                                                    sx={{ cursor: 'pointer' }}
                                                />
                                            </Tooltip>
                                        ) : (
                                            <Chip 
                                                icon={<CheckCircle />} 
                                                label="Signé Électroniquement" 
                                                color="success" 
                                                variant="outlined"
                                            />
                                        )}
                                        {isCoordinator && (
                                            <Tooltip title="Retirer la signature">
                                                <IconButton 
                                                    size="small" 
                                                    color="error" 
                                                    onClick={() => handleRemoveSignature(member.id)}
                                                    sx={{ ml: 1 }}
                                                >
                                                    <Close fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <Chip 
                                            label="En attente" 
                                            color="default" 
                                            variant="outlined" 
                                            sx={{ borderStyle: 'dashed' }}
                                        />
                                        {isCoordinator && (
                                            <Button 
                                                size="small" 
                                                variant="contained" 
                                                color="info" 
                                                onClick={() => handleOpenConsign(member)}
                                                startIcon={<Email />}
                                                sx={{ ml: 1, textTransform: 'none' }}
                                            >
                                                Consigner
                                            </Button>
                                        )}
                                    </>
                                )}
                            </Box>
                        </Paper>
                    );
                })}
            </Box>

            {/* Bottom Actions Panel */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: isFullyApproved ? 'rgba(76, 175, 80, 0.05)' : 'rgba(0, 0, 0, 0.01)' }}>
                {isCurrentUserVoting && !hasCurrentUserSigned && (
                    <Button
                        variant="contained"
                        color="success"
                        size="large"
                        startIcon={<CheckCircle />}
                        onClick={handleSelfSign}
                        sx={{ px: 4, py: 1.5, borderRadius: 2, boxShadow: 2 }}
                    >
                        Signer électroniquement la résolution
                    </Button>
                )}

                {hasCurrentUserSigned && !isFullyApproved && (
                    <Typography variant="body2" color="success.main" fontWeight="bold">
                        Votre approbation a été enregistrée avec succès. En attente de l'approbation des autres membres.
                    </Typography>
                )}

                {isFullyApproved ? (
                    <Box sx={{ textAlign: 'center', width: '100%' }}>
                        <Typography variant="subtitle1" fontWeight="bold" color="success.main" gutterBottom sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                            <CheckCircle /> Unanimité atteinte ! La résolution est adoptée.
                        </Typography>
                        {isCoordinator && (
                            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 2 }}>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    startIcon={isGeneratingExtraits ? <CircularProgress size={20} color="inherit" /> : <PictureAsPdf />}
                                    onClick={handleGenerateExtraits}
                                    disabled={isGeneratingExtraits}
                                >
                                    {isGeneratingExtraits ? 'Génération en cours...' : 'Générer les Extraits de PV'}
                                </Button>
                            </Box>
                        )}
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        Le procès-verbal spécial sera marqué comme "Approuvé" automatiquement dès que 100% des signatures seront obtenues.
                    </Typography>
                )}
            </Box>

            {/* Consign Email Consent Dialog */}
            <Dialog open={consignDialogOpen} onClose={handleCloseConsign} fullWidth maxWidth="sm">
                <DialogTitle>Consigner un Accord par Courriel</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Vous consignez le vote de <strong>{selectedMember?.displayName}</strong>. 
                        Veuillez copier-coller ci-dessous le corps du courriel ou la preuve écrite de son consentement pour assurer la traçabilité.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        multiline
                        rows={6}
                        fullWidth
                        variant="outlined"
                        placeholder="Copier-coller le courriel d'accord ici..."
                        value={emailText}
                        onChange={(e) => setEmailText(e.target.value)}
                        sx={{ fontFamily: 'monospace' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseConsign}>Annuler</Button>
                    <Button onClick={handleConfirmConsign} color="primary" variant="contained" disabled={!emailText.trim()}>
                        Enregistrer l'accord
                    </Button>
                </DialogActions>
            </Dialog>

            {/* View Email Consent Dialog */}
            <Dialog open={viewEmailOpen} onClose={() => setViewEmailOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Preuve de Consentement par Courriel</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 1 }}>
                        Consignée pour <strong>{activeEmailMemberName}</strong> :
                    </DialogContentText>
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f5f5f5', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace' }}>
                        {activeEmailText}
                    </Paper>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setViewEmailOpen(false)}>Fermer</Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

/**
 * MeetingApprovalCard Component
 * 
 * Manages the approval workflow for "Procès-Verbaux" (Meeting Minutes).
 * 
 * Flow:
 * 1. Draft (Brouillon) - Initial state.
 * 2. Verification - Signatures required from President and Elected Official.
 * 3. Approved (Approuvé) - Final state after all signatures.
 * 
 * Features:
 * - Role-based button visibility (Coordinator, President, Elected Official).
 * - "Switch" for Coordinator to open/close approval availability for non-coordinators.
 * - Coordinator "Bypass" functionality to sign on behalf of missing officials (with warning dialog).
 * - Progress stepper visualization.
 * 
 * @param meeting - The meeting object containing approval status and signatures.
 * @param currentUser - The currently logged-in user (Member).
 * @param onApprove - Callback triggered when a signature action is confirmed.
 */
const MeetingApprovalCard: React.FC<MeetingApprovalCardProps> = ({ meeting, currentUser, onApprove }) => {
    const dispatch = useDispatch<AppDispatch>();

    if (meeting.type === 'circular') {
        return (
            <CircularApprovalFlow
                meeting={meeting}
                currentUser={currentUser}
            />
        );
    }
    const steps = ['Brouillon', 'Vérification', 'Approuvé'];

    // Warning dialog state
    const [warningOpen, setWarningOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<'president' | 'elected_official' | 'coordinator' | 'admin_bypass' | null>(null);
    const [isGeneratingExtraits, setIsGeneratingExtraits] = useState(false);

    // Fetch approved tokens from subcollection
    const [approvedTokens, setApprovedTokens] = useState<any[]>([]);

    useEffect(() => {
        if (!meeting.id) return;
        const approvalsRef = collection(db, 'meetings', meeting.id, 'approval_tokens');
        const unsubscribe = onSnapshot(approvalsRef, (snapshot) => {
            const tokens = snapshot.docs.map(doc => doc.data());
            const approved = tokens.filter(t => t.status === 'approved');
            console.log("Tokens approved:", approved);
            setApprovedTokens(approved);
        }, (error) => {
            console.error("Error fetching approval tokens:", error);
        });
        return () => unsubscribe();
    }, [meeting.id]);

    const signatures = meeting.approvalSignatures || [];
    const hasPresidentSigned = signatures.some(s => s.role === 'president' || (s.role as string) === 'vice_president') || approvedTokens.some(t => t.role === 'president' || t.role === 'vice_president');
    const hasElectedSigned = signatures.some(s => s.role === 'elected_official') || approvedTokens.some(t => t.role === 'elected_official');
    const hasCoordinatorSigned = signatures.some(s => s.role === 'coordinator') || approvedTokens.some(t => t.role === 'coordinator');

    const hasAdminBypass = signatures.some(s => s.role === 'admin_bypass') || approvedTokens.some(t => t.role === 'admin_bypass');

    // Default to false if undefined
    const isApprovalAvailable = meeting.isApprovalAvailable || false;

    let activeStep = 0;
    if (signatures.length > 0 || approvedTokens.length > 0) activeStep = 1;
    // Approbation officielle dès que (Président OU Élu) ET Secrétaire ont signé
    if ((hasPresidentSigned || hasElectedSigned) && hasCoordinatorSigned) activeStep = 3;
    if (hasAdminBypass) activeStep = 3;

    const isCoordinator = currentUser?.role === 'coordinator';

    // Check if user is authorized to see approval buttons
    const isAuthorized = () => {
        if (!currentUser) return false;
        return APPROVAL_ROLES.includes(currentUser.role);
    };

    // Check if a signature slot is available
    const isSlotAvailable = (signRole: 'president' | 'elected_official' | 'coordinator' | 'admin_bypass') => {
        if (activeStep === 3) return false;

        // If approval is NOT available, only Coordinator sees buttons (as admin)
        if (!isApprovalAvailable && signRole !== 'admin_bypass' && signRole !== 'coordinator') return false;

        switch (signRole) {
            case 'admin_bypass': return true; // Admin bypass always available
            case 'coordinator': return !hasCoordinatorSigned;
            case 'president': return !hasPresidentSigned;
            case 'elected_official': return !hasElectedSigned;
            default: return false;
        }
    };

    // Check if user has the natural role to sign
    const hasNaturalRole = (signRole: 'president' | 'elected_official' | 'coordinator') => {
        if (!currentUser) return false;
        switch (signRole) {
            case 'coordinator': return currentUser.role === 'coordinator';
            case 'president': return currentUser.role === 'president' || currentUser.role === 'vice_president';
            case 'elected_official': return currentUser.role === 'elected_official';
            default: return false;
        }
    };

    // Handle button click with warning for coordinator signing as other roles
    const handleSignClick = (role: 'president' | 'elected_official' | 'coordinator' | 'admin_bypass') => {
        if (isCoordinator && role !== 'coordinator' && role !== 'admin_bypass') {
            // Show warning before signing as another role
            setPendingAction(role);
            setWarningOpen(true);
        } else {
            onApprove(role);
        }
    };

    const handleConfirmWarning = () => {
        if (pendingAction) {
            onApprove(pendingAction);
        }
        setWarningOpen(false);
        setPendingAction(null);
    };

    const handleCancelWarning = () => {
        setWarningOpen(false);
        setPendingAction(null);
    };

    const handleToggleAvailability = () => {
        if (isCoordinator) {
            dispatch(updateMeeting({
                id: meeting.id,
                updates: { isApprovalAvailable: !isApprovalAvailable }
            }));
        }
    };

    const handleGenerateExtraits = async () => {
        if (!meeting.agendaItems || meeting.agendaItems.length === 0) return;
        setIsGeneratingExtraits(true);
        try {
            console.log(`🚀 Starting extract generation for ${meeting.agendaItems.length} agenda items…`);
            // Pre-fetch signatures ONCE for all extracts
            const enrichedSignatures = await fetchEnrichedSignatures(meeting);
            console.log(`🔑 Fetched ${enrichedSignatures.length} enriched signatures`);

            let count = 0;
            for (let i = 0; i < meeting.agendaItems.length; i++) {
                const item = meeting.agendaItems[i];
                const userName = currentUser?.displayName || 'Système';
                await generateExtractAndUpload(meeting, item, userName, i + 1, enrichedSignatures);
                count++;
            }
            alert(`Succès! ${count} extraits générés et enregistrés dans le registre.`);
        } catch (error) {
            console.error('Extraction error:', error);
            alert("Erreur lors de la génération PDF.");
        } finally {
            setIsGeneratingExtraits(false);
        }
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Gavel color="primary" />
                    <Typography variant="h6">Approbation du Procès-Verbal</Typography>
                    {activeStep === 3 && <Chip label="Approuvé & Finalisé" color="success" size="small" />}
                </Box>

                {/* Coordinator Control Switch */}
                {isCoordinator && activeStep < 3 && (
                    <FormControlLabel
                        control={
                            <Switch
                                checked={isApprovalAvailable}
                                onChange={handleToggleAvailability}
                                color="primary"
                            />
                        }
                        label={
                            <Typography variant="body2" color={isApprovalAvailable ? "primary" : "text.secondary"}>
                                {isApprovalAvailable ? "Approbation ouverte aux membres" : "Approbation verrouillée"}
                            </Typography>
                        }
                    />
                )}
            </Box>

            {!isApprovalAvailable && !isCoordinator && activeStep < 3 && (
                <Alert severity="info" sx={{ mb: 3 }}>
                    L'approbation de ce procès-verbal n'est pas encore ouverte par la coordination.
                </Alert>
            )}

            {/* ... (Stepper and Signature Status Display code remains similar) */}
            <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Signature Status Display */}
            <Box sx={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 2 }}>
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200, bgcolor: hasPresidentSigned ? '#e8f5e9' : 'transparent' }}>
                    <Typography variant="subtitle2" gutterBottom>Président(e) / Vice-Président(e)</Typography>
                    {hasPresidentSigned ? (
                        <Box sx={{ color: 'success.main', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <VerifiedUser fontSize="large" sx={{ mb: 1 }} />
                            <Typography variant="caption">Signé</Typography>
                        </Box>
                    ) : (
                        <Typography variant="caption" color="text.secondary">En attente de signature</Typography>
                    )}
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200, bgcolor: hasElectedSigned ? '#e8f5e9' : 'transparent' }}>
                    <Typography variant="subtitle2" gutterBottom>Élu(e) Responsable</Typography>
                    {hasElectedSigned ? (
                        <Box sx={{ color: 'success.main', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <HowToReg fontSize="large" sx={{ mb: 1 }} />
                            <Typography variant="caption">Signé</Typography>
                        </Box>
                    ) : (
                        <Typography variant="caption" color="text.secondary">En attente de signature</Typography>
                    )}
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200, bgcolor: hasCoordinatorSigned ? '#e8f5e9' : 'transparent' }}>
                    <Typography variant="subtitle2" gutterBottom>Secrétaire / Coordonnateur</Typography>
                    {hasCoordinatorSigned ? (
                        <Box sx={{ color: 'success.main', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <VerifiedUser fontSize="large" sx={{ mb: 1 }} />
                            <Typography variant="caption">Signé</Typography>
                        </Box>
                    ) : (
                        <Typography variant="caption" color="text.secondary">En attente de signature</Typography>
                    )}
                </Paper>
            </Box>

            {/* ... (Coordinator Override Section) */}
            {hasAdminBypass && (
                <Paper variant="outlined" sx={{ mt: 2, p: 2, bgcolor: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <AdminPanelSettings color="warning" />
                    <Box>
                        <Typography variant="subtitle2">Validation Administrative</Typography>
                        <Typography variant="caption">Le PV a été approuvé par bypass administratif.</Typography>
                    </Box>
                </Paper>
            )}

            {/* Approval Buttons */}
            {isAuthorized() && activeStep < 3 && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>

                    {/* Coordinator: Admin Bypass Button */}
                    {isCoordinator && isSlotAvailable('admin_bypass') && (
                        <Button
                            variant="outlined"
                            color="warning"
                            size="small"
                            onClick={() => handleSignClick('admin_bypass')}
                            startIcon={<AdminPanelSettings />}
                            sx={{ order: 99 }}
                        >
                            Bypass Admin (Finaliser)
                        </Button>
                    )}

                    {/* Coordinator: Normal Signature Button */}
                    {isSlotAvailable('coordinator') && (hasNaturalRole('coordinator') || isCoordinator) && (
                        <Button
                            variant={isCoordinator && !hasNaturalRole('coordinator') ? "outlined" : "contained"}
                            color="info"
                            size="large"
                            onClick={() => handleSignClick('coordinator')}
                            startIcon={<VerifiedUser />}
                        >
                            Signer (Secrétaire)
                        </Button>
                    )}

                    {/* President/Vice-President Button */}
                    {/* ONLY VISIBLE IF isApprovalAvailable OR Coordinator Override (but logic says coord needs to open it first usually, but lets stick to isSlotAvailable logic) */}
                    {isSlotAvailable('president') && (hasNaturalRole('president') || isCoordinator) && (
                        <Button
                            variant={isCoordinator && !hasNaturalRole('president') ? "outlined" : "contained"}
                            color="primary"
                            size="large"
                            onClick={() => handleSignClick('president')}
                            startIcon={<Gavel />}
                        >
                            Signer (Présidence)
                        </Button>
                    )}

                    {/* Elected Official Button */}
                    {isSlotAvailable('elected_official') && (hasNaturalRole('elected_official') || isCoordinator) && (
                        <Button
                            variant={isCoordinator && !hasNaturalRole('elected_official') ? "outlined" : "contained"}
                            color="secondary"
                            size="large"
                            onClick={() => handleSignClick('elected_official')}
                            startIcon={<HowToReg />}
                        >
                            Signer (Élu)
                        </Button>
                    )}
                </Box>
            )}

            {/* PV Extraction Panel (Post-Approval) */}
            {activeStep === 3 && isCoordinator && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', p: 2, bgcolor: '#f0f4ff', borderRadius: 2, border: '1px solid #d0deff' }}>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom color="primary">
                            Documentation
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Générer les extraits individuels pour les résolutions de ce PV.
                        </Typography>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={isGeneratingExtraits ? <CircularProgress size={20} color="inherit" /> : <PictureAsPdf />}
                            onClick={handleGenerateExtraits}
                            disabled={isGeneratingExtraits}
                        >
                            {isGeneratingExtraits ? 'Génération en cours...' : 'Générer les Extraits de PV'}
                        </Button>
                    </Box>
                </Box>
            )}

            {/* ... (rest of logic) */}
            {/* Message for non-authorized users */}
            {!isAuthorized() && currentUser && (
                <Box sx={{ mt: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                        Seuls les administrateurs, président(e)s, vice-président(e)s et élu(e)s peuvent approuver les PV.
                    </Typography>
                </Box>
            )}

            {/* Warning Dialog */}
            <Dialog open={warningOpen} onClose={handleCancelWarning}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning color="warning" />
                    Avertissement
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Vous êtes sur le point de signer en tant que <strong>
                            {pendingAction === 'president' ? 'Président(e)' : 'Élu(e)'}
                        </strong> alors que vous êtes connecté en tant que <strong>Coordonnateur</strong>.
                        <br /><br />
                        Cette action devrait normalement être effectuée par la personne concernée.
                        Voulez-vous continuer ?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelWarning}>Annuler</Button>
                    <Button onClick={handleConfirmWarning} color="warning" variant="contained">
                        Confirmer
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default MeetingApprovalCard;
