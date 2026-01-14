import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
    Box,
    Paper,
    Typography,
    Button,
    CircularProgress,
    Alert
} from '@mui/material';
import { CheckCircle, Cancel, Event, AccessTime, LocationOn } from '@mui/icons-material';
import { getRSVPDetails, updateRSVP } from '../../services/convocationService';
import { format, parseISO, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

const RSVPPage: React.FC = () => {
    const { meetingId, token } = useParams<{ meetingId: string; token: string }>();
    const [searchParams] = useSearchParams();

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [finalResponse, setFinalResponse] = useState<'confirmed' | 'declined' | null>(null);

    const [meetingDetails, setMeetingDetails] = useState<{
        title: string;
        date: string;
        location: string;
    } | null>(null);
    const [recipientName, setRecipientName] = useState<string>('');

    // Handle auto-response from email link
    useEffect(() => {
        const autoResponse = searchParams.get('response');
        if (autoResponse === 'confirmed' || autoResponse === 'declined') {
            handleSubmit(autoResponse);
        }
    }, [searchParams]);

    // Load RSVP details
    useEffect(() => {
        const loadDetails = async () => {
            if (!meetingId || !token) {
                setError('Lien invalide');
                setLoading(false);
                return;
            }

            try {
                const result = await getRSVPDetails(meetingId, token);
                if (result.success && result.meeting) {
                    setMeetingDetails(result.meeting);
                    setRecipientName(result.recipientName || '');

                    // If already responded, show that status
                    if (result.currentStatus && result.currentStatus !== 'pending') {
                        setSubmitted(true);
                        setFinalResponse(result.currentStatus);
                    }
                } else {
                    setError(result.error || 'Erreur de chargement');
                }
            } catch (err) {
                setError('Erreur de connexion');
            } finally {
                setLoading(false);
            }
        };

        loadDetails();
    }, [meetingId, token]);

    const handleSubmit = async (response: 'confirmed' | 'declined') => {
        if (!meetingId || !token || submitting) return;

        setSubmitting(true);
        setError(null);

        try {
            const result = await updateRSVP(meetingId, token, response);
            if (result.success) {
                setSubmitted(true);
                setFinalResponse(response);
            } else {
                setError(result.error || 'Erreur lors de l\'enregistrement');
            }
        } catch (err) {
            setError('Erreur de connexion');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#f9fbfa'
            }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error && !meetingDetails) {
        return (
            <Box sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#f9fbfa',
                p: 3
            }}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );
    }

    // Safe date formatting helper
    const formatDateSafe = (dateStr: string | undefined, formatStr: string) => {
        if (!dateStr) return '';

        // Debug: Log the actual date string received
        console.log('📅 RSVP Date received:', dateStr, typeof dateStr);

        try {
            // Try parsing as ISO
            let date = parseISO(dateStr);

            // If invalid, try standard Date constructor (fallback for legacy/other formats)
            if (!isValid(date)) {
                console.log('📅 parseISO failed, trying new Date()');
                date = new Date(dateStr);
            }

            if (!isValid(date)) {
                console.log('📅 Both parsing methods failed');
                return 'Date invalide';
            }

            return format(date, formatStr, { locale: fr });
        } catch (e) {
            console.error("Date parsing error:", e);
            return 'Date invalide';
        }
    };

    const formattedDate = meetingDetails?.date
        ? formatDateSafe(meetingDetails.date, 'EEEE d MMMM yyyy')
        : '';

    const formattedTime = meetingDetails?.date
        ? formatDateSafe(meetingDetails.date, 'HH:mm')
        : '';

    return (
        <Box sx={{
            minHeight: '100vh',
            bgcolor: '#f9fbfa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3
        }}>
            <Paper sx={{
                maxWidth: 500,
                width: '100%',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
            }}>
                {/* Header */}
                <Box sx={{
                    bgcolor: '#1e4e3d',
                    color: 'white',
                    p: 4,
                    textAlign: 'center'
                }}>
                    <Typography variant="h5" fontWeight="bold" gutterBottom>
                        Comité Consultatif en Environnement
                    </Typography>
                    <Typography variant="subtitle1" sx={{ color: '#c5a065' }}>
                        Ville de Val-d'Or
                    </Typography>
                </Box>

                {/* Content */}
                <Box sx={{ p: 4 }}>
                    {submitted ? (
                        // Success state
                        <Box sx={{ textAlign: 'center' }}>
                            {finalResponse === 'confirmed' ? (
                                <>
                                    <CheckCircle sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
                                    <Typography variant="h5" gutterBottom>
                                        Merci, {recipientName}!
                                    </Typography>
                                    <Typography color="text.secondary">
                                        Votre présence est confirmée pour la réunion du {formattedDate}.
                                    </Typography>
                                </>
                            ) : (
                                <>
                                    <Cancel sx={{ fontSize: 80, color: 'error.main', mb: 2 }} />
                                    <Typography variant="h5" gutterBottom>
                                        Merci, {recipientName}
                                    </Typography>
                                    <Typography color="text.secondary">
                                        Votre absence a été enregistrée pour la réunion du {formattedDate}.
                                    </Typography>
                                </>
                            )}
                        </Box>
                    ) : (
                        // Form state
                        <>
                            <Typography variant="h6" gutterBottom>
                                Bonjour {recipientName},
                            </Typography>

                            <Typography color="text.secondary" paragraph>
                                Vous êtes invité(e) à la prochaine assemblée du CCE :
                            </Typography>

                            {/* Meeting details */}
                            <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: '#f9fbfa' }}>
                                <Typography variant="h6" gutterBottom sx={{ color: '#1e4e3d' }}>
                                    {meetingDetails?.title}
                                </Typography>

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                    <Event fontSize="small" color="action" />
                                    <Typography variant="body2">{formattedDate}</Typography>
                                </Box>

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                    <AccessTime fontSize="small" color="action" />
                                    <Typography variant="body2">{formattedTime}</Typography>
                                </Box>

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <LocationOn fontSize="small" color="action" />
                                    <Typography variant="body2">{meetingDetails?.location}</Typography>
                                </Box>
                            </Paper>

                            {error && (
                                <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                            )}

                            <Typography gutterBottom fontWeight="bold">
                                Confirmez votre présence :
                            </Typography>

                            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                                <Button
                                    variant="contained"
                                    color="success"
                                    size="large"
                                    fullWidth
                                    onClick={() => handleSubmit('confirmed')}
                                    disabled={submitting}
                                    startIcon={submitting ? <CircularProgress size={20} /> : <CheckCircle />}
                                >
                                    Je serai présent(e)
                                </Button>

                                <Button
                                    variant="contained"
                                    color="error"
                                    size="large"
                                    fullWidth
                                    onClick={() => handleSubmit('declined')}
                                    disabled={submitting}
                                    startIcon={submitting ? <CircularProgress size={20} /> : <Cancel />}
                                >
                                    Je serai absent(e)
                                </Button>
                            </Box>
                        </>
                    )}
                </Box>

                {/* Footer */}
                <Box sx={{ bgcolor: '#f5f5f5', p: 2, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                        Comité consultatif en environnement • Ville de Val-d'Or
                    </Typography>
                </Box>
            </Paper>
        </Box>
    );
};

export default RSVPPage;
