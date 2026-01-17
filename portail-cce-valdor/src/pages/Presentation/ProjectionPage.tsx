import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { usePresentationData } from './hooks/usePresentationData';
import type { Attachment } from './types';
import DocumentViewer from './components/DocumentViewer';
import logoCce from '../../assets/logo-cce.png';

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

    useEffect(() => {
        if (!meetingId) return;
        const channel = getBroadcastChannel(meetingId);

        channel.onmessage = (event: MessageEvent) => {
            if (event.data && event.data.type === 'SYNC_STATE') {
                setState(event.data.payload);
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
                        />
                    </Box>
                </>
            ) : (
                /* Standby Screen */
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    {/* Background Effects */}
                    <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom right, #022c22, #000000)' }} />
                    <Box sx={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        width: 800, height: 800, bgcolor: 'rgba(16, 185, 129, 0.05)', borderRadius: '50%',
                        filter: 'blur(100px)', animation: 'pulse 4s infinite'
                    }} />

                    <Box sx={{ position: 'relative', zIndex: 10, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Box sx={{
                            width: 160, height: 160, borderRadius: '50%', border: '4px solid rgba(16, 185, 129, 0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 4,
                            bgcolor: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(10px)', boxShadow: '0 0 50px rgba(16,185,129,0.2)',
                            overflow: 'hidden', p: 3
                        }}>
                            <img src={logoCce} alt="CCE" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </Box>
                        <Typography variant="overline" sx={{ color: '#10b981', fontWeight: 900, letterSpacing: '0.4em', mb: 2 }}>Séance Publique</Typography>
                        <Typography variant="h1" sx={{ color: 'white', fontWeight: 900, mb: 4, maxWidth: 'md', lineHeight: 1.1 }}>
                            {meeting.title}
                        </Typography>
                        <Box sx={{ height: 4, width: 96, bgcolor: '#059669', borderRadius: 2 }} />
                        <Typography variant="body1" sx={{ mt: 4, color: '#94a3b8', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                            Point en cours : {currentItem.title}
                        </Typography>
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
