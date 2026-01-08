/**
 * Confirm Dialog Component
 * Reusable confirmation dialog for destructive actions
 */

import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
    Box,
    useTheme
} from '@mui/material';
import { Warning, Error, Info, Help } from '@mui/icons-material';

export type ConfirmSeverity = 'warning' | 'error' | 'info' | 'question';

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    severity?: ConfirmSeverity;
    isLoading?: boolean;
}

const severityConfig: Record<ConfirmSeverity, {
    icon: React.ElementType;
    color: string;
    confirmColor: 'error' | 'warning' | 'primary' | 'info';
}> = {
    warning: { icon: Warning, color: '#ed6c02', confirmColor: 'warning' },
    error: { icon: Error, color: '#d32f2f', confirmColor: 'error' },
    info: { icon: Info, color: '#0288d1', confirmColor: 'info' },
    question: { icon: Help, color: '#9c27b0', confirmColor: 'primary' }
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    message,
    confirmText = 'Confirmer',
    cancelText = 'Annuler',
    onConfirm,
    onCancel,
    severity = 'warning',
    isLoading = false
}) => {
    const theme = useTheme();
    const config = severityConfig[severity];
    const IconComponent = config.icon;

    return (
        <Dialog
            open={open}
            onClose={isLoading ? undefined : onCancel}
            maxWidth="xs"
            fullWidth
            PaperProps={{
                sx: { borderRadius: 2 }
            }}
        >
            <DialogTitle sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                pb: 1
            }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        bgcolor: `${config.color}15`,
                    }}
                >
                    <IconComponent sx={{ color: config.color, fontSize: 24 }} />
                </Box>
                {title}
            </DialogTitle>

            <DialogContent>
                <DialogContentText sx={{ color: theme.palette.text.primary }}>
                    {message}
                </DialogContentText>
            </DialogContent>

            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                    onClick={onCancel}
                    disabled={isLoading}
                    variant="outlined"
                    color="inherit"
                >
                    {cancelText}
                </Button>
                <Button
                    onClick={onConfirm}
                    disabled={isLoading}
                    variant="contained"
                    color={config.confirmColor}
                    autoFocus
                >
                    {isLoading ? 'Chargement...' : confirmText}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ============================================
// HOOK FOR EASY USAGE
// ============================================

export interface UseConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    severity?: ConfirmSeverity;
}

export interface UseConfirmReturn {
    isOpen: boolean;
    confirm: () => Promise<boolean>;
    ConfirmDialogComponent: React.FC;
}

/**
 * Hook for easy confirmation dialog usage
 * 
 * @example
 * const { confirm, ConfirmDialogComponent } = useConfirm({
 *     title: 'Supprimer?',
 *     message: 'Cette action est irréversible.',
 *     severity: 'error'
 * });
 * 
 * const handleDelete = async () => {
 *     if (await confirm()) {
 *         // User confirmed, proceed with deletion
 *     }
 * };
 * 
 * return (
 *     <>
 *         <Button onClick={handleDelete}>Supprimer</Button>
 *         <ConfirmDialogComponent />
 *     </>
 * );
 */
export const useConfirm = (options: UseConfirmOptions): UseConfirmReturn => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [resolvePromise, setResolvePromise] = React.useState<((value: boolean) => void) | null>(null);

    const confirm = React.useCallback(() => {
        setIsOpen(true);
        return new Promise<boolean>((resolve) => {
            setResolvePromise(() => resolve);
        });
    }, []);

    const handleConfirm = React.useCallback(() => {
        setIsOpen(false);
        resolvePromise?.(true);
    }, [resolvePromise]);

    const handleCancel = React.useCallback(() => {
        setIsOpen(false);
        resolvePromise?.(false);
    }, [resolvePromise]);

    const ConfirmDialogComponent: React.FC = React.useCallback(() => (
        <ConfirmDialog
            open={isOpen}
            title={options.title}
            message={options.message}
            confirmText={options.confirmText}
            cancelText={options.cancelText}
            severity={options.severity}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    ), [isOpen, options, handleConfirm, handleCancel]);

    return { isOpen, confirm, ConfirmDialogComponent };
};

// ============================================
// PRESET DIALOGS
// ============================================

/**
 * Preset for delete confirmation
 */
export const useDeleteConfirm = (itemName?: string) => useConfirm({
    title: 'Confirmer la suppression',
    message: itemName
        ? `Êtes-vous sûr de vouloir supprimer "${itemName}" ? Cette action est irréversible.`
        : 'Êtes-vous sûr de vouloir supprimer cet élément ? Cette action est irréversible.',
    confirmText: 'Supprimer',
    severity: 'error'
});

/**
 * Preset for clear all confirmation
 */
export const useClearAllConfirm = () => useConfirm({
    title: 'Effacer tout le contenu',
    message: 'Êtes-vous sûr de vouloir effacer tout le contenu ? Cette action est irréversible.',
    confirmText: 'Effacer tout',
    severity: 'warning'
});

/**
 * Preset for discard changes confirmation
 */
export const useDiscardChangesConfirm = () => useConfirm({
    title: 'Modifications non enregistrées',
    message: 'Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter sans sauvegarder ?',
    confirmText: 'Quitter sans sauvegarder',
    cancelText: 'Continuer l\'édition',
    severity: 'warning'
});

export default ConfirmDialog;
