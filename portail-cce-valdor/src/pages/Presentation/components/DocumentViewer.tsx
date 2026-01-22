import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, IconButton, Button } from '@mui/material';
import { FolderOpen, ChevronLeft, ChevronRight, Close, Image as ImageIcon, PictureAsPdf, TableView, Web } from '@mui/icons-material';
import type { Attachment } from '../types';
import * as XLSX from 'xlsx';
import DocViewer, { DocViewerRenderers } from '@cyntler/react-doc-viewer';

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
    currentPage: controlledPage,
    onPageChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [internalPage, setInternalPage] = useState(1);
    const currentPage = controlledPage || internalPage; // Use prop if available, else internal
    const setCurrentPage = (page: number | ((prev: number) => number)) => {
        const newPage = typeof page === 'function' ? page(currentPage) : page;
        setInternalPage(newPage);
        if (onPageChange) onPageChange(newPage);
    };

    const totalPages = activeAttachment?.pageCount || (activeAttachment?.type === 'image' ? 1 : 12);

    const [laserPos, setLaserPos] = useState({ x: 0, y: 0 });
    const [showLaser, setShowLaser] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);

    // Excel Native Mode State
    const [useNativeExcel, setUseNativeExcel] = useState(false);
    const [excelHtml, setExcelHtml] = useState<string | null>(null);

    // Reset native mode on attachment change
    useEffect(() => {
        setUseNativeExcel(false);
        setExcelHtml(null);
    }, [activeAttachment]);

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

    // Slave Mode Effect: Sync Scroll (Percentage-based for DocViewer compatibility)
    useEffect(() => {
        if (!isProjection || externalScrollPercent === undefined || !containerRef.current) return;

        // Find all scrollable elements inside the container (including DocViewer internals)
        const findScrollableElements = (root: HTMLElement): HTMLElement[] => {
            const scrollables: HTMLElement[] = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node = walker.currentNode as HTMLElement;
            while (node) {
                const style = getComputedStyle(node);
                const isScrollable =
                    (style.overflow === 'auto' || style.overflow === 'scroll' ||
                        style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                    node.scrollHeight > node.clientHeight;
                if (isScrollable) {
                    scrollables.push(node);
                }
                node = walker.nextNode() as HTMLElement;
            }
            return scrollables;
        };

        // Apply scroll to container and all internal scrollable elements
        const applyScroll = () => {
            const scrollables = findScrollableElements(containerRef.current!);
            [...scrollables, containerRef.current!].forEach(el => {
                const maxScroll = el.scrollHeight - el.clientHeight;
                if (maxScroll > 0) {
                    const targetTop = maxScroll * externalScrollPercent;
                    el.scrollTo({ top: targetTop, behavior: 'auto' });
                }
            });
        };

        // Apply immediately and after a delay (for DocViewer to load)
        applyScroll();
        const timer = setTimeout(applyScroll, 500);
        return () => clearTimeout(timer);
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
            canvasRef.current.width = containerRef.current.offsetWidth;
            canvasRef.current.height = containerRef.current.offsetHeight;
        }

        // Find ALL scrollable elements inside the container (including DocViewer internals)
        const findScrollableElements = (root: HTMLElement): HTMLElement[] => {
            const scrollables: HTMLElement[] = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node = walker.currentNode as HTMLElement;
            while (node) {
                const style = getComputedStyle(node);
                const isScrollable =
                    (style.overflow === 'auto' || style.overflow === 'scroll' ||
                        style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                    node.scrollHeight > node.clientHeight;
                if (isScrollable) {
                    scrollables.push(node);
                }
                node = walker.nextNode() as HTMLElement;
            }
            return scrollables;
        };

        const handleScroll = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target && onScroll) {
                // Calculate scroll percentage for zoom-independent sync
                const maxScroll = target.scrollHeight - target.clientHeight;
                const scrollPercent = maxScroll > 0 ? target.scrollTop / maxScroll : 0;
                onScroll(target.scrollTop, scrollPercent);
            }
        };

        // Setup scroll listeners on all found scrollable elements
        let scrollableElements: HTMLElement[] = [];
        const setupListeners = () => {
            if (!containerRef.current) return;
            scrollableElements = findScrollableElements(containerRef.current);
            scrollableElements.forEach(el => {
                el.addEventListener('scroll', handleScroll, { passive: true });
            });
            // Also listen on the container itself
            containerRef.current.addEventListener('scroll', handleScroll, { passive: true });
        };

        // Use MutationObserver to re-setup listeners when DOM changes (DocViewer loads)
        const observer = new MutationObserver(() => {
            // Cleanup old listeners
            scrollableElements.forEach(el => el.removeEventListener('scroll', handleScroll));
            // Setup new listeners
            setupListeners();
        });

        if (containerRef.current) {
            observer.observe(containerRef.current, { childList: true, subtree: true });
            // Initial setup after a small delay for DocViewer to render
            setTimeout(setupListeners, 500);
        }

        return () => {
            observer.disconnect();
            scrollableElements.forEach(el => el.removeEventListener('scroll', handleScroll));
            containerRef.current?.removeEventListener('scroll', handleScroll);
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
                            {activeAttachment.type === 'pdf' && (
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

            {/* Content Viewport */}
            <Box
                ref={containerRef}
                sx={{
                    flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', cursor: (enableDrawing || enableLaser) ? 'crosshair' : 'default'
                }}
                onMouseMove={!isProjection ? handleMouseMove : undefined}
                onMouseDown={!isProjection ? handleMouseDown : undefined}
                onMouseUp={!isProjection ? handleMouseUp : undefined}
                onMouseLeave={() => { if (!isProjection) { setShowLaser(false); setIsDrawing(false); } }}
            >
                {/* Overlay to capture mouse events over iframe when tools are active */}
                {(enableLaser || enableDrawing) && (
                    <Box sx={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'none' }} />
                )}
                <Box sx={{ position: 'relative', zIndex: 10, width: '100%', height: '100%', p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {activeAttachment.type === 'image' ? (
                        <img
                            src={activeAttachment.url}
                            alt={activeAttachment.name}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
                        />
                    ) : (
                        <Box sx={{ width: '100%', height: '100%', bgcolor: 'white', boxShadow: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                            {/* Excel Toggle (only for Excel/XLSX files) */}
                            {activeAttachment.name.match(/\.(xlsx|xls)$/i) && !isProjection && (
                                <Box sx={{ p: 1, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', bgcolor: '#f8fafc' }}>
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
                            ) : activeAttachment.name.match(/\.(xlsx|xls|docx|doc|pptx|ppt|pdf)$/i) ? (
                                // ALL Office/PDF: Use DocViewer for native rendering (scroll sync works)
                                <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'white' }}>
                                    <DocViewer
                                        documents={[{ uri: activeAttachment.url, fileName: activeAttachment.name }]}
                                        pluginRenderers={DocViewerRenderers}
                                        config={{
                                            header: { disableHeader: true, disableFileName: true },
                                            pdfZoom: { defaultZoom: 1, zoomJump: 0.2 },
                                            pdfVerticalScrollByDefault: true
                                        }}
                                        style={{ width: '100%', height: '100%', minHeight: '500px' }}
                                    />
                                </Box>
                            ) : (
                                <iframe
                                    // Use a composite key that ONLY changes when we REALLY need a reload
                                    // Using just ID or ID+Page might cause flashing.
                                    // But PDF hash nav requires reload if it doesn't support pushState.
                                    // Try using `key` only on ID change, and let hash do the work.
                                    // If hash doesn't work, we revert to ID+Page key.
                                    key={`${activeAttachment.id}${isProjection ? `-${currentPage}` : ''}`}
                                    src={`${activeAttachment.url}#page=${currentPage}`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    title={activeAttachment.name}
                                />
                            )}

                            {/* Fallback/External Open Button for Office Docs */}
                            {(activeAttachment.name.match(/\.(xlsx|xls|docx|doc|pptx|ppt)$/i) && !isProjection) && (
                                <Box sx={{ position: 'absolute', bottom: 16, right: 16, zIndex: 15 }}>
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
