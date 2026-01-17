import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, IconButton, Button } from '@mui/material';
import { FolderOpen, ChevronLeft, ChevronRight, Close, Image as ImageIcon, PictureAsPdf, Circle } from '@mui/icons-material';
import type { Attachment } from '../types';

interface DocumentViewerProps {
    activeAttachment: Attachment | null;
    allAttachments: Attachment[];
    onSelectAttachment: (att: Attachment) => void;
    onClose?: () => void;
    enableLaser?: boolean;
    enableDrawing?: boolean;
    onPageChange?: (page: number) => void;
    isProjection?: boolean;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({
    activeAttachment,
    allAttachments,
    onSelectAttachment,
    onClose,
    enableLaser = false,
    enableDrawing = false,
    isProjection = false
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = activeAttachment?.pageCount || (activeAttachment?.type === 'image' ? 1 : 12);

    const [laserPos, setLaserPos] = useState({ x: 0, y: 0 });
    const [showLaser, setShowLaser] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);

    useEffect(() => {
        setCurrentPage(1);
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, [activeAttachment]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (enableLaser && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setLaserPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            setShowLaser(true);
        } else {
            setShowLaser(false);
        }

        if (enableDrawing && isDrawing && canvasRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.lineTo(x, y);
                ctx.stroke();
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
    }, [activeAttachment, enableDrawing]);


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

            {/* Floating Header */}
            {!isProjection && (
                <Box className="header-controls" sx={{
                    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, p: 3,
                    opacity: 0, transition: 'opacity 0.3s',
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
                    pointerEvents: 'none'
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', pointerEvents: 'auto' }}>

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
                    flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', cursor: (enableDrawing || enableLaser) ? 'crosshair' : 'default'
                }}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { setShowLaser(false); setIsDrawing(false); }}
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
                        <Box sx={{ width: '100%', height: '100%', bgcolor: 'white', boxShadow: 10, overflow: 'hidden' }}>
                            {activeAttachment.name.match(/\.(xlsx|xls)$/i) ? (
                                <iframe
                                    src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(activeAttachment.url)}`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    title={activeAttachment.name}
                                />
                            ) : activeAttachment.name.match(/\.(docx|doc|pptx|ppt)$/i) ? (
                                <iframe
                                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(activeAttachment.url)}&embedded=true`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    title={activeAttachment.name}
                                />
                            ) : (
                                <iframe
                                    src={activeAttachment.url}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    title={activeAttachment.name}
                                />
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

            {/* Floating Status */}
            {!isProjection && (
                <Box className="header-controls" sx={{
                    position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                    px: 3, py: 1, borderRadius: 10, bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', gap: 2,
                    opacity: 0, transition: 'opacity 0.3s', zIndex: 50, pointerEvents: 'none',
                }}>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 900, letterSpacing: '0.2em' }}>
                        {activeAttachment.name.toUpperCase()}
                    </Typography>
                    {(enableLaser || enableDrawing) && (
                        <Typography variant="caption" sx={{ color: '#f87171', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Circle sx={{ fontSize: 6 }} /> LIVE TOOLS
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default DocumentViewer;
