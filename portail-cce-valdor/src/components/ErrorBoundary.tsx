
import React from 'react';
import * as Sentry from "@sentry/react";
import { Button, Box, Typography, Paper } from '@mui/material';
import { Refresh } from '@mui/icons-material';

interface FallbackProps {
    error: Error;
    resetErrorBoundary: () => void;
}

const ErrorFallback: React.FC<FallbackProps> = ({ error, resetErrorBoundary }) => {
    return (
        <Box sx={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: '#f5f5f5',
            p: 3
        }}>
            <Paper sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
                <Typography variant="h5" gutterBottom color="error">
                    Oups ! Une erreur est survenue.
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph sx={{ fontFamily: 'monospace', bgcolor: '#eee', p: 1, borderRadius: 1 }}>
                    {error.message}
                </Typography>
                <Typography variant="body2" paragraph>
                    L'équipe technique a été notifiée. Veuillez rafraîchir la page.
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<Refresh />}
                    onClick={resetErrorBoundary}
                    sx={{ mt: 2 }}
                >
                    Rafraîchir l'application
                </Button>
            </Paper>
        </Box>
    );
};

export const SentryErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <Sentry.ErrorBoundary
            fallback={({ error, resetError }: { error: any; resetError: () => void }) => (
                <ErrorFallback error={error} resetErrorBoundary={resetError} />
            )}
            showDialog={false}
        >
            {children}
        </Sentry.ErrorBoundary>
    );
};

export default SentryErrorBoundary;
