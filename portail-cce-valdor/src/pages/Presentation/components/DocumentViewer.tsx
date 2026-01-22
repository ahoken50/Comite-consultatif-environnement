import React, { useRef, useEffect, useState, useCallback } from 'react';
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
    currentPage?: number;
    isProjection?: boolean;
    onLaserMove?: (pos: { x: number, y: number }) => void;
    onDrawLine?: (line: { x: number, y: number }) => void;
    onScroll?: (scrollTop: number, scrollPercent: number) => void;
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
    currentPage: controlledPage,
    onPageChange
}) => {
    // ==================== REFS ====================
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const docxContainerRef = useRef<HTMLDivElement>(null);
    const isExternalScrolling = useRef(false);

    // ==================== STATE ====================
    const [internalPage, setInternalPage] = useState(1);
    const [detectedTotalPages, setDetectedTotalPages] = useState(0);
    const [laserPos, setLaserPos] = useState({ x: 0, y: 0 });
    const [showLaser, setShowLaser] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [useNativeExcel, setUseNativeExcel] = useState(false);
    const [excelHtml, setExcelHtml] = useState<string | null>(null);
    const [isZoomed, setIsZoomed] = useState(false);

    const currentPage = controlledPage || internalPage;
    const totalPages = detectedTotalPages || activeAttachment?.pageCount || 1;

    const setCurrentPage = useCallback((page: number | ((prev: number) => number)) => {
        const newPage = typeof page === 'function' ? page(currentPage) : page;
        setInternalPage(newPage);
        if (onPageChange) onPageChange(newPage);
    }, [currentPage, onPageChange]);

    // ==================== HELPER: Get File Type ====================
    const getFileType = (fileName: string): 'image' | 'pdf' | 'docx' | 'excel' | 'office' | 'unknown' => {
        const lower = fileName.toLowerCase();
        if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(lower)) return 'image';
        if (/\.pdf$/i.test(lower)) return 'pdf';
        if (/\.docx$/i.test(lower)) return 'docx';
        if (/\.(xlsx|xls)$/i.test(lower)) return 'excel';
        if (/\.(doc|pptx|ppt)$/i.test(lower)) return 'office';
        return 'unknown';
    };

    // ==================== RESET ON ATTACHMENT CHANGE ====================
    useEffect(() => {
        setDetectedTotalPages(0);
        setUseNativeExcel(false);
        setExcelHtml(null);
        setInternalPage(1);

        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        if (docxContainerRef.current) {
            docxContainerRef.current.innerHTML = '';
        }
    }, [activeAttachment?.id]);

    // ==================== DOCX RENDERING ====================
    useEffect(() => {
        const loadDocx = async () => {
            if (!activeAttachment || !docxContainerRef.current) return;
            if (getFileType(activeAttachment.name) !== 'docx') return;

            try {
                const response = await fetch(activeAttachment.url);
                const blob = await response.blob();
                docxContainerRef.current.innerHTML = '';

                await renderAsync(blob, docxContainerRef.current, undefined, {
                    className: 'docx-wrapper',
                    inWrapper: true,
                    ignoreWidth: false,
                    ignoreHeight: false,
                    ignoreFonts: false,
                    breakPages: true,
                    useBase64URL: true
                });
            } catch (err) {
                console.error("DOCX render error:", err);
            }
        };

        loadDocx();
    }, [activeAttachment]);

    // ==================== EXCEL RENDERING ====================
    useEffect(() => {
        const loadExcel = async () => {
            if (!useNativeExcel || !activeAttachment) return;
            if (getFileType(activeAttachment.name) !== 'excel') return;

            try {
                const response = await fetch(activeAttachment.url);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const html = XLSX.utils.sheet_to_html(worksheet, { id: 'excel-table', editable: false });
                setExcelHtml(html);
            } catch (err) {
                console.error("Excel parse error:", err);
            }
        };

        loadExcel();
    }, [useNativeExcel, activeAttachment]);

    // ==================== SCROLL SYNC (SENDER) ====================
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || !onScroll) return;

        let rafId: number | null = null;

        const handleScroll = () => {
            if (isExternalScrolling.current) return;

            if (!rafId) {
                rafId = requestAnimationFrame(() => {
                    if (container) {
                        // Send percentage for zoom-independent sync
                        const maxScroll = container.scrollHeight - container.clientHeight;
                        const scrollPercent = maxScroll > 0 ? container.scrollTop / maxScroll : 0;
                        console.log(`[SYNC SENDER] Emitting: ${scrollPercent * 100}%`);
                        onScroll(container.scrollTop, scrollPercent);
                    }
                    rafId = null;
                });
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [onScroll]);

    // ==================== SCROLL SYNC (RECEIVER) ====================
    useEffect(() => {
        if (!isProjection || externalScrollPercent === undefined || !scrollContainerRef.current) return;

        // Debug Log
        console.log(`[SYNC RECEIVER] Applying scroll: ${externalScrollPercent * 100}%`);

        isExternalScrolling.current = true;

        const container = scrollContainerRef.current;
        const maxScroll = container.scrollHeight - container.clientHeight;
        const targetTop = maxScroll * externalScrollPercent;

        if (maxScroll > 0) {
            container.scrollTo({
                top: targetTop,
                behavior: 'auto'
            });
        }

        const timer = setTimeout(() => { isExternalScrolling.current = false; }, 100);
        return () => clearTimeout(timer);
    }, [isProjection, externalScrollPercent, detectedTotalPages, activeAttachment?.id]);

    // ==================== CANVAS SIZING ====================
    useEffect(() => {
        const updateSize = () => {
            const container = scrollContainerRef.current;
            const canvas = canvasRef.current;
            if (!container || !canvas) return;

            if (canvas.width !== container.scrollWidth || canvas.height !== container.scrollHeight) {
                canvas.width = container.scrollWidth;
                canvas.height = container.scrollHeight;
            }
        };

        updateSize();
        const timer = setTimeout(updateSize, 1000);

        return () => clearTimeout(timer);
    }, [activeAttachment, enableDrawing]);

    // ==================== DRAWING HANDLERS ====================
    const getPoint = (e: React.MouseEvent) => {
        const container = scrollContainerRef.current;
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        return {
            x: e.clientX - rect.left + container.scrollLeft,
            y: e.clientY - rect.top + container.scrollTop
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isProjection) return;
        const point = getPoint(e);
        if (!point) return;

        if (enableLaser) {
            setLaserPos(point);
            setShowLaser(true);
            onLaserMove?.(point);
        }

        if (enableDrawing && isDrawing && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.lineTo(point.x, point.y);
                ctx.stroke();
                onDrawLine?.(point);
            }
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isProjection || !enableDrawing) return;
        const point = getPoint(e);
        if (!point || !canvasRef.current) return;

        setIsDrawing(true);
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
        }
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        canvasRef.current?.getContext('2d')?.closePath();
    };

    // ==================== EXTERNAL SYNC ====================
    useEffect(() => {
        if (!isProjection || !externalDrawPoints?.length || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        const lastPoint = externalDrawPoints[externalDrawPoints.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
    }, [isProjection, externalDrawPoints]);

    useEffect(() => {
        if (isProjection && externalLaserPos) {
            setLaserPos(externalLaserPos);
            setShowLaser(true);
        }
    }, [isProjection, externalLaserPos]);

    // ==================== RENDER: NO ATTACHMENT ====================
    if (!activeAttachment) {
        if (isProjection) return null;
        return (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#1e293b' }}>
                <Box sx={{ textAlign: 'center', color: '#64748b' }}>
                    <FolderOpen sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
                    <Typography variant="body2" sx={{ opacity: 0.5 }}>Aucun document sélectionné</Typography>
                </Box>
            </Box>
        );
    }

    // ==================== DETERMINE FILE TYPE ====================
    const fileType = getFileType(activeAttachment.name);

    // ==================== RENDER CONTENT ====================
    const renderContent = () => {
        switch (fileType) {
            case 'image':
                return (
                    <Box sx={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, bgcolor: '#1e293b', position: 'relative' }}>
                        <img
                            src={activeAttachment.url}
                            alt={activeAttachment.name}
                            style={{ maxWidth: isZoomed ? 'none' : '100%', maxHeight: isZoomed ? 'none' : '100%', objectFit: 'contain' }}
                        />
                        {!isProjection && (
                            <Button onClick={() => setIsZoomed(!isZoomed)} variant="contained" size="small" sx={{ position: 'absolute', top: 16, right: 16, bgcolor: 'rgba(0,0,0,0.6)' }}>
                                {isZoomed ? "Ajuster" : "Zoom 100%"}
                            </Button>
                        )}
                    </Box>
                );

            case 'pdf':
                return (
                    <Box id="pdf-container" sx={{ p: 4, bgcolor: '#475569', minHeight: '100%' }}>
                        <Box sx={{ maxWidth: 850, mx: 'auto' }}>
                            <PdfRenderer url={activeAttachment.url} onLoadComplete={setDetectedTotalPages} />
                        </Box>
                    </Box>
                );

            case 'docx':
                return (
                    <Box sx={{ p: 4, bgcolor: '#e2e8f0', minHeight: '100%' }}>
                        <Box
                            ref={docxContainerRef}
                            sx={{
                                maxWidth: 850,
                                mx: 'auto',
                                bgcolor: 'white',
                                boxShadow: 3,
                                minHeight: 1000,
                                '& .docx-wrapper': { padding: '40px !important', background: 'white !important' }
                            }}
                        />
                    </Box>
                );

            case 'excel':
                if (useNativeExcel && excelHtml) {
                    return (
                        <Box sx={{ p: 4, bgcolor: 'white' }}>
                            <style>{`
                                #excel-table table { border-collapse: collapse; width: 100%; font-family: sans-serif; }
                                #excel-table td, #excel-table th { border: 1px solid #cbd5e1; padding: 4px 8px; font-size: 14px; }
                                #excel-table tr:nth-of-type(even) { background-color: #f8fafc; }
                            `}</style>
                            <div dangerouslySetInnerHTML={{ __html: excelHtml }} />
                        </Box>
                    );
                }
                // Fall through to Google Viewer
                return (
                    <iframe
                        src={`https://docs.google.com/viewer?url=${encodeURIComponent(activeAttachment.url)}&embedded=true`}
                        style={{ width: '100%', height: '100%', minHeight: '80vh', border: 'none' }}
                        title={activeAttachment.name}
                    />
                );

            case 'office':
                return (
                    <iframe
                        src={`https://docs.google.com/viewer?url=${encodeURIComponent(activeAttachment.url)}&embedded=true`}
                        style={{ width: '100%', height: '100%', minHeight: '80vh', border: 'none' }}
                        title={activeAttachment.name}
                    />
                );

            default:
                return (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="error">Format non supporté: {activeAttachment.name}</Typography>
                        <Button variant="contained" onClick={() => window.open(activeAttachment.url, '_blank')} sx={{ mt: 2 }}>
                            Ouvrir l'original
                        </Button>
                    </Box>
                );
        }
    };

    // ==================== MAIN RENDER ====================
    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#1e293b', position: 'relative' }}>

            {/* Floating Controls */}
            {!isProjection && (
                <Box sx={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none' }}>
                    <Box sx={{ display: 'flex', gap: 2, pointerEvents: 'auto', bgcolor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', borderRadius: 3, p: 1 }}>

                        {allAttachments.length > 1 && allAttachments.map((att) => (
                            <Button
                                key={att.id}
                                size="small"
                                onClick={() => onSelectAttachment(att)}
                                startIcon={att.type === 'image' ? <ImageIcon /> : <PictureAsPdf />}
                                sx={{
                                    bgcolor: activeAttachment.id === att.id ? 'primary.main' : 'rgba(255,255,255,0.1)',
                                    color: 'white',
                                    '&:hover': { bgcolor: activeAttachment.id === att.id ? 'primary.dark' : 'rgba(255,255,255,0.2)' }
                                }}
                            >
                                {att.name}
                            </Button>
                        ))}

                        {fileType === 'pdf' && (
                            <Box sx={{ display: 'flex', alignItems: 'center', color: 'white' }}>
                                <IconButton onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} size="small" sx={{ color: 'white' }}>
                                    <ChevronLeft />
                                </IconButton>
                                <Typography variant="caption">{currentPage} / {totalPages}</Typography>
                                <IconButton onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} size="small" sx={{ color: 'white' }}>
                                    <ChevronRight />
                                </IconButton>
                            </Box>
                        )}

                        {fileType === 'excel' && (
                            <Button size="small" onClick={() => setUseNativeExcel(!useNativeExcel)} startIcon={useNativeExcel ? <Web /> : <TableView />} sx={{ color: 'white' }}>
                                {useNativeExcel ? "Google" : "Natif"}
                            </Button>
                        )}

                        {onClose && (
                            <IconButton onClick={onClose} size="small" sx={{ color: 'white' }}>
                                <Close />
                            </IconButton>
                        )}
                    </Box>
                </Box>
            )}

            {/* Open Original Button */}
            {(fileType === 'excel' || fileType === 'office' || fileType === 'docx') && !isProjection && (
                <Box sx={{ position: 'absolute', bottom: 80, right: 16, zIndex: 15 }}>
                    <Button variant="contained" size="small" onClick={() => window.open(activeAttachment.url, '_blank')} sx={{ bgcolor: 'rgba(0,0,0,0.7)' }}>
                        Ouvrir l'original
                    </Button>
                </Box>
            )}

            {/* ===== SCROLL CONTAINER ===== */}
            <Box
                id="my-pdf-container"
                ref={scrollContainerRef}
                sx={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    position: 'relative',
                    cursor: (enableDrawing || enableLaser) ? 'crosshair' : 'default'
                }}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { if (!isProjection) { setShowLaser(false); setIsDrawing(false); } }}
            >
                {/* Document Content */}
                {renderContent()}

                {/* Drawing Canvas */}
                {enableDrawing && (
                    <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 10 }} />
                )}

                {/* Laser Pointer */}
                {enableLaser && showLaser && (
                    <Box
                        sx={{
                            position: 'absolute',
                            width: 16,
                            height: 16,
                            bgcolor: '#dc2626',
                            borderRadius: '50%',
                            boxShadow: '0 0 15px 4px rgba(220,38,38,0.8)',
                            zIndex: 20,
                            pointerEvents: 'none',
                            left: laserPos.x - 8,
                            top: laserPos.y - 8
                        }}
                    />
                )}
            </Box>
        </Box>
    );
};

export default DocumentViewer;
