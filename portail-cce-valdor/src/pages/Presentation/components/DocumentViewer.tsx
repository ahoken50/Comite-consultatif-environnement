import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, IconButton, Button } from '@mui/material';
import { FolderOpen, ChevronLeft, ChevronRight, Close, Image as ImageIcon, PictureAsPdf, TableView, Web } from '@mui/icons-material';
import type { Attachment } from '../types';
import { renderAsync } from 'docx-preview';
import { PdfRenderer } from './PdfRenderer';
import * as XLSX from 'xlsx';

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
    onScroll?: (scrollTop: number, scrollLeft: number) => void;
    // Slave Props (for Projection)
    externalLaserPos?: { x: number, y: number };
    externalDrawPoints?: { x: number, y: number }[];
    externalScroll?: { top: number, left: number };
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
    externalScroll,
    currentPage: controlledPage,
    onPageChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isExternalScrolling = useRef(false);


    const [internalPage, setInternalPage] = useState(1);
    const currentPage = controlledPage || internalPage; // Use prop if available, else internal
    const setCurrentPage = (page: number | ((prev: number) => number)) => {
        const newPage = typeof page === 'function' ? page(currentPage) : page;
        setInternalPage(newPage);
        if (onPageChange) onPageChange(newPage);
    };

    const [detectedTotalPages, setDetectedTotalPages] = useState<number>(0);
    const totalPages = detectedTotalPages || activeAttachment?.pageCount || (activeAttachment?.type === 'image' ? 1 : 12);

    // Reset detected detectedTotalPages on new attachment
    useEffect(() => {
        setDetectedTotalPages(0);
        setUseNativeExcel(false);
        setExcelHtml(null);
        if (docxContainer) docxContainer.innerHTML = '';
    }, [activeAttachment?.id]);

    const [laserPos, setLaserPos] = useState({ x: 0, y: 0 });
    const [showLaser, setShowLaser] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);

    // Excel Native Mode State
    const [useNativeExcel, setUseNativeExcel] = useState(false);
    const [excelHtml, setExcelHtml] = useState<string | null>(null);
    const [isZoomed, setIsZoomed] = useState(false);

    // Native DOCX State
    const [docxContainer, setDocxContainer] = useState<HTMLDivElement | null>(null);

    // Reset native mode on attachment change


    // Parse DOCX Native
    useEffect(() => {
        const loadDocx = async () => {
            if (activeAttachment && activeAttachment.name.match(/\.docx$/i) && docxContainer) {
                try {
                    const response = await fetch(activeAttachment.url);
                    const blob = await response.blob();
                    await renderAsync(blob, docxContainer, docxContainer, {
                        className: 'docx-preview-wrapper',
                        inWrapper: true,
                        ignoreWidth: false,
                        ignoreHeight: false,
                        ignoreFonts: false,
                        breakPages: true,
                        experimental: false,
                        useBase64URL: true
                    });
                } catch (err) {
                    console.error("Failed to render DOCX native", err);
                }
            }
        };
        loadDocx();
    }, [activeAttachment, docxContainer]);

    // Parse Excel when in native mode
    useEffect(() => {
        const loadExcel = async () => {
            if (useNativeExcel && activeAttachment && activeAttachment.name.match(/\.(xlsx|xls)$/i)) {
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
    }, [useNativeExcel, activeAttachment]);

    useEffect(() => {
        // Reset page on attachment change
        if (!controlledPage) setInternalPage(1);
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
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
        if (isProjection && externalScroll && scrollRef.current) {
            isExternalScrolling.current = true;
            scrollRef.current.scrollTo({
                top: externalScroll.top,
                left: externalScroll.left,
                behavior: 'auto'
            });
            // Reset flag after a short delay
            setTimeout(() => {
                isExternalScrolling.current = false;
            }, 100);
        }
    }, [isProjection, externalScroll]);

    // Master Mode: Emit Scroll Events
    useEffect(() => {
        let rafId: number | null = null;
        let lastScroll = { top: 0, left: 0 };

        const handleScroll = (e: Event) => {
            if (isExternalScrolling.current) return;

            const target = e.target as HTMLDivElement;
            const newTop = target.scrollTop;
            const newLeft = target.scrollLeft;

            // Simple check to avoid processing if values haven't changed (though scroll event implies they did)
            if (newTop === lastScroll.top && newLeft === lastScroll.left) return;

            lastScroll = { top: newTop, left: newLeft };

            if (!rafId && onScroll) {
                rafId = requestAnimationFrame(() => {
                    onScroll(lastScroll.top, lastScroll.left);
                    rafId = null;
                });
            }
        };

        const scrollContainer = scrollRef.current;
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        }

        return () => {
            if (scrollContainer) {
                scrollContainer.removeEventListener('scroll', handleScroll);
            }
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [onScroll]);

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
            setLaserPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            setShowLaser(true);
            if (onLaserMove) onLaserMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
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
            // CRITICAL FIX: Canvas must match the SCROLLABLE height, not just the visible viewport
            // We use a ResizeObserver to keep it updated if content changes
            const updateCanvasSize = () => {
                if (containerRef.current && canvasRef.current) {
                    const newWidth = containerRef.current.scrollWidth;
                    const newHeight = containerRef.current.scrollHeight;

                    if (canvasRef.current.width !== newWidth || canvasRef.current.height !== newHeight) {
                        canvasRef.current.width = newWidth;
                        canvasRef.current.height = newHeight;

                        // Re-apply context settings after resize
                        const ctx = canvasRef.current.getContext('2d');
                        if (ctx) {
                            ctx.lineCap = 'round';
                            ctx.lineJoin = 'round';
                        }
                    }
                }
            };

            updateCanvasSize();

            // Observe changes in the container's size (content loading)
            const observer = new ResizeObserver(updateCanvasSize);
            observer.observe(containerRef.current);
            // Also observe the likely content child (if accessible via a wrapper ref)? 
            // The scroll container change should trigger it.

            // Also update on window resize
            window.addEventListener('resize', updateCanvasSize);

            return () => {
                observer.disconnect();
                window.removeEventListener('resize', updateCanvasSize);
            };
        }
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

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#020617', position: 'relative', overflow: 'hidden', '&:hover .header-controls': { opacity: 1 } }}>

            {/* Floating Header (Moved to Bottom to avoid PDF Toolbar overlap) */}
            {!isProjection && (
                <Box className="header-controls" sx={{
                    position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', zIndex: 100, p: 0,
                    opacity: 1, // Fixed: Always visible for now to test, user can remove 'opacity: 0' and hover effect if desired
                    transition: 'opacity 0.3s',
                    width: 'auto', pointerEvents: 'none' // Wrapper is none, children auto
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
                            {(activeAttachment.type === 'pdf' && !activeAttachment.name.match(/\.(xlsx|xls|docx|doc|pptx|ppt)$/i)) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', borderRadius: 10, px: 2, py: 0.5, color: 'rgba(255,255,255,0.8)' }}>
                                    <IconButton onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} size="small" sx={{ color: 'inherit', '&:disabled': { opacity: 0.3 } }}><ChevronLeft fontSize="small" /></IconButton>
                                    <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>{currentPage} / {totalPages}</Typography>
                                    <IconButton onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} size="small" sx={{ color: 'inherit', '&:disabled': { opacity: 0.3 } }}><ChevronRight fontSize="small" /></IconButton>
                                </Box>
                            )}
                            {onClose && (
                                <IconButton onClick={onClose} size="small" sx={{ bgcolor: 'rgba(0,0,0,0.4)', color: 'white', '&:hover': { bgcolor: 'white', color: 'black' } }}>
                                    <Close fontSize="small" />
                                </IconButton>
                            )}
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Content Viewport - SINGLE SCROLL CONTAINER */}
            <Box
                ref={(el: HTMLDivElement | null) => {
                    // Assign to both refs
                    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                }}
                sx={{
                    flex: 1,
                    minHeight: 0, // Fix for nested flex scrolling
                    overflowY: 'scroll', // Force scrollbar
                    overflowX: 'hidden',
                    position: 'relative',
                    cursor: (enableDrawing || enableLaser) ? 'crosshair' : 'default',
                    bgcolor: activeAttachment.type === 'image' ? '#020617' : '#f1f5f9', // Light background for docs
                }}
                onMouseMove={!isProjection ? handleMouseMove : undefined}
                onMouseDown={!isProjection ? handleMouseDown : undefined}
                onMouseUp={!isProjection ? handleMouseUp : undefined}
                onMouseLeave={() => { if (!isProjection) { setShowLaser(false); setIsDrawing(false); } }}
            >
                {/* Overlay to capture mouse events over iframe/container when tools are active */}
                {/* CRITICAL: This MUST be present for Drawing/Laser to work (captures events) */}
                {(enableLaser || enableDrawing) && (
                    <Box sx={{ position: 'absolute', inset: 0, zIndex: 55, cursor: 'crosshair', touchAction: 'none' }} />
                )}

                {/* CONTENT - No flex centering, just block layout */}
                {activeAttachment.type === 'image' ? (
                    <Box sx={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                        <img
                            src={activeAttachment.url}
                            alt={activeAttachment.name}
                            style={{
                                maxWidth: isZoomed ? 'none' : '100%',
                                maxHeight: isZoomed ? 'none' : '100%',
                                objectFit: 'contain',
                                transition: 'all 0.3s'
                            }}
                        />
                        {!isProjection && (
                            <Button
                                onClick={() => setIsZoomed(!isZoomed)}
                                variant="contained" size="small"
                                sx={{ position: 'absolute', top: 16, right: 16, bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
                            >
                                {isZoomed ? "Ajuster" : "Zoom 100%"}
                            </Button>
                        )}
                    </Box>
                ) : (
                    <>
                        {/* Excel Toggle (only for Excel/XLSX files) */}
                        {activeAttachment.name.match(/\.(xlsx|xls)$/i) && !isProjection && (
                            <Box sx={{ p: 1, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', bgcolor: '#f8fafc', position: 'sticky', top: 0, zIndex: 5 }}>
                                <Button
                                    size="small"
                                    onClick={() => setUseNativeExcel(!useNativeExcel)}
                                    startIcon={useNativeExcel ? <Web /> : <TableView />}
                                    variant="outlined"
                                    color="secondary"
                                >
                                    {useNativeExcel ? "Vue Web (Google)" : "Vue Cellules (Bêta)"}
                                </Button>
                            </Box>
                        )}

                        {(activeAttachment.name.match(/\.(xlsx|xls)$/i) && useNativeExcel && excelHtml) ? (
                            <Box sx={{ p: 4, bgcolor: 'white' }}>
                                <style>
                                    {`
                                  #excel-table table { border-collapse: collapse; width: 100%; font-family: sans-serif; }
                                  #excel-table td, #excel-table th { border: 1px solid #cbd5e1; padding: 4px 8px; font-size: 14px; }
                                  #excel-table tr:nth-of-type(even) { background-color: #f8fafc; }
                                `}
                                </style>
                                <div dangerouslySetInnerHTML={{ __html: excelHtml }} />
                            </Box>
                        ) : activeAttachment.name.match(/\.docx$/i) ? (
                            <Box sx={{ bgcolor: '#f1f5f9', p: 4, minHeight: '100%', pt: 8 /* Avoid Custom Header overlap */ }}>
                                <div
                                    ref={setDocxContainer}
                                    className="docx-content"
                                    style={{
                                        width: '100%',
                                        maxWidth: '850px',
                                        minHeight: '1000px', // Ensure it looks like a full page
                                        margin: '0 auto', // Center horizontally
                                        background: 'white',
                                        padding: '40px',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                        position: 'relative', // Ensure Z-index context
                                        zIndex: 1
                                    }}
                                />
                            </Box>
                        ) : activeAttachment.name.match(/\.(xlsx|xls|doc|pptx|ppt)$/i) ? (
                            <iframe
                                key={activeAttachment.id}
                                src={`https://docs.google.com/viewer?url=${encodeURIComponent(activeAttachment.url)}&embedded=true`}
                                style={{ width: '100%', height: '100%', minHeight: '80vh', border: 'none' }}
                                title={activeAttachment.name}
                            />
                        ) : (
                            // PDF Section - Switched to Block Layout for reliable scrolling
                            <Box sx={{ display: 'block', minHeight: '100%', p: 4, bgcolor: '#525659', pt: 8 }}>
                                <Box sx={{ maxWidth: '850px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <PdfRenderer url={activeAttachment.url} onLoadComplete={(total) => setDetectedTotalPages(total)} />
                                </Box>
                            </Box>
                        )}

                        {/* Fallback/External Open Button for Office Docs */}
                        {(activeAttachment.name.match(/\.(xlsx|xls|docx|doc|pptx|ppt)$/i) && !isProjection) && (
                            <Box sx={{ position: 'fixed', bottom: 80, right: 16, zIndex: 15 }}>
                                <Button
                                    variant="contained"
                                    size="small"
                                    onClick={() => window.open(activeAttachment.url, '_blank')}
                                    sx={{ bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' } }}
                                >
                                    Ouvrir l'original
                                </Button>
                            </Box>
                        )}
                    </>
                )}

                {enableDrawing && <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }} />}

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


        </Box >
    );
};

export default DocumentViewer;
