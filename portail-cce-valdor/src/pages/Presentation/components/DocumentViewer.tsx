import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, IconButton, Button, CircularProgress } from '@mui/material';
import { FolderOpen, Close, Image as ImageIcon, PictureAsPdf, TableView, Web } from '@mui/icons-material';
import type { Attachment } from '../types';
import * as XLSX from 'xlsx';
import { renderAsync } from 'docx-preview';
import { PdfRenderer } from './PdfRenderer';

interface DocumentViewerProps {
    activeAttachment: Attachment | null;
    allAttachments: Attachment[];
    onSelectAttachment: (att: Attachment) => void;
    onClose?: () => void;
    enableLaser?: boolean;
    enableDrawing?: boolean;
    onPageChange?: (page: number) => void;
    currentPage?: number; // Controlled page number
    isProjection?: boolean;
    // New Sync Props
    onLaserMove?: (pos: { x: number, y: number }) => void;
    onDrawLine?: (line: { x: number, y: number }) => void;
    onScroll?: (scrollTop: number, scrollPercent: number) => void;
    // Slave Props (for Projection)
    externalLaserPos?: { x: number, y: number };
    externalDrawPoints?: { x: number, y: number }[];
    externalScrollPercent?: number;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({
    activeAttachment,
    allAttachments,
    onSelectAttachment,
    onClose,
    enableLaser = false,
    enableDrawing = false,
    isProjection = false,
    onLaserMove,
    onDrawLine,
    onScroll,
    externalLaserPos,
    externalDrawPoints,
    externalScrollPercent,
    // currentPage, // Not used in continuous scroll mode, but kept for interface compatibility
    // onPageChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const docxContainerRef = useRef<HTMLDivElement>(null);

    const [laserPos, setLaserPos] = useState({ x: 0, y: 0 });
    const [showLaser, setShowLaser] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);

    // DOCX State
    const [docxLoading, setDocxLoading] = useState(false);
    const [docxError, setDocxError] = useState<string | null>(null);

    // Excel Native Mode State
    const [useNativeExcel, setUseNativeExcel] = useState(true); // Default to native for local handling
    const [excelHtml, setExcelHtml] = useState<string | null>(null);

    // Reset states on attachment change
    useEffect(() => {
        setUseNativeExcel(true);
        setExcelHtml(null);
        setDocxError(null);

        // Clear canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, [activeAttachment]);

    // DOCX Rendering
    useEffect(() => {
        const renderDocx = async () => {
            if (activeAttachment?.name.toLowerCase().endsWith('.docx') && docxContainerRef.current) {
                setDocxLoading(true);
                setDocxError(null);
                try {
                    const response = await fetch(activeAttachment.url);
                    if (!response.ok) throw new Error("Erreur network");
                    const blob = await response.blob();

                    if (docxContainerRef.current) {
                        docxContainerRef.current.innerHTML = ''; // Clear previous
                        await renderAsync(blob, docxContainerRef.current, docxContainerRef.current, {
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
                } catch (err) {
                    console.error("Error rendering DOCX:", err);
                    setDocxError("Impossible d'afficher le document DOCX.");
                } finally {
                    setDocxLoading(false);
                }
            }
        };
        renderDocx();
    }, [activeAttachment]);

    // Excel Parsing
    useEffect(() => {
        const loadExcel = async () => {
            if (activeAttachment && activeAttachment.name.match(/\.(xlsx|xls)$/i)) {
                try {
                    const response = await fetch(activeAttachment.url);
                    const arrayBuffer = await response.arrayBuffer();
                    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const html = XLSX.utils.sheet_to_html(worksheet, { id: 'excel-table', editable: false });
                    setExcelHtml(html);
                } catch (err) {
                    console.error("Failed to parse Excel native", err);
                }
            }
        };
        loadExcel();
    }, [activeAttachment]);

    // Slave Mode Effect: Sync Laser
    useEffect(() => {
        if (isProjection && externalLaserPos) {
            setLaserPos(externalLaserPos);
            setShowLaser(true);
        }
    }, [isProjection, externalLaserPos]);

    // Slave Mode Effect: Sync Scroll
    useEffect(() => {
        if (!isProjection || externalScrollPercent === undefined || !containerRef.current) return;

        // Apply scroll to container
        const el = containerRef.current;
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll > 0) {
            const targetTop = maxScroll * externalScrollPercent;
            el.scrollTo({ top: targetTop, behavior: 'auto' });
        }
    }, [isProjection, externalScrollPercent]);

    // Slave Mode Effect: Sync Drawing
    useEffect(() => {
        if (isProjection && externalDrawPoints && externalDrawPoints.length > 0 && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.strokeStyle = 'red';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';

                const lastPoint = externalDrawPoints[externalDrawPoints.length - 1];

                ctx.lineTo(lastPoint.x, lastPoint.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(lastPoint.x, lastPoint.y);
            }
        }
    }, [isProjection, externalDrawPoints]);


    const handleMouseMove = (e: React.MouseEvent) => {
        if (enableLaser && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Adjust calculations to be relative to the scrollable content if needed, 
            // but for overlay overlay logic, viewport relative is usually expected unless we transform coords.
            // Here we assume the overlay covers the viewport of the container.

            setLaserPos({ x, y });
            setShowLaser(true);
            if (onLaserMove) onLaserMove({ x, y });
        } else {
            setShowLaser(false);
        }

        if (enableDrawing && isDrawing && canvasRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.stroke();
                if (onDrawLine) onDrawLine({ x, y });
            }
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (enableDrawing && canvasRef.current && containerRef.current) {
            setIsDrawing(true);
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.strokeStyle = 'red';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x, y);
            }
        }
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        if (canvasRef.current) canvasRef.current.getContext('2d')?.closePath();
    };

    useEffect(() => {
        if (containerRef.current && canvasRef.current) {
            canvasRef.current.width = containerRef.current.offsetWidth;
            canvasRef.current.height = containerRef.current.offsetHeight;
        }

        const handleScroll = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target && onScroll) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                const scrollPercent = maxScroll > 0 ? target.scrollTop / maxScroll : 0;
                onScroll(target.scrollTop, scrollPercent);
            }
        };

        const currentContainer = containerRef.current;
        if (currentContainer) {
            currentContainer.addEventListener('scroll', handleScroll, { passive: true });
        }

        return () => {
            if (currentContainer) {
                currentContainer.removeEventListener('scroll', handleScroll);
            }
        };
    }, [activeAttachment, enableDrawing, onScroll]);


