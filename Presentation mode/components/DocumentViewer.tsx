
import React, { useRef, useEffect, useState } from 'react';
import { Attachment } from '../types';

interface DocumentViewerProps {
  activeAttachment: Attachment | null;
  allAttachments: Attachment[];
  onSelectAttachment: (att: Attachment) => void;
  onClose?: () => void;
  enableLaser?: boolean;
  enableDrawing?: boolean;
  onPageChange?: (page: number) => void;
  isProjection?: boolean; // New prop to hide UI for projector
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
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // Resize canvas match container
  useEffect(() => {
      if (containerRef.current && canvasRef.current) {
          canvasRef.current.width = containerRef.current.offsetWidth;
          canvasRef.current.height = containerRef.current.offsetHeight;
      }
  }, [activeAttachment, enableDrawing]);


  if (!activeAttachment) {
    if (isProjection) return null; // Handled by parent in projection mode

    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950">
        <div className="text-center opacity-30">
            <i className="fa-regular fa-folder-open text-6xl mb-4 text-slate-500"></i>
            <p className="text-sm font-medium text-slate-400 tracking-widest uppercase">Aucun document sélectionné</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 relative group overflow-hidden">
      
      {/* Floating Header - Only visible on hover AND if NOT in projection mode */}
      {!isProjection && (
        <div className="absolute top-0 left-0 right-0 z-50 p-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
            <div className="flex items-start justify-between pointer-events-auto">
                
                {/* Tabs */}
                <div className="flex items-center gap-2">
                    {allAttachments.length > 1 && allAttachments.map((att) => (
                        <button
                            key={att.id}
                            onClick={() => onSelectAttachment(att)}
                            className={`px-4 py-2 rounded-full backdrop-blur-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                            activeAttachment.id === att.id 
                                ? 'bg-emerald-600/90 text-white shadow-lg' 
                                : 'bg-white/10 text-slate-300 hover:bg-white/20'
                            }`}
                        >
                            {att.name}
                        </button>
                    ))}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3">
                    {/* Page Nav */}
                    {activeAttachment.type === 'pdf' && (
                        <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-full px-4 py-2 text-white/80">
                            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="hover:text-white disabled:opacity-30"><i className="fa-solid fa-chevron-left"></i></button>
                            <span className="text-xs font-bold tabular-nums">{currentPage} / {totalPages}</span>
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="hover:text-white disabled:opacity-30"><i className="fa-solid fa-chevron-right"></i></button>
                        </div>
                    )}
                    {onClose && (
                        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-white hover:text-black transition-all">
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
      )}
      
      {/* Content Viewport */}
      <div 
        ref={containerRef}
        className={`flex-1 overflow-hidden flex items-center justify-center relative cursor-${enableDrawing ? 'crosshair' : 'default'}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setShowLaser(false); setIsDrawing(false); }}
      >
        <div className="relative z-10 w-full h-full p-4 flex items-center justify-center">
            {activeAttachment.type === 'image' ? (
            <img 
                src={activeAttachment.url} 
                alt={activeAttachment.name}
                className="max-w-full max-h-full object-contain shadow-2xl"
            />
            ) : (
            <div className="w-full h-full bg-white shadow-2xl overflow-hidden">
                <iframe 
                src={activeAttachment.url} 
                className="w-full h-full border-none pointer-events-none"
                title={activeAttachment.name}
                />
            </div>
            )}
        </div>

        {enableDrawing && <canvas ref={canvasRef} className="absolute inset-0 z-30 pointer-events-none" />}
        
        {enableLaser && showLaser && (
            <div 
                className="absolute w-4 h-4 bg-red-600 rounded-full shadow-[0_0_15px_4px_rgba(220,38,38,0.8)] z-40 pointer-events-none mix-blend-screen"
                style={{ left: laserPos.x, top: laserPos.y, transform: 'translate(-50%, -50%)' }}
            >
                <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-50"></div>
            </div>
        )}
      </div>

      {/* Floating Footer Status - Only for presenter */}
      {!isProjection && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-black text-white/60 tracking-[0.2em] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-50 flex items-center gap-4">
            <span>{activeAttachment.name.toUpperCase()}</span>
            {(enableLaser || enableDrawing) && <span className="text-red-400">• LIVE TOOLS ACTIVE</span>}
          </div>
      )}
    </div>
  );
};

export default DocumentViewer;
