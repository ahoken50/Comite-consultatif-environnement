import { useEffect, useCallback, useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button
} from '@mui/material';

interface UseUnsavedChangesOptions {
    isDirty: boolean;
    message?: string;
}

interface UnsavedChangesDialogProps {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    message?: string;
}

/**
 * Dialog component for unsaved changes confirmation
 */
export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({
    open,
    onConfirm,
    onCancel,
    message = 'Vous avez des modifications non sauvegardées. Êtes-vous sûr de vouloir quitter?'
}) => {
    return (
        <Dialog open={open} onClose={onCancel}>
            <DialogTitle>Modifications non sauvegardées</DialogTitle>
            <DialogContent>
                <DialogContentText>{message}</DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} color="primary">
                    Continuer l'édition
                </Button>
                <Button onClick={onConfirm} color="error" variant="contained">
                    Quitter sans sauvegarder
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/**
 * Hook to warn users about unsaved changes before leaving
 * 
 * @param options.isDirty - Whether form has unsaved changes
 * @param options.message - Custom warning message
 * 
 * @returns Object with:
 * - showConfirmDialog: Function to show confirmation dialog
 * - ConfirmDialog: Dialog component to render
 * - handleClose: Function to call when user tries to close
 */
export const useUnsavedChanges = ({ isDirty, message }: UseUnsavedChangesOptions) => {
    const [showDialog, setShowDialog] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    // Handle browser close/refresh
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = message || 'Vous avez des modifications non sauvegardées.';
                return e.returnValue;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty, message]);

    // Request close with confirmation if dirty
    const handleClose = useCallback((action: () => void) => {
        if (isDirty) {
            setPendingAction(() => action);
            setShowDialog(true);
        } else {
            action();
        }
    }, [isDirty]);

    // Confirm leaving
    const onConfirm = useCallback(() => {
        setShowDialog(false);
        if (pendingAction) {
            pendingAction();
            setPendingAction(null);
        }
    }, [pendingAction]);

    // Cancel leaving
    const onCancel = useCallback(() => {
        setShowDialog(false);
        setPendingAction(null);
    }, []);

    // Dialog component ready to render
    const ConfirmDialog = (
        <UnsavedChangesDialog
            open={showDialog}
            onConfirm={onConfirm}
            onCancel={onCancel}
            message={message}
        />
    );

    return {
        handleClose,
        ConfirmDialog,
        showDialog
    };
};

export default useUnsavedChanges;
