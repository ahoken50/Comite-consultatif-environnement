/**
 * Error Display Component
 * User-friendly error messages with actions
 */

import React from 'react';
import {
    Box,
    Typography,
    Alert,
    AlertTitle,
    Button,
    Collapse,
    IconButton,
    Paper,
    useTheme
} from '@mui/material';
import {
    Error as ErrorIcon,
    Refresh,
    ExpandMore,
    ExpandLess,
    ContentCopy,
    BugReport
} from '@mui/icons-material';
import { ErrorMessages } from '../../constants';

// ============================================
// TYPES
// ============================================

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface ErrorDisplayProps {
    title?: string;
    message: string;
    technicalDetails?: string;
    severity?: ErrorSeverity;
    onRetry?: () => void;
    onDismiss?: () => void;
    showTechnicalDetails?: boolean;
    fullWidth?: boolean;
}

// ============================================
// ERROR DISPLAY COMPONENT
// ============================================

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
    title,
    message,
    technicalDetails,
    severity = 'error',
    onRetry,
    onDismiss,
    showTechnicalDetails = false,
    fullWidth = true
}) => {
    const [detailsExpanded, setDetailsExpanded] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    const handleCopyDetails = async () => {
        if (technicalDetails) {
            await navigator.clipboard.writeText(technicalDetails);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const defaultTitle = severity === 'error'
        ? 'Une erreur est survenue'
        : severity === 'warning'
            ? 'Attention'
            : 'Information';

    return (
        <Alert
            severity={severity}
            sx={{
                width: fullWidth ? '100%' : 'auto',
                '& .MuiAlert-message': { width: '100%' }
            }}
            onClose={onDismiss}
            action={
                onRetry && (
                    <Button
                        color="inherit"
                        size="small"
                        startIcon={<Refresh />}
                        onClick={onRetry}
                    >
                        Réessayer
                    </Button>
                )
            }
        >
            <AlertTitle>{title || defaultTitle}</AlertTitle>
            <Typography variant="body2">{message}</Typography>

            {showTechnicalDetails && technicalDetails && (
                <Box sx={{ mt: 1 }}>
                    <Button
                        size="small"
                        color="inherit"
                        onClick={() => setDetailsExpanded(!detailsExpanded)}
                        endIcon={detailsExpanded ? <ExpandLess /> : <ExpandMore />}
                        sx={{ textTransform: 'none', p: 0 }}
                    >
                        Détails techniques
                    </Button>
                    <Collapse in={detailsExpanded}>
                        <Paper
                            variant="outlined"
                            sx={{
                                mt: 1,
                                p: 1,
                                bgcolor: 'action.hover',
                                position: 'relative'
                            }}
                        >
                            <IconButton
                                size="small"
                                onClick={handleCopyDetails}
                                sx={{ position: 'absolute', top: 4, right: 4 }}
                                title={copied ? 'Copié!' : 'Copier'}
                            >
                                <ContentCopy fontSize="small" />
                            </IconButton>
                            <Typography
                                variant="caption"
                                component="pre"
                                sx={{
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    m: 0,
                                    pr: 4
                                }}
                            >
                                {technicalDetails}
                            </Typography>
                        </Paper>
                    </Collapse>
                </Box>
            )}
        </Alert>
    );
};

// ============================================
// INLINE ERROR
// ============================================

export interface InlineErrorProps {
    message: string;
    onRetry?: () => void;
}

export const InlineError: React.FC<InlineErrorProps> = ({ message, onRetry }) => (
    <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        color: 'error.main',
        py: 1
    }}>
        <ErrorIcon fontSize="small" />
        <Typography variant="body2" sx={{ flex: 1 }}>{message}</Typography>
        {onRetry && (
            <IconButton size="small" onClick={onRetry} color="inherit">
                <Refresh fontSize="small" />
            </IconButton>
        )}
    </Box>
);

// ============================================
// EMPTY STATE WITH ERROR
// ============================================

export interface ErrorStateProps {
    title?: string;
    message: string;
    onRetry?: () => void;
    icon?: React.ReactNode;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
    title = 'Oups!',
    message,
    onRetry,
    icon
}) => {
    const theme = useTheme();

    return (
        <Box sx={{
            textAlign: 'center',
            py: 6,
            px: 2,
            maxWidth: 400,
            mx: 'auto'
        }}>
            <Box sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: `${theme.palette.error.main}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2
            }}>
                {icon || <BugReport sx={{ fontSize: 40, color: 'error.main' }} />}
            </Box>
            <Typography variant="h6" gutterBottom>{title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {message}
            </Typography>
            {onRetry && (
                <Button
                    variant="contained"
                    startIcon={<Refresh />}
                    onClick={onRetry}
                >
                    Réessayer
                </Button>
            )}
        </Box>
    );
};

// ============================================
// HELPER FUNCTION
// ============================================

/**
 * Get user-friendly message from error
 */
export const getUserFriendlyError = (error: unknown): string => {
    if (typeof error === 'string') return error;

    if (error instanceof Error) {
        const msg = error.message.toLowerCase();

        if (msg.includes('network') || msg.includes('fetch')) {
            return ErrorMessages.NETWORK_ERROR;
        }
        if (msg.includes('timeout')) {
            return ErrorMessages.TIMEOUT_ERROR;
        }
        if (msg.includes('permission') || msg.includes('denied')) {
            return ErrorMessages.PERMISSION_DENIED;
        }
        if (msg.includes('not found') || msg.includes('404')) {
            return ErrorMessages.NOT_FOUND;
        }

        // If the message is user-friendly (starts with capital, no technical terms)
        if (/^[A-ZÀ-Ÿ]/.test(error.message) && !msg.includes('undefined') && !msg.includes('null')) {
            return error.message;
        }
    }

    return ErrorMessages.UNKNOWN;
};

/**
 * Get technical details from error
 */
export const getTechnicalDetails = (error: unknown): string => {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}\n\n${error.stack || ''}`;
    }
    return String(error);
};

export default ErrorDisplay;
