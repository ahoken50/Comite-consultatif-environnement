import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    IconButton
} from '@mui/material';
import { Close, Download, OpenInNew } from '@mui/icons-material';
import type { Document } from '../../types/document.types';

interface DocumentPreviewModalProps {
    open: boolean;
    onClose: () => void;
    document: Document | null;
}

const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ open, onClose, document }) => {
    if (!document) return null;

    const isImage = document.type.includes('image');
    const isPdf = document.type.includes('pdf');
    // Check for common Office formats
    const isOffice =
        document.type.includes('word') ||
        document.type.includes('excel') ||
        document.type.includes('spreadsheet') ||
        document.type.includes('presentation') ||
        document.name.endsWith('.doc') ||
        document.name.endsWith('.docx') ||
        document.name.endsWith('.xls') ||
        document.name.endsWith('.xlsx') ||
        document.name.endsWith('.ppt') ||
        document.name.endsWith('.pptx');

    const renderContent = () => {
        if (isImage) {
            return (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
                    <img
                        src={document.url}
                        alt={document.name}
                        style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                    />
                </Box>
            );
        }

        if (isPdf) {
            return (
                <Box sx={{ height: '70vh', width: '100%' }}>
                    <iframe
                        src={document.url}
                        title={document.name}
                        width="100%"
                        height="100%"
                        style={{ border: 'none' }}
                        allow="fullscreen"
                    />
                </Box>
            );
        }

        if (isOffice) {
            // Use Microsoft Office Online Viewer
            const encodedUrl = encodeURIComponent(document.url);
            const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`;

            return (
                <Box sx={{ height: '70vh', width: '100%' }}>
                    <iframe
                        src={viewerUrl}
                        title={document.name}
                        width="100%"
                        height="100%"
                        style={{ border: 'none' }}
                        allow="fullscreen"
                    />
                    <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1, color: 'text.secondary' }}>
                        Visualisation via Microsoft Office Online. Si le document ne s'affiche pas, veuillez le télécharger.
                    </Typography>
                </Box>
            );
        }

        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body1" gutterBottom>
                    La prévisualisation n'est pas disponible pour ce type de fichier.
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<Download />}
                    href={document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Télécharger le fichier
                </Button>
            </Box>
        );
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: { height: '90vh', maxHeight: '90vh' }
            }}
        >
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" noWrap sx={{ maxWidth: '80%' }}>
                    {document.name}
                </Typography>
                <Box>
                    <IconButton
                        href={document.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ouvrir dans un nouvel onglet / Télécharger"
                        sx={{ mr: 1 }}
                    >
                        <OpenInNew />
                    </IconButton>
                    <IconButton
                        aria-label="close"
                        onClick={onClose}
                    >
                        <Close />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {renderContent()}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Fermer</Button>
            </DialogActions>
        </Dialog>
    );
};

export default DocumentPreviewModal;
