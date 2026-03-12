import React, { useState, useEffect } from 'react';
import {
    Box, Paper, Typography, Button, Stepper, Step, StepLabel, Chip,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, FormControlLabel, Switch, Alert
} from '@mui/material';
import { Gavel, VerifiedUser, HowToReg, AdminPanelSettings, Warning } from '@mui/icons-material';
import type { Member, MemberRole } from '../../types/member.types';
import type { Meeting } from '../../types/meeting.types';

interface MeetingApprovalCardProps {
    meeting: Meeting;
    currentUser: Member | null;
    onApprove: (role: 'president' | 'elected_official' | 'coordinator' | 'admin_bypass') => void;
}

// Roles authorized to approve PVs
const APPROVAL_ROLES: MemberRole[] = ['coordinator', 'president', 'vice_president', 'elected_official'];

import { updateMeeting } from '../../features/meetings/meetingsSlice';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';

// ... (existing helper functions)

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
    const steps = ['Brouillon', 'Vérification', 'Approuvé'];

    // Warning dialog state
    const [warningOpen, setWarningOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<'president' | 'elected_official' | 'coordinator' | 'admin_bypass' | null>(null);

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