    if (!activeAttachment) {
        if (isProjection) return null;

        return (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#020617' }}>
                <Box sx={{ textAlign: 'center', opacity: 0.3, color: '#64748b' }}>
                    <FolderOpen sx={{ fontSize: 64, mb: 2 }} />
                    <Typography variant="body2" sx={{ fontWeight: 'medium', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                        Aucun document sélectionné
                    </Typography>
                </Box>
            </Box>
        );
    }

    const isImage = activeAttachment.type === 'image';
    const isPdf = activeAttachment.type === 'pdf' || activeAttachment.name.toLowerCase().endsWith('.pdf');
    const isDocx = activeAttachment.name.toLowerCase().endsWith('.docx');
    const isExcel = activeAttachment.name.match(/\.(xlsx|xls)$/i);

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#020617', position: 'relative', overflow: 'hidden', '&:hover .header-controls': { opacity: 1 } }}>

            {/* Floating Header */}
            {!isProjection && (
                <Box className="header-controls" sx={{
                    position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', zIndex: 100, p: 0,
                    opacity: 1,
                    transition: 'opacity 0.3s',
                    width: 'auto', pointerEvents: 'none'
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, pointerEvents: 'auto', bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', borderRadius: 10, p: 1 }}>

                        {/* Tabs */}
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            {allAttachments.length > 1 && allAttachments.map((att) => (
                                <Button
                                    key={att.id}
                                    onClick={() => onSelectAttachment(att)}
                                    startIcon={att.type === 'image' ? <ImageIcon sx={{ fontSize: 14 }} /> : <PictureAsPdf sx={{ fontSize: 14 }} />}
                                    sx={{
                                        px: 2, py: 0.5, borderRadius: 10, backdropFilter: 'blur(8px)',
                                        fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em',
                                        bgcolor: activeAttachment.id === att.id ? 'rgba(5, 150, 105, 0.9)' : 'rgba(255,255,255,0.1)',
                                        color: activeAttachment.id === att.id ? 'white' : '#cbd5e1',
                                        boxShadow: activeAttachment.id === att.id ? 4 : 'none',
                                        '&:hover': { bgcolor: activeAttachment.id === att.id ? 'rgba(5, 150, 105, 1)' : 'rgba(255,255,255,0.2)' }
                                    }}
                                >
                                    {att.name}
                                </Button>
                            ))}
                        </Box>

                        {/* Controls */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            {onClose && (
                                <IconButton onClick={onClose} size="small" sx={{ bgcolor: 'rgba(0,0,0,0.4)', color: 'white', '&:hover': { bgcolor: 'white', color: 'black' } }}>
                                    <Close fontSize="small" />
                                </IconButton>
                            )}
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Content Viewport */}
            <Box
                ref={containerRef}
                sx={{
                    flex: 1, overflow: 'auto',
                    // For PDF and DOCX we want block display to allow scrolling, for images maybe flex center
                    // But 'display: flex' interferes with scrollable block content if we are not careful.
                    // Let's use flex for image, block for others.
                    display: isImage ? 'flex' : 'block',
                    alignItems: isImage ? 'center' : 'initial',
                    justifyContent: isImage ? 'center' : 'initial',
                    position: 'relative', cursor: (enableDrawing || enableLaser) ? 'crosshair' : 'default',
                    bgcolor: '#334155' // Darker bg for viewer context
                }}
                onMouseMove={!isProjection ? handleMouseMove : undefined}
                onMouseDown={!isProjection ? handleMouseDown : undefined}
                onMouseUp={!isProjection ? handleMouseUp : undefined}
                onMouseLeave={() => { if (!isProjection) { setShowLaser(false); setIsDrawing(false); } }}
            >
                {/* Overlay to capture mouse events */}
                {(enableLaser || enableDrawing) && (
                    <Box sx={{ position: 'sticky', top: 0, left: 0, width: '100%', height: '100%', minHeight: '100vh', zIndex: 20, cursor: 'none' }} />
                )}

                {/* Content Container */}
                <Box sx={{
                    position: 'relative',
                    zIndex: 10,
                    width: '100%',
                    minHeight: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    p: 2
                }}>

                    {isImage && (
                        <img
                            src={activeAttachment.url}
                            alt={activeAttachment.name}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
                        />
                    )}

                    {isPdf && (
                        <PdfRenderer url={activeAttachment.url} />
                    )}

                    {isDocx && (
                        <Box sx={{ width: '100%', maxWidth: '900px', bgcolor: 'white', p: 4, minHeight: '800px', boxShadow: 3 }}>
                            {docxLoading && <CircularProgress />}
                            {docxError && <Typography color="error">{docxError}</Typography>}
                            <div ref={docxContainerRef} className="docx-content" />
                            <style>{`
                                .docx-preview-wrapper { padding: 0 !important; background: transparent !important; }
                            `}</style>
                        </Box>
                    )}

                    {isExcel && (
                        <Box sx={{ width: '100%', height: '100%', bgcolor: 'white', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            <Box sx={{ p: 1, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', bgcolor: '#f8fafc' }}>
                                <Button
                                    size="small"
                                    onClick={() => setUseNativeExcel(!useNativeExcel)}
                                    startIcon={useNativeExcel ? <Web /> : <TableView />}
                                    variant="outlined"
                                    color="secondary"
                                >
                                    {useNativeExcel ? "Vue Simple" : "Vue Grille"}
                                </Button>
                            </Box>

                            {excelHtml ? (
                                <Box sx={{ flex: 1, overflow: 'auto', p: 4, bgcolor: 'white' }}>
                                    <style>
                                        {`
                                      #excel-table table { border-collapse: collapse; width: 100%; font-family: sans-serif; }
                                      #excel-table td, #excel-table th { border: 1px solid #cbd5e1; padding: 4px 8px; font-size: 14px; }
                                      #excel-table tr:nth-of-type(even) { background-color: #f8fafc; }
                                    `}
                                    </style>
                                    <div dangerouslySetInnerHTML={{ __html: excelHtml }} />
                                </Box>
                            ) : (
                                <Box sx={{ p: 4, textAlign: 'center' }}>
                                    <Typography>Chargement Excel...</Typography>
                                </Box>
                            )}
                        </Box>
                    )}

                    {/* Fallback for others */}
                    {!isImage && !isPdf && !isDocx && !isExcel && (
                        <Box sx={{ color: 'white', textAlign: 'center', mt: 10 }}>
                            <Typography variant="h5" gutterBottom>Format non supporté pour l'aperçu rapide</Typography>
                            <Button variant="contained" href={activeAttachment.url} target="_blank">Télécharger</Button>
                        </Box>
                    )}
                </Box>

                {enableDrawing && <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none' }} />}

                {enableLaser && showLaser && (
                    <Box
                        sx={{
                            position: 'absolute', width: 16, height: 16, bgcolor: '#dc2626', borderRadius: '50%',
                            boxShadow: '0 0 15px 4px rgba(220,38,38,0.8)', zIndex: 40, pointerEvents: 'none', mixBlendMode: 'screen',
                            left: laserPos.x, top: laserPos.y, transform: 'translate(-50%, -50%)'
                        }}
                    >
                        <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#ef4444', borderRadius: '50%', animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite', opacity: 0.5 }} />
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default DocumentViewer;
