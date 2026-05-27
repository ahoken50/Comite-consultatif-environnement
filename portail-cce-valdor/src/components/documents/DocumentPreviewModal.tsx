import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    IconButton,
    CircularProgress,
    Tabs,
    Tab
} from '@mui/material';
import { Close, Download, OpenInNew } from '@mui/icons-material';
import type { Document } from '../../types/document.types';
import DOMPurify from 'dompurify';

import { renderAsync } from 'docx-preview';

interface DocumentPreviewModalProps {
    open: boolean;
    onClose: () => void;
    document: Document | null;
}


const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ open, onClose, document }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [excelWorkbook, setExcelWorkbook] = React.useState<any | null>(null);
    const [sheetNames, setSheetNames] = React.useState<string[]>([]);
    const [activeSheet, setActiveSheet] = React.useState<string>('');
    const [excelHtml, setExcelHtml] = React.useState<string | null>(null);

    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (open && document) {
            const lowerName = document.name.toLowerCase();
            const isDocx = lowerName.endsWith('.docx');
            const isExcel = lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx');

            // Reset states
            setExcelHtml(null);
            setExcelWorkbook(null);
            setSheetNames([]);
            setActiveSheet('');

            setLoading(true);
            setError(null);

            // Clear previous DOCX content if any
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }

            if (isDocx) {
                fetch(document.url)
                    .then(response => response.blob())
                    .then(blob => {
                        if (containerRef.current) {
                            return renderAsync(blob, containerRef.current, containerRef.current, {
                                className: 'docx-preview-wrapper',
                                inWrapper: true,
                                ignoreWidth: false,
                                ignoreHeight: false,
                                ignoreFonts: false,
                                breakPages: true,
                                debug: false,
                                experimental: false,
                                useBase64URL: true,
                                renderChanges: false
                            });
                        }
                    })
                    .then(() => {
                        setLoading(false);
                    })
                    .catch(err => {
                        console.error('Error rendering DOCX:', err);
                        setError('Impossible de générer l\'aperçu du document DOCX.');
                        setLoading(false);
                    });
            } else if (isExcel) {
                fetch(document.url)
                    .then(response => response.arrayBuffer())
                    .then(async (arrayBuffer) => {
                        const XLSX = await import('xlsx');
                        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                        const sheets = workbook.SheetNames;

                        setExcelWorkbook(workbook);
                        setSheetNames(sheets);

                        if (sheets.length > 0) {
                            const firstSheet = sheets[0];
                            setActiveSheet(firstSheet);
                            // Initial render of first sheet
                            const worksheet = workbook.Sheets[firstSheet];
                            const html = XLSX.utils.sheet_to_html(worksheet, { id: 'excel-table' });
                            setExcelHtml(html);
                        } else {
                            setError("Le fichier Excel ne contient aucune feuille.");
                        }

                        setLoading(false);
                    })
                    .catch(err => {
                        console.error('Error rendering Excel:', err);
                        setError('Impossible de générer l\'aperçu du fichier Excel.');
                        setLoading(false);
                    });
            } else {
                setLoading(false);
            }
        }
    }, [open, document]);

    // Handle Excel Sheet change
    const handleSheetChange = async (_event: React.SyntheticEvent, newValue: string) => {
        if (excelWorkbook && newValue) {
            const XLSX = await import('xlsx');
            setActiveSheet(newValue);
            const worksheet = excelWorkbook.Sheets[newValue];
            const html = XLSX.utils.sheet_to_html(worksheet, { id: 'excel-table' });
            setExcelHtml(html);
        }
    };

    if (!document) return null;

    const lowerName = document.name.toLowerCase();
    const isImage = document.type.includes('image');
    const isPdf = document.type.includes('pdf');
    const isDocx = lowerName.endsWith('.docx');
    const isExcel = lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx');

    // Check for other Office formats that we don't handle locally yet (ppt, doc legacy)
    const isOtherOffice = !isDocx && !isExcel && (
        document.type.includes('word') ||
        document.type.includes('presentation') ||
        lowerName.endsWith('.doc') ||
        lowerName.endsWith('.ppt') ||
        lowerName.endsWith('.pptx')
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
                    <Box sx={{ flexGrow: 1, overflow: 'auto', p: 0, bgcolor: '#f5f5f5', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                        {loading && (
                            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <CircularProgress size={40} sx={{ mb: 2 }} />
                                <Typography variant="body2" color="text.secondary">Génération de la mise en page...</Typography>
                            </Box>
                        )}
                        {error && (
                            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                                <Typography color="error" gutterBottom>{error}</Typography>
                            </Box>
                        )}

                        {/* Container for docx-preview */}
                        <div
                            ref={containerRef}
                            style={{
                                width: '100%',
                                padding: '20px',
                                boxSizing: 'border-box',
                                opacity: loading ? 0.3 : 1,
                                transition: 'opacity 0.3s'
                            }}
                        />
                        {/* Global styles for the previewed content to make it look like paper */}
                        <style>{`
                            .docx-preview-wrapper .docx-content {
                                background: white !important;
                                box-shadow: 0 0 10px rgba(0,0,0,0.1);
                                padding: 40px !important;
                                margin: 0 auto;
                                min-height: 800px;
                                max-width: 850px; /* A4 width approx */
                            }
                        `}</style>
                    </Box>
                    <Box sx={{ p: 1, textAlign: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                            Aperçu haute fidélité.
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

        if (isExcel) {
            return (
                <Box sx={{ height: '70vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
                    {/* Sheet Tabs */}
                    {sheetNames.length > 1 && (
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#f5f5f5' }}>
                            <Tabs
                                value={activeSheet}
                                onChange={handleSheetChange}
                                variant="scrollable"
                                scrollButtons="auto"
                                aria-label="Onglets du fichier Excel"
                                sx={{ minHeight: '36px', '& .MuiTab-root': { minHeight: '36px', py: 1, textTransform: 'none', fontSize: '13px' } }}
                            >
                                {sheetNames.map((sheet) => (
                                    <Tab key={sheet} label={sheet} value={sheet} />
                                ))}
                            </Tabs>
                        </Box>
                    )}

                    <Box sx={{ flexGrow: 1, overflow: 'auto', p: 0, bgcolor: '#fff' }}>
                        {loading ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <CircularProgress size={40} sx={{ mb: 2 }} />
                                <Typography variant="body2" color="text.secondary">Chargement du classeur...</Typography>
                            </Box>
                        ) : error ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <Typography color="error" gutterBottom>{error}</Typography>
                            </Box>
                        ) : (
                            <Box sx={{
                                p: 2,
                                '& table': {
                                    borderCollapse: 'collapse',
                                    minWidth: '50%',
                                    border: '1px solid #e0e0e0',
                                    fontFamily: 'Calibri, Arial, sans-serif',
                                    fontSize: '11pt',
                                    backgroundColor: '#fff'
                                },
                                '& td, & th': {
                                    border: '1px solid #e0e0e0',
                                    padding: '4px 8px',
                                    whiteSpace: 'nowrap',
                                    height: '24px'
                                },
                                '& tr:first-of-type td': {
                                    fontWeight: 'bold',
                                    backgroundColor: '#f3f3f3',
                                    textAlign: 'center',
                                    borderBottom: '2px solid #d0d0d0'
                                },
                            }}>
                                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(excelHtml || '') }} />
                            </Box>
                        )}
                    </Box>
                    <Box sx={{ p: 1, textAlign: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                            Aperçu simplifié (Excel).
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
                            Seuls les fichiers .docx, .xls, .xlsx et .pdf peuvent être prévisualisés localement.
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
