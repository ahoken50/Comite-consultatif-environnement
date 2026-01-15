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

import mammoth from 'mammoth';

interface DocumentPreviewModalProps {
    open: boolean;
    onClose: () => void;
    document: Document | null;
}

const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ open, onClose, document }) => {
    const [docxHtml, setDocxHtml] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (open && document) {
            const isDocx = document.name.toLowerCase().endsWith('.docx');
            if (isDocx) {
                setLoading(true);
                setError(null);
                setDocxHtml(null);

                fetch(document.url)
                    .then(response => response.arrayBuffer())
                    .then(arrayBuffer => mammoth.convertToHtml({ arrayBuffer }))
                    .then(result => {
                        setDocxHtml(result.value);
                        setLoading(false);
                    })
                    .catch(err => {
                        console.error('Error rendering DOCX:', err);
                        setError('Impossible de générer l\'aperçu du document.');
                        setLoading(false);
                    });
            } else {
                // Reset state for non-DOCX files
                setDocxHtml(null);
                setLoading(false);
                setError(null);
            }
        }
    }, [open, document]);

    if (!document) return null;

    const isImage = document.type.includes('image');
    const isPdf = document.type.includes('pdf');
    const isDocx = document.name.toLowerCase().endsWith('.docx');

    // Check for other Office formats that Mammoth cannot handle (doc, xls, ppt)
    const isOtherOffice = !isDocx && (
        document.type.includes('word') ||
        document.type.includes('excel') ||
        document.type.includes('spreadsheet') ||
        document.type.includes('presentation') ||
        document.name.endsWith('.doc') ||
        document.name.endsWith('.xls') ||
        document.name.endsWith('.xlsx') ||
        document.name.endsWith('.ppt') ||
        document.name.endsWith('.pptx')
    );

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

        if (isDocx) {
            return (
                <Box sx={{ height: '70vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ flexGrow: 1, overflow: 'auto', p: 4, bgcolor: '#fff' }}>
                        {loading ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <CircularProgress size={40} sx={{ mb: 2 }} />
                                <Typography variant="body2" color="text.secondary">Génération de l'aperçu...</Typography>
                            </Box>
                        ) : error ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <Typography color="error" gutterBottom>{error}</Typography>
                            </Box>
                        ) : (
                            <div
                                className="docx-preview-content"
                                dangerouslySetInnerHTML={{ __html: docxHtml || '' }}
                                style={{
                                    fontFamily: 'Calibri, sans-serif',
                                    lineHeight: '1.5',
                                    color: '#333'
                                }}
                            />
                        )}
                    </Box>
                    <Box sx={{ p: 1, textAlign: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                            Aperçu simplifié. Pour la mise en page exacte :
                        </Typography>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Download />}
                            href={document.url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Télécharger le fichier original
                        </Button>
                    </Box>
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

        if (isOtherOffice) {
            // Check if URL is local or valid for Office Viewer
            // Office Viewer requires a public URL
            const isLocal = document.url.includes('localhost') ||
                document.url.includes('127.0.0.1') ||
                document.url.startsWith('blob:') ||
                document.url.startsWith('file:') ||
                !document.url.startsWith('http') ||
                // Check for private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
                /^(https?:\/\/)?(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(document.url);

            if (isLocal) {
                return (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography variant="body1" gutterBottom sx={{ color: 'warning.main', fontWeight: 500 }}>
                            La prévisualisation n'est pas disponible pour ce format en local.
                        </Typography>
                        <Typography variant="body2" color="text.secondary" paragraph>
                            Seuls les fichiers .docx et .pdf peuvent être prévisualisés localement.
                        </Typography>
                        <Button
                            variant="outlined"
                            startIcon={<Download />}
                            href={document.url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Télécharger le fichier
                        </Button>
                    </Box>
                );
            }

            // Use Microsoft Office Online Viewer for legacy formats
            const encodedUrl = encodeURIComponent(document.url);
            const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`;

            return (
                <Box sx={{ height: '70vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                        <iframe
                            src={viewerUrl}
                            title={document.name}
                            width="100%"
                            height="100%"
                            style={{ border: 'none' }}
                            allow="fullscreen"
                        />
                    </Box>
                    <Box sx={{ p: 1, textAlign: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Download />}
                            href={document.url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Télécharger le fichier
                        </Button>
                    </Box>
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
