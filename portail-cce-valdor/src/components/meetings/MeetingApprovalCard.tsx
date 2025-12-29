import React from 'react';
import { Box, Paper, Typography, Button, Stepper, Step, StepLabel, Chip } from '@mui/material';
import { Gavel, VerifiedUser, HowToReg } from '@mui/icons-material';
import { Member } from '../../types/member.types';
import { Meeting } from '../../types/meeting.types';

interface MeetingApprovalCardProps {
    meeting: Meeting;
    currentUser: Member | null;
    onApprove: (role: 'president' | 'elected_official') => void;
}

const MeetingApprovalCard: React.FC<MeetingApprovalCardProps> = ({ meeting, currentUser, onApprove }) => {
    const steps = ['Brouillon', 'Vérification', 'Approuvé'];

    // Determine active step based on signatures
    // Logic: Draft -> (Coordinator Review) -> Waiting Signatures -> Final
    // Simplified: 
    // If no signatures: Step 0
    // If 1 signature: Step 1
    // If 2 signatures: Step 2 (Final)

    const signatures = meeting.approvalSignatures || [];
    const hasPresidentSigned = signatures.some(s => s.role === 'president');
    const hasElectedSigned = signatures.some(s => s.role === 'elected_official');

    let activeStep = 0;
    if (signatures.length > 0) activeStep = 1;
    if (hasPresidentSigned && hasElectedSigned) activeStep = 3; // Finished

    const handleSign = () => {
        if (!currentUser) return;

        // Auto-detect role for demo purposes. Real logic should verify actual roles.
        // Assuming current user is authorized if this component is enabled for them.
        if (currentUser.role === 'elected_official') {
            onApprove('elected_official');
        } else {
            // Default to president (usually a member role, need logic to identify president)
            // For now, let's assume coordinator acts as verifying authority or president mock
            onApprove('president');
        }
    };

    const canSign = () => {
        if (!currentUser) return false;
        if (activeStep === 3) return false;

        if (currentUser.role === 'elected_official' && !hasElectedSigned) return true;
        // Mock logic: Anyone else is treated as President for this demo if not elected official
        if (currentUser.role !== 'elected_official' && !hasPresidentSigned) return true;

        return false;
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

            <Box sx={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 2 }}>
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200, bgcolor: hasPresidentSigned ? '#e8f5e9' : 'transparent' }}>
                    <Typography variant="subtitle2" gutterBottom>Président(e)</Typography>
                    {hasPresidentSigned ? (
                        <Box sx={{ color: 'success.main', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <VerifiedUser fontSize="large" sx={{ mb: 1 }} />
                            <Typography variant="caption">Signé le {new Date().toLocaleDateString()}</Typography>
                            {/* In real app, use signature date */}
                        </Box>
                    ) : (
                        <Typography variant="caption" color="text.secondary">En attente de signature</Typography>
                    )}
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200, bgcolor: hasElectedSigned ? '#e8f5e9' : 'transparent' }}>
                    <Typography variant="subtitle2" gutterBottom>Élu Responsable</Typography>
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

            {canSign() && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                    <Button variant="contained" color="secondary" size="large" onClick={handleSign} startIcon={<Gavel />}>
                        Signer et Approuver le PV
                    </Button>
                </Box>
            )}
        </Paper>
    );
};

export default MeetingApprovalCard;
