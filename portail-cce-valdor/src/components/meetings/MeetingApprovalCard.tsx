import React from 'react';
import { Box, Paper, Typography, Button, Stepper, Step, StepLabel, Chip } from '@mui/material';
import { Gavel, VerifiedUser, HowToReg, AdminPanelSettings } from '@mui/icons-material';
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

    const signatures = meeting.approvalSignatures || [];
    const hasPresidentSigned = signatures.some(s => s.role === 'president');
    const hasElectedSigned = signatures.some(s => s.role === 'elected_official');
    const hasCoordinatorSigned = signatures.some(s => s.role === 'coordinator');

    let activeStep = 0;
    if (signatures.length > 0) activeStep = 1;
    if (hasPresidentSigned && hasElectedSigned) activeStep = 3;
    if (hasCoordinatorSigned) activeStep = 3;

    // Check if user is authorized to see approval buttons
    const isAuthorized = () => {
        if (!currentUser) return false;
        return APPROVAL_ROLES.includes(currentUser.role);
    };

    // Check if user can sign for a specific role
    const canSignAs = (signRole: 'president' | 'elected_official' | 'coordinator') => {
        if (!currentUser) return false;
        if (activeStep === 3) return false;
        if (!isAuthorized()) return false;

        switch (signRole) {
            case 'coordinator':
                return currentUser.role === 'coordinator';
            case 'president':
                // President or Vice-President can sign as "president"
                return (currentUser.role === 'president' || currentUser.role === 'vice_president') && !hasPresidentSigned;
            case 'elected_official':
                return currentUser.role === 'elected_official' && !hasElectedSigned;
            default:
                return false;
        }
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
                            <Typography variant="caption">Signé le {new Date().toLocaleDateString()}</Typography>
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
                            <Typography variant="caption">Signé le {new Date().toLocaleDateString()}</Typography>
                        </Box>
                    ) : (
                        <Typography variant="caption" color="text.secondary">En attente de signature</Typography>
                    )}
                </Paper>
            </Box>

            {/* Coordinator Override Section */}
            {hasCoordinatorSigned && (
                <Paper variant="outlined" sx={{ mt: 2, p: 2, bgcolor: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <VerifiedUser color="success" />
                    <Box>
                        <Typography variant="subtitle2">Validé par l'Administration</Typography>
                        <Typography variant="caption">Le PV a été approuvé administrativement.</Typography>
                    </Box>
                </Paper>
            )}

            {/* Approval Buttons - Only visible to authorized roles */}
            {isAuthorized() && activeStep < 3 && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
                    {/* Admin Override Button - Coordinator Only */}
                    {canSignAs('coordinator') && (
                        <Button
                            variant="contained"
                            color="warning"
                            size="large"
                            onClick={() => onApprove('coordinator')}
                            startIcon={<AdminPanelSettings />}
                        >
                            Valider (Admin)
                        </Button>
                    )}

                    {/* President/Vice-President Button */}
                    {canSignAs('president') && (
                        <Button
                            variant="contained"
                            color="primary"
                            size="large"
                            onClick={() => onApprove('president')}
                            startIcon={<Gavel />}
                        >
                            Signer (Présidence)
                        </Button>
                    )}

                    {/* Elected Official Button */}
                    {canSignAs('elected_official') && (
                        <Button
                            variant="contained"
                            color="secondary"
                            size="large"
                            onClick={() => onApprove('elected_official')}
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
        </Paper>
    );
};

export default MeetingApprovalCard;
