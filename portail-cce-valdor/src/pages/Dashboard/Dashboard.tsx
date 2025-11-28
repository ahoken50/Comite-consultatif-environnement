import React from 'react';
import { Box, Grid, Typography } from '@mui/material';

const Dashboard: React.FC = () => {
    return (
        <Box>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'text.primary', mb: 4 }}>
                Tableau de bord
            </Typography>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12 }}>
                    <Typography variant="body1" color="text.secondary">
                        Bienvenue sur le Portail CCE. Sélectionnez une section dans le menu pour commencer.
                    </Typography>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;
