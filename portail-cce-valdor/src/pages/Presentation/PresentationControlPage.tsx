import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, IconButton, CircularProgress, Backdrop, TextField } from '@mui/material';
import {
    Fullscreen, FullscreenExit, CrisisAlert, Create, Theaters, Edit, Menu,
    ArrowBack, ArrowLeft, ArrowRight
} from '@mui/icons-material';

import type { Attachment } from './types';
import { usePresentationData } from './hooks/usePresentationData';
import logoCce from '../../assets/logo-cce.png';

import AgendaSidebar from './components/AgendaSidebar';
import TopicTimer from './components/TopicTimer';
import DocumentViewer from './components/DocumentViewer';
import QuickNotesPanel from './components/QuickNotesPanel';

// Broadcast Channel for Dual Screen (#2)
// We include meetingId in channel name to support multiple instances (conceptually)
const getBroadcastChannel = (id: string) => new BroadcastChannel(`cce_presentation_${id}`);

const PresentationControlPage: React.FC = () => {
    const { id: meetingId } = useParams<{ id: string }>();
    const { meeting, loading, error, saveItemDuration } = usePresentationData(meetingId);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [documentPage, setDocumentPage] = useState(1); // Controlled document page
    const lastTimeRef = useRef<number>(Date.now());
    const currentIndexRef = useRef(currentIndex); // To track prev index in effects
    const [activeAttachment, setActiveAttachment] = useState<Attachment | null>(null);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [isNotesVisible, setIsNotesVisible] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isCinemaMode, setIsCinemaMode] = useState(false);

    // Interactive Tools State
    const [isLaserEnabled, setIsLaserEnabled] = useState(false);
    const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);

    // Search State
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Audio Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [_currentRecordingId, setCurrentRecordingId] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingIntervalRef = useRef<number | null>(null);
    const [pendingRecovery, setPendingRecovery] = useState<string | null>(null); // ID of crashed recording

    const channelRef = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        if (meetingId) {
            channelRef.current = getBroadcastChannel(meetingId);
        }
        return () => {
            channelRef.current?.close();
        };
    }, [meetingId]);

    useEffect(() => {
        if (channelRef.current) {
            channelRef.current.postMessage({
                type: 'SYNC_STATE',
                payload: { currentIndex, activeAttachment, isLaserEnabled, isDrawingEnabled, documentPage }
            });
        }
    }, [currentIndex, activeAttachment, isLaserEnabled, isDrawingEnabled, documentPage]);

    // Real-time Event Handlers for Dual Screen
    const handleLaserMove = useCallback((pos: { x: number, y: number }) => {
        channelRef.current?.postMessage({ type: 'SYNC_LASER', payload: pos });
    }, []);

    const handleDrawLine = useCallback((line: { x: number, y: number }) => {
        channelRef.current?.postMessage({ type: 'SYNC_DRAW', payload: line });
    }, []);

    // Note: Scroll sync is tricky with iframes/different viewports. 
    // We'll sync explicit page changes for PDFs/Images if applicable, or scroll percentage.
    const handleScrollSync = useCallback((scrollTop: number, scrollLeft: number) => {
        channelRef.current?.postMessage({ type: 'SYNC_SCROLL', payload: { scrollTop, scrollLeft } });
    }, []);

    const currentItem = meeting?.agenda[currentIndex];

    useEffect(() => {
        if (currentItem && currentItem.attachments.length > 0) setActiveAttachment(currentItem.attachments[0]);
        else setActiveAttachment(null);
        setDocumentPage(1); // Reset page on item change
    }, [currentIndex, currentItem]);

    // Reset page on attachment change (if triggered manually)
    useEffect(() => {
        setDocumentPage(1);
    }, [activeAttachment?.id]);

    // Time Tracking Logic
    useEffect(() => {
        // When currentIndex changes:
        // 1. Calculate time spent on PREVIOUS item
        // 2. Save it
        // 3. Reset timer for NEW item

        const now = Date.now();
        const elapsedSeconds = Math.round((now - lastTimeRef.current) / 1000);

        if (elapsedSeconds > 1 && meeting) { // Only save if meaningful time passed
            const prevIndex = currentIndexRef.current;
            // Prevent saving on initial mount if 0 time passed, but here we check elapsed > 1
            const prevItem = meeting.agenda[prevIndex];
            if (prevItem) {
                saveItemDuration(prevItem.id, elapsedSeconds);
            }
        }

        lastTimeRef.current = now;
        currentIndexRef.current = currentIndex;

        // Cleanup on unmount (save final item)
        return () => {
            // We can't easily save on unmount due to closure staleness, 
            // but 'currentIndex' change handles most cases.
        };
    }, [currentIndex, meeting, saveItemDuration]);

    // Secure Audio Logic
    useEffect(() => {
        const checkRecovery = async () => {
            const { secureRecordingManager } = await import('../../services/audio/SecureRecordingManager');
            const pending = await secureRecordingManager.listPendingRecordings();
            if (pending.length > 0) {
                setPendingRecovery(pending[0].id);
            }
        };
        checkRecovery();
    }, []);

    const startRecording = async () => {
        try {
            const { secureRecordingManager } = await import('../../services/audio/SecureRecordingManager');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Start secure session
            const recId = await secureRecordingManager.startRecording('audio/webm');
            setCurrentRecordingId(recId);

            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });

            let chunkIndex = 0;
            mediaRecorderRef.current.ondataavailable = async (event) => {
                if (event.data.size > 0 && recId) {
                    await secureRecordingManager.saveChunk(recId, event.data, chunkIndex++);
                }
            };

            mediaRecorderRef.current.onstop = async () => {
                if (recId) {
                    await secureRecordingManager.completeRecording(recId);
                    // Generate download immediately
                    const blob = await secureRecordingManager.recoverRecording(recId);
                    if (blob) {
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = `Enregistrement_Securise_${new Date().toISOString()}.webm`;
                        link.click();

                        // Optional: Clean up after download or keep as backup?
                        // For now keep as backup.
                    }
                }
            };

            mediaRecorderRef.current.start(1000); // Save chunk every 1s
            setIsRecording(true);
            recordingIntervalRef.current = window.setInterval(() => setRecordingSeconds(s => s + 1), 1000);
        } catch (err) {
            console.error(err);
            alert("Impossible d'accéder au microphone ou erreurs IndexDB.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
            setIsRecording(false);
            setRecordingSeconds(0);
            setCurrentRecordingId(null);
        }
    };

    const handleRecover = async () => {
        if (!pendingRecovery) return;
        const { secureRecordingManager } = await import('../../services/audio/SecureRecordingManager');
        const blob = await secureRecordingManager.recoverRecording(pendingRecovery);
        if (blob) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `Récupération_Crash_${new Date().toISOString()}.webm`;
            link.click();
        }
        await secureRecordingManager.deleteRecording(pendingRecovery);
        setPendingRecovery(null);
    };

    const handleDiscardRecovery = async () => {
        if (!pendingRecovery) return;
        const { secureRecordingManager } = await import('../../services/audio/SecureRecordingManager');
        await secureRecordingManager.deleteRecording(pendingRecovery);
        setPendingRecovery(null);
    };

    const formatDuration = (totalSeconds: number) => {
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Fullscreen Logic
    useEffect(() => {
        const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFsChange);
        return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.error);
        else document.exitFullscreen();
    };

    useEffect(() => {
        if (isCinemaMode) setIsSidebarCollapsed(true);
    }, [isCinemaMode]);

    const handleNext = useCallback(() => {
        if (meeting && currentIndex < meeting.agenda.length - 1) setCurrentIndex(prev => prev + 1);
    }, [currentIndex, meeting]);

    const handlePrev = useCallback(() => {
        if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
    }, [currentIndex]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) && e.key !== 'Escape') return;
            if (e.ctrlKey && e.key === 'k') { e.preventDefault(); setIsSearchOpen(v => !v); }
            else if (e.key === 'Escape') setIsSearchOpen(false);
            else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') handleNext();
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') handlePrev();
            else if (e.key === 'f') toggleFullscreen();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleNext, handlePrev]);

    const openProjectorWindow = () => {
        // Open route /meetings/:id/projection
        window.open(`/meetings/${meetingId}/projection`, 'CCE_Projector', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
    };

    if (loading) return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
    if (error || !meeting || !currentItem) return <Box sx={{ p: 4 }}><Typography color="error">{error || "Erreur de chargement"}</Typography></Box>;

    const filteredAgenda = meeting.agenda.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <Box sx={{
            height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            bgcolor: isFullscreen ? 'black' : 'white', color: isFullscreen ? 'white' : 'text.primary',
            transition: 'background-color 0.5s'
        }}>

            {/* HEADER */}
            <Box sx={{
                height: 90, px: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 30,
                borderBottom: isFullscreen ? 'none' : '1px solid #e2e8f0',
                bgcolor: isFullscreen ? 'black' : 'white',
                color: isFullscreen ? 'white' : 'text.primary',
                transition: 'all 0.3s'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box onClick={openProjectorWindow} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }}>
                        <Box sx={{
                            width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            bgcolor: 'white', overflow: 'hidden', p: 0.5, boxShadow: 1
                        }}>
                            <img src={logoCce} alt="CCE" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </Box>
                        <Box>
                            <Typography variant="body1" sx={{ fontWeight: 800, lineHeight: 1.2, display: 'block', color: isFullscreen ? 'white' : '#1e293b' }}>
                                Comité Consultatif<br />en Environnement
                            </Typography>
                        </Box>
                    </Box>
                    <Box sx={{ height: 32, width: '1px', bgcolor: '#e2e8f0', mx: 1 }} />
                    <Typography variant="caption" sx={{ fontWeight: 'medium', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {meeting.date}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {/* Recording */}
                    <Box
                        component="button"
                        onClick={isRecording ? stopRecording : startRecording}
                        sx={{
                            display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderRadius: 10, transition: 'all 0.3s',
                            bgcolor: isRecording ? '#fff1f2' : '#f8fafc', color: isRecording ? '#e11d48' : '#64748b',
                            border: '2px solid', borderColor: isRecording ? '#e11d48' : 'transparent',
                            cursor: 'pointer', outline: 'none',
                            '&:hover': { bgcolor: isRecording ? '#ffe4e6' : '#f1f5f9' }
                        }}
                    >
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: isRecording ? '#ef4444' : '#94a3b8', animation: isRecording ? 'pulse 2s infinite' : 'none' }} />
                        <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>
                            {formatDuration(recordingSeconds)}
                        </Typography>
                        {isRecording && <Box title="Enregistrement Sécurisé Activé (Anti-Crash)" sx={{ fontSize: 12 }}>🛡️</Box>}
                    </Box>

                    {/* Recovery Alert */}
                    <Backdrop open={!!pendingRecovery} sx={{ zIndex: 2000 }}>
                        <Box sx={{ bgcolor: 'white', p: 4, borderRadius: 2, boxShadow: 24, textAlign: 'center' }}>
                            <Typography variant="h5" color="warning.main" gutterBottom>⚠️ Enregistrement non terminé détecté</Typography>
                            <Typography sx={{ mb: 3 }}>Il semble que l'application a quitté inopinément pendant un enregistrement.</Typography>
                            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                                <Box component="button" onClick={handleRecover} sx={{ px: 3, py: 1, bgcolor: '#059669', color: 'white', borderRadius: 1, border: 'none', cursor: 'pointer' }}>
                                    Récupérer le fichier
                                </Box>
                                <Box component="button" onClick={handleDiscardRecovery} sx={{ px: 3, py: 1, bgcolor: '#ef4444', color: 'white', borderRadius: 1, border: 'none', cursor: 'pointer' }}>
                                    Supprimer
                                </Box>
                            </Box>
                        </Box>
                    </Backdrop>

                    <TopicTimer
                        initialMinutes={currentItem.durationInMinutes}
                        actualDuration={currentItem.actualDuration || 0}
                    />

                    <Box sx={{ height: 24, width: '1px', bgcolor: '#e2e8f0', mx: 0.5 }} />

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <IconButton onClick={() => setIsLaserEnabled(!isLaserEnabled)} sx={{ color: isLaserEnabled ? '#dc2626' : '#94a3b8', bgcolor: isLaserEnabled ? '#fef2f2' : 'transparent', borderRadius: 2 }} title="Pointeur Laser"><CrisisAlert /></IconButton>
                        <IconButton onClick={() => setIsDrawingEnabled(!isDrawingEnabled)} sx={{ color: isDrawingEnabled ? '#d97706' : '#94a3b8', bgcolor: isDrawingEnabled ? '#fffbeb' : 'transparent', borderRadius: 2 }} title="Dessiner"><Create /></IconButton>
                        <Box sx={{ width: '1px', height: 16, bgcolor: '#e2e8f0', mx: 0.5 }} />
                        <IconButton onClick={() => setIsCinemaMode(!isCinemaMode)} sx={{ color: isCinemaMode ? '#4f46e5' : '#94a3b8', bgcolor: isCinemaMode ? '#eef2ff' : 'transparent', borderRadius: 2 }} title="Mode Cinéma"><Theaters /></IconButton>
                        <IconButton onClick={() => setIsNotesVisible(!isNotesVisible)} sx={{ color: isNotesVisible ? '#d97706' : '#94a3b8', bgcolor: isNotesVisible ? '#fffbeb' : 'transparent', borderRadius: 2 }}><Edit /></IconButton>
                        <IconButton onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} sx={{ color: '#94a3b8', borderRadius: 2 }}><Menu /></IconButton>
                        <IconButton onClick={toggleFullscreen} sx={{ color: '#94a3b8', borderRadius: 2 }}>{isFullscreen ? <FullscreenExit /> : <Fullscreen />}</IconButton>
                    </Box>
                </Box>
            </Box>

            {/* BODY */}
            <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* Sidebar */}
                <Box sx={{
                    transition: 'all 0.3s cubic-bezier(0.25,0.1,0.25,1)', overflow: 'hidden',
                    width: isSidebarCollapsed || isCinemaMode ? 0 : 320, opacity: isSidebarCollapsed || isCinemaMode ? 0 : 1
                }}>
                    {meeting && <AgendaSidebar items={meeting.agenda} currentIndex={currentIndex} onSelect={setCurrentIndex} />}
                </Box>

                {/* Main Content */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    <Box sx={{ flex: 1, display: 'flex' }}>

                        {/* Details Panel */}
                        <Box sx={{
                            overflowY: 'auto', transition: 'all 0.5s ease-in-out',
                            bgcolor: isFullscreen ? 'black' : 'white', color: isFullscreen ? 'rgba(255,255,255,0.7)' : 'text.primary',
                            width: isCinemaMode ? 0 : '35%', opacity: isCinemaMode ? 0 : 1, p: isCinemaMode ? 0 : 5, // Use 0 padding when hidden
                            height: '100%', // Ensure full height for scrolling
                            maxHeight: '100%' // Crucial for overflow to work in flex child
                        }}>
                            <Box sx={{ minWidth: 300, display: isCinemaMode ? 'none' : 'block' }}> {/* Hide content when collapsed to avoid layout shifts */}
                                {/* Header */}
                                <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Typography variant="h3" sx={{ fontWeight: 900, color: 'text.disabled', fontFamily: 'monospace' }}>
                                        {(currentIndex + 1).toString().padStart(2, '0')}
                                    </Typography>
                                    <Box sx={{ height: 1, flex: 1, bgcolor: 'divider' }} />
                                    <Typography variant="overline" sx={{ fontWeight: 'bold', color: 'text.secondary', letterSpacing: '0.1em' }}>
                                        En Discussion
                                    </Typography>
                                </Box>

                                {/* Title */}
                                <Typography variant="h4" sx={{
                                    fontWeight: 800, lineHeight: 1.1, mb: 4,
                                    color: isFullscreen ? 'white' : '#0f172a'
                                }}>
                                    {currentItem.title}
                                </Typography>

                                {/* Info */}
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <Box>
                                        <Typography variant="overline" color="text.secondary" fontWeight="bold">Présentateur</Typography>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                                            <Box sx={{
                                                width: 32, height: 32, borderRadius: '50%', bgcolor: 'action.hover',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
                                            }}>
                                                {currentItem.presenter.charAt(0)}
                                            </Box>
                                            <Typography variant="h6" fontWeight="bold">{currentItem.presenter}</Typography>
                                        </Box>
                                    </Box>

                                    <Box>
                                        <Typography variant="overline" color="text.secondary" fontWeight="bold">Contexte</Typography>
                                        <Typography variant="body1" sx={{ color: isFullscreen ? 'text.secondary' : 'text.primary', lineHeight: 1.6 }}>
                                            {currentItem.description}
                                        </Typography>
                                    </Box>

                                    {/* Attachments List */}
                                    {currentItem.attachments.length > 0 && (
                                        <Box>
                                            <Typography variant="overline" color="text.secondary" fontWeight="bold">Documents</Typography>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                                                {currentItem.attachments.map(att => (
                                                    <Box
                                                        component="button"
                                                        key={att.id}
                                                        onClick={() => setActiveAttachment(att)}
                                                        sx={{
                                                            display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 2,
                                                            border: 'none', bgcolor: activeAttachment?.id === att.id ? '#ecfdf5' : 'transparent',
                                                            color: activeAttachment?.id === att.id ? '#065f46' : 'text.secondary',
                                                            cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left',
                                                            '&:hover': { bgcolor: 'action.hover' }
                                                        }}
                                                    >
                                                        <Box component="span" sx={{ opacity: 0.5 }}>
                                                            {att.type === 'image' ? <Menu fontSize="small" /> : <Create fontSize="small" />} {/* Placeholder icons */}
                                                        </Box>
                                                        <Typography variant="body2" fontWeight="medium">{att.name}</Typography>
                                                    </Box>
                                                ))}
                                            </Box>
                                        </Box>
                                    )}
                                </Box>
                            </Box>
                        </Box>

                        {/* Document Viewer */}
                        <Box sx={{ flex: 1, position: 'relative', bgcolor: isFullscreen ? 'black' : '#f1f5f9', transition: 'background-color 0.5s' }}>
                            <DocumentViewer
                                activeAttachment={activeAttachment}
                                allAttachments={currentItem.attachments}
                                onSelectAttachment={setActiveAttachment}
                                onClose={() => setActiveAttachment(null)}
                                enableLaser={isLaserEnabled}
                                enableDrawing={isDrawingEnabled}
                                // Sync Callbacks
                                onLaserMove={handleLaserMove}
                                onDrawLine={handleDrawLine}
                                onScroll={handleScrollSync}
                                currentPage={documentPage}
                                onPageChange={setDocumentPage}
                            />
                        </Box>
                    </Box>

                    {/* Navigation Controls */}
                    {/* Main Fab Navigation */}
                    <Box sx={{
                        position: 'absolute', bottom: 40, left: '17.5%',
                        display: 'flex', gap: 2, transition: 'all 0.5s',
                        transform: isCinemaMode ? 'translate(-50%, 100px)' : 'translateX(-50%)',
                        opacity: isCinemaMode ? 0 : 1
                    }}>
                        <IconButton onClick={handlePrev} disabled={currentIndex === 0} sx={{ width: 48, height: 48, bgcolor: 'white', boxShadow: 3, '&:hover': { bgcolor: '#f8fafc' } }}>
                            <ArrowBack />
                        </IconButton>
                        <IconButton onClick={handleNext} disabled={currentIndex === meeting.agenda.length - 1} sx={{ width: 48, height: 48, bgcolor: '#059669', color: 'white', boxShadow: 3, '&:hover': { bgcolor: '#047857' } }}>
                            <ArrowRight />
                        </IconButton>
                    </Box>

                    {/* Cinema Mode Mini Nav */}
                    <Box sx={{
                        position: 'absolute', bottom: 40, left: '50%',
                        transition: 'all 0.5s',
                        transform: isCinemaMode ? 'translate(-50%, 0)' : 'translate(-50%, 100px)',
                        opacity: isCinemaMode ? 1 : 0
                    }}>
                        <Box sx={{ bgcolor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', borderRadius: 10, p: 1, display: 'flex', alignItems: 'center', gap: 2, color: 'white', boxShadow: 6 }}>
                            <IconButton onClick={handlePrev} size="small" sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.1)' }}><ArrowLeft /></IconButton>
                            <Typography variant="caption" fontWeight="bold" sx={{ letterSpacing: '0.1em' }}>{currentIndex + 1} / {meeting.agenda.length}</Typography>
                            <IconButton onClick={handleNext} size="small" sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.1)' }}><ArrowRight /></IconButton>
                        </Box>
                    </Box>
                </Box>

                {/* Quick Notes Panel */}
                <Box sx={{
                    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    width: isNotesVisible ? 380 : 0, overflow: 'hidden',
                    borderLeft: '1px solid #e2e8f0'
                }}>
                    {currentItem && (
                        <QuickNotesPanel
                            itemId={currentItem.id}
                            itemTitle={currentItem.title}
                            onSave={(note) => setNotes(p => ({ ...p, [currentItem.id]: note }))}
                            initialNote={notes[currentItem.id]}
                        />
                    )}
                </Box>
            </Box>

            {/* Global Search */}
            <Backdrop open={isSearchOpen} sx={{ zIndex: 100, alignItems: 'flex-start', pt: 15, bgcolor: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(5px)' }}>
                <Box sx={{ width: 600, bgcolor: 'white', borderRadius: 4, boxShadow: 6, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <Box sx={{ p: 3, borderBottom: '1px solid #f1f5f9' }}>
                        <TextField
                            autoFocus
                            fullWidth
                            placeholder="Rechercher dans l'ordre du jour..."
                            variant="standard"
                            InputProps={{ disableUnderline: true, sx: { fontSize: '1.25rem', fontWeight: 'bold' } }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </Box>
                    <Box sx={{ maxHeight: '50vh', overflowY: 'auto' }}>
                        {filteredAgenda.map(item => (
                            <Box
                                component="button"
                                key={item.id}
                                onClick={() => { setCurrentIndex(meeting.agenda.findIndex(a => a.id === item.id)); setIsSearchOpen(false); }}
                                sx={{
                                    width: '100%', textAlign: 'left', p: 2, borderBottom: '1px solid #f8fafc',
                                    bgcolor: 'transparent', border: 'none', cursor: 'pointer',
                                    '&:hover': { bgcolor: '#f8fafc' }
                                }}
                            >
                                <Typography variant="subtitle1" fontWeight="bold" color="text.primary">{item.title}</Typography>
                                <Typography variant="body2" color="text.secondary" noWrap>{item.description}</Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>
            </Backdrop>
        </Box>
    );
};

export default PresentationControlPage;
