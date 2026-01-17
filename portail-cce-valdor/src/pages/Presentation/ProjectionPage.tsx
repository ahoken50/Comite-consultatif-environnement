import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { usePresentationData } from './hooks/usePresentationData';
import type { Attachment } from './types';
import DocumentViewer from './components/DocumentViewer';
import logoCce from '../../assets/logo-cce.png';
import bgLandscape from '../../assets/boreal-landscape.png';

const getBroadcastChannel = (id: string) => new BroadcastChannel(`cce_presentation_${id}`);

const ProjectionPage: React.FC = () => {
    const { id: meetingId } = useParams<{ id: string }>();
    const { meeting } = usePresentationData(meetingId);

    const [state, setState] = useState({
        currentIndex: 0,
        activeAttachment: null as Attachment | null,
        isLaserEnabled: false,
        isDrawingEnabled: false
    });

    // Real-time Sync State
    const [syncLaserPos, setSyncLaserPos] = useState({ x: 0, y: 0 });
    const [syncDrawPoints, setSyncDrawPoints] = useState<{ x: number, y: number }[]>([]);
    const [syncScroll, setSyncScroll] = useState({ top: 0, left: 0 });
    // We trigger a re-render or ref update for scroll

    useEffect(() => {
        if (!meetingId) return;
        const channel = getBroadcastChannel(meetingId);

        channel.onmessage = (event: MessageEvent) => {
            if (event.data) {
                switch (event.data.type) {
                    case 'SYNC_STATE':
                        setState(event.data.payload);
                        // Reset drawing on attachment change/fresh sync if needed
                        setSyncDrawPoints([]);
                        break;
                    case 'SYNC_LASER':
                        setSyncLaserPos(event.data.payload);
                        break;
                    case 'SYNC_DRAW':
                        setSyncDrawPoints(prev => [...prev, event.data.payload]);
                        break;
                    case 'SYNC_SCROLL':
                        setSyncScroll({ top: event.data.payload.scrollTop, left: event.data.payload.scrollLeft });
                        break;
                }
            }
        };

        return () => channel.close();
    }, [meetingId]);

    const currentItem = meeting?.agenda[state.currentIndex];

    if (!meeting || !currentItem) return <Box sx={{ height: '100vh', bgcolor: 'black' }} />;

    return (
        <Box sx={{ width: '100vw', height: '100vh', bgcolor: 'black', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

            {state.activeAttachment ? (
                <>
                    {/* Minimalist Top Bar for Context */}
                    <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, p: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pointerEvents: 'none', zIndex: 50 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, opacity: 0, animation: 'fadeInDown 0.5s forwards' }}>
                            <Box sx={{
                                width: 64, height: 64, bgcolor: 'rgba(255,255,255,0.9)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: 4, boxShadow: 6, overflow: 'hidden', p: 1
                            }}>
                                <img src={logoCce} alt="CCE" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            </Box>
                            <Box sx={{
                                bgcolor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(20px)', color: 'white',
                                px: 4, py: 2, borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)', boxShadow: 6, maxWidth: '60vw'
                            }}>
                                <Typography variant="h5" fontWeight="900" sx={{ lineHeight: 1.2 }}>{currentItem.title}</Typography>
                            </Box>
                        </Box>
                    </Box>

                    {/* Document Content */}
                    <Box sx={{ flex: 1, position: 'relative' }}>
                        <DocumentViewer
                            activeAttachment={state.activeAttachment}
                            allAttachments={currentItem.attachments}
                            onSelectAttachment={() => { }}
                            enableLaser={state.isLaserEnabled}
                            enableDrawing={state.isDrawingEnabled}
                            isProjection={true} // Hides all UI controls
                            // Slave Props
                            externalLaserPos={syncLaserPos}
                            externalDrawPoints={syncDrawPoints}
                            externalScroll={syncScroll}
                        />
                    </Box>
                </>
            ) : (
                /* Standby Screen */
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    {/* Background Effects */}
                    <Box sx={{ position: 'absolute', inset: 0 }}>
                        <img src={bgLandscape} alt="Background" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7))' }} />
                    </Box>

                    <Box sx={{ position: 'relative', zIndex: 10, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Box sx={{
                            width: 180, height: 180, borderRadius: '50%', border: '4px solid rgba(255, 255, 255, 0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 4,
                            bgcolor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(20px)', boxShadow: '0 0 60px rgba(0,0,0,0.5)',
                            overflow: 'hidden', p: 3
                        }}>
                            <img src={logoCce} alt="CCE" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </Box>
                        <Typography variant="overline" sx={{ color: '#fff', fontWeight: 900, letterSpacing: '0.5em', mb: 2, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Assemblée Régulière</Typography>
                        <Typography variant="h1" sx={{ color: 'white', fontWeight: 900, mb: 4, maxWidth: 'md', lineHeight: 1.1, textShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>
                            {meeting.title}
                        </Typography>
                        <Typography variant="h4" sx={{ color: 'rgba(255,255,255,0.9)', fontWeight: 300, mb: 6, fontStyle: 'italic', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                            Bienvenue à tous
                        </Typography>

                        <Box sx={{ px: 4, py: 2, bgcolor: 'rgba(0,0,0,0.6)', borderRadius: 4, backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <Typography variant="body1" sx={{ color: '#e2e8f0', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                Point en cours : <span style={{ color: '#fff', fontWeight: 800 }}>{currentItem.title}</span>
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Watermark */}
            <Box sx={{ position: 'absolute', bottom: 40, right: 40, opacity: 0.4, pointerEvents: 'none', zIndex: 50 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                        <Box sx={{ height: 1, width: 48, bgcolor: 'rgba(255,255,255,0.5)' }} />
                        <Typography variant="caption" sx={{ color: 'white', fontWeight: 900, letterSpacing: '0.3em' }}>CCE Val-d'Or</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: '#10b981', fontWeight: 'bold', letterSpacing: '0.2em' }}>EN DIRECT</Typography>
                </Box>
            </Box>
        </Box>
    );
};

export default ProjectionPage;
