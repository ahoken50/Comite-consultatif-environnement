import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Snackbar, Alert, Slide } from '@mui/material';
import type { AlertColor, SlideProps } from '@mui/material';

// Types
interface ToastMessage {
    id: number;
    message: string;
    severity: AlertColor;
    duration?: number;
}

interface ToastContextType {
    showToast: (message: string, severity?: AlertColor, duration?: number) => void;
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
    showWarning: (message: string) => void;
    showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Slide transition
function SlideTransition(props: SlideProps) {
    return <Slide {...props} direction="up" />;
}

// Provider component
interface ToastProviderProps {
    children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [currentToast, setCurrentToast] = useState<ToastMessage | null>(null);
    const [open, setOpen] = useState(false);

    // Process queue
    React.useEffect(() => {
        if (toasts.length > 0 && !currentToast) {
            setCurrentToast(toasts[0]);
            setToasts((prev) => prev.slice(1));
            setOpen(true);
        }
    }, [toasts, currentToast]);

    const showToast = useCallback((message: string, severity: AlertColor = 'info', duration: number = 5000) => {
        const newToast: ToastMessage = {
            id: Date.now(),
            message,
            severity,
            duration
        };
        setToasts((prev) => [...prev, newToast]);
    }, []);

    const showSuccess = useCallback((message: string) => showToast(message, 'success'), [showToast]);
    const showError = useCallback((message: string) => showToast(message, 'error', 6000), [showToast]);
    const showWarning = useCallback((message: string) => showToast(message, 'warning'), [showToast]);
    const showInfo = useCallback((message: string) => showToast(message, 'info'), [showToast]);

    const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') return;
        setOpen(false);
    };

    const handleExited = () => {
        setCurrentToast(null);
    };

    return (
        <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
            {children}
            <Snackbar
                open={open}
                autoHideDuration={currentToast?.duration ?? 5000}
                onClose={handleClose}
                TransitionComponent={SlideTransition}
                TransitionProps={{ onExited: handleExited }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={handleClose}
                    severity={currentToast?.severity ?? 'info'}
                    variant="filled"
                    sx={{ width: '100%', minWidth: 300 }}
                >
                    {currentToast?.message}
                </Alert>
            </Snackbar>
        </ToastContext.Provider>
    );
};

// Hook to use toast
export const useToast = (): ToastContextType => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export default useToast;
