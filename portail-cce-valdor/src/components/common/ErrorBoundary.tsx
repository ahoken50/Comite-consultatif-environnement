import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { ErrorOutline, Refresh } from '@mui/icons-material';

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error('Error caught by ErrorBoundary:', error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null });
        window.location.href = '/';
    };

    render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <Box
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    minHeight="100vh"
                    bgcolor="#f5f5f5"
                    p={3}
                >
                    <Paper
                        elevation={3}
                        sx={{
                            p: 4,
                            maxWidth: 500,
                            textAlign: 'center',
                            borderRadius: 2
                        }}
                    >
                        <ErrorOutline
                            sx={{ fontSize: 64, color: 'error.main', mb: 2 }}
                        />
                        <Typography variant="h5" gutterBottom fontWeight="bold">
                            Une erreur est survenue
                        </Typography>
                        <Typography variant="body1" color="text.secondary" paragraph>
                            Nous nous excusons pour ce désagrément. L'application a
                            rencontré un problème inattendu.
                        </Typography>
                        {this.state.error && (
                            <Typography
                                variant="caption"
                                component="pre"
                                sx={{
                                    bgcolor: '#f8f8f8',
                                    p: 2,
                                    borderRadius: 1,
                                    overflow: 'auto',
                                    maxHeight: 100,
                                    textAlign: 'left',
                                    mb: 3
                                }}
                            >
                                {this.state.error.message}
                            </Typography>
                        )}
                        <Button
                            variant="contained"
                            startIcon={<Refresh />}
                            onClick={this.handleReset}
                            size="large"
                        >
                            Retourner à l'accueil
                        </Button>
                    </Paper>
                </Box>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
