import React from 'react';
import { Box, Typography, Button, Container, Paper } from '@mui/material';
import { Security, ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const AccessDeniedPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <Container maxWidth="sm" sx={{ mt: 8 }}>
            <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
                <Box sx={{ mb: 2, display: 'flex', justifyContent: 'center' }}>
                    <Security sx={{ fontSize: 60, color: 'error.main' }} />
                </Box>
                <Typography variant="h4" gutterBottom fontWeight={700}>
                    Accès Refusé
                </Typography>
                <Typography variant="body1" color="text.secondary" paragraph>
                    Vous n'avez pas les permissions nécessaires pour accéder à cette page.
                    Veuillez contacter le coordonnateur si vous pensez qu'il s'agit d'une erreur.
                </Typography>
                <Box sx={{ mt: 3 }}>
                    <Button
                        variant="contained"
                        startIcon={<ArrowBack />}
                        onClick={() => navigate('/dashboard')}
                    >
                        Retour au tableau de bord
                    </Button>
                </Box>
            </Paper>
        </Container>
    );
};

export default AccessDeniedPage;
