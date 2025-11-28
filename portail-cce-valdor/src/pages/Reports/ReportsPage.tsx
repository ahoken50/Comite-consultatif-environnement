import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

const ReportsPage: React.FC = () => {
    return (
        <Box>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'text.primary', mb: 4 }}>
                Procès-verbaux
            </Typography>
            <Card>
                <CardContent>
                    <Typography variant="body1" color="text.secondary">
                        La section des procès-verbaux est en cours de développement.
                    </Typography>
                </CardContent>
            </Card>
        </Box>
    );
};

export default ReportsPage;
