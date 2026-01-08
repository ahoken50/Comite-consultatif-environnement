import React, { useState } from 'react';
import {
    Box, Paper, Typography, Button, Stepper, Step, StepLabel, Chip,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions
} from '@mui/material';
import { Gavel, VerifiedUser, HowToReg, AdminPanelSettings, Warning } from '@mui/icons-material';
import type { Member, MemberRole } from '../../types/member.types';
import type { Meeting } from '../../types/meeting.types';

interface MeetingApprovalCardProps {
    meeting: Meeting;
    currentUser: Member | null;
    onApprove: (role: 'president' | 'elected_official' | 'coordinator') => void;
}

// Roles authorized to approve PVs
const APPROVAL_ROLES: MemberRole[] = ['coordinator', 'president', 'vice_president', 'elected_official'];

const MeetingApprovalCard: React.FC<MeetingApprovalCardProps> = ({ meeting, currentUser, onApprove }) => {
    const steps = ['Brouillon', 'Vérification', 'Approuvé'];

    // Warning dialog state
    const [warningOpen, setWarningOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<'president' | 'elected_official' | null>(null);

    const signatures = meeting.approvalSignatures || [];
    const hasPresidentSigned = signatures.some(s => s.role === 'president');
    const hasElectedSigned = signatures.some(s => s.role === 'elected_official');
    const hasCoordinatorSigned = signatures.some(s => s.role === 'coordinator');

    let activeStep = 0;
    if (signatures.length > 0) activeStep = 1;
    if (hasPresidentSigned && hasElectedSigned) activeStep = 3;
    if (hasCoordinatorSigned) activeStep = 3;

    const isCoordinator = currentUser?.role === 'coordinator';

    // Check if user is authorized to see approval buttons
    const isAuthorized = () => {
        if (!currentUser) return false;
        return APPROVAL_ROLES.includes(currentUser.role);
    };

    // Check if a signature slot is available
    const isSlotAvailable = (signRole: 'president' | 'elected_official' | 'coordinator') => {
        if (activeStep === 3) return false;
        switch (signRole) {
            case 'coordinator': return true; // Admin bypass always available
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
    const handleSignClick = (role: 'president' | 'elected_official' | 'coordinator') => {
        if (isCoordinator && role !== 'coordinator') {
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

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
                <Gavel color="primary" />
                <Typography variant="h6">Approbation du Procès-Verbal</Typography>
                {activeStep === 3 && <Chip label="Approuvé & Finalisé" color="success" size="small" />}
            </Box>

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
            </Box>

            {/* Coordinator Override Section */}
            {hasCoordinatorSigned && (
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
                    {isCoordinator && (
                        <Button
                            variant="contained"
                            color="warning"
                            size="large"
                            onClick={() => handleSignClick('coordinator')}
                            startIcon={<AdminPanelSettings />}
                        >
                            Bypass Admin (Finaliser)
                        </Button>
                    )}

                    {/* President/Vice-President Button (or Coordinator with warning) */}
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

                    {/* Elected Official Button (or Coordinator with warning) */}
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

            {/* Message for non-authorized users */}
            {!isAuthorized() && currentUser && (
                <Box sx={{ mt: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                        Seuls les administrateurs, président(e)s, vice-président(e)s et élu(e)s peuvent approuver les PV.
                    </Typography>
                </Box>
            )}

            {/* Warning Dialog for Coordinator signing as other role */}
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
