import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { Check, AccessTime, AttachFile, KeyboardArrowUp, KeyboardArrowDown } from '@mui/icons-material';
import type { AgendaItem } from '../types';

interface AgendaSidebarProps {
    items: AgendaItem[];
    currentIndex: number;
    onSelect: (index: number) => void;
}

const AgendaSidebar: React.FC<AgendaSidebarProps> = ({ items, currentIndex, onSelect }) => {
    return (
        <Box sx={{ height: '100%', bgcolor: '#f8fafc', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header with Progress */}
            <Box sx={{
                p: 3,
                bgcolor: '#022c22',
                color: 'white',
                position: 'relative',
                overflow: 'hidden',
                borderBottom: '1px solid rgba(6, 78, 59, 0.5)'
            }}>
                {/* Abstract Background */}
                <Box sx={{
                    position: 'absolute', top: -30, right: -30, width: 120, height: 120,
                    bgcolor: 'rgba(16, 185, 129, 0.1)', borderRadius: '50%', filter: 'blur(40px)'
                }} />

                <Typography variant="overline" sx={{ color: '#34d399', fontWeight: 900, letterSpacing: '0.25em', display: 'block', mb: 1, fontSize: '0.65rem' }}>
                    Séquence de l'ordre du jour
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flex: 1, height: 10, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 5, p: 0.5 }}>
                        <Box sx={{
                            height: '100%',
                            width: `${((currentIndex + 1) / items.length) * 100}%`,
                            bgcolor: '#10b981',
                            borderRadius: 4,
                            transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: '0 0 10px rgba(16,185,129,0.5)'
                        }} />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 900, fontFamily: 'monospace' }}>
                        {currentIndex + 1} <span style={{ opacity: 0.3 }}>/</span> {items.length}
                    </Typography>
                </Box>
            </Box>

            {/* List */}
            <Box sx={{
                flex: 1,
                overflowY: 'auto',
                p: 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                '&::-webkit-scrollbar': { width: '6px' },
                '&::-webkit-scrollbar-thumb': { bgcolor: '#cbd5e1', borderRadius: '3px' }
            }}>
                {items.map((item, index) => {
                    const isActive = index === currentIndex;
                    const isDone = index < currentIndex;

                    return (
                        <Box
                            component="button"
                            key={item.id}
                            onClick={() => onSelect(index)}
                            sx={{
                                width: '100%',
                                textAlign: 'left',
                                p: 2.5,
                                borderRadius: 4,
                                border: '2px solid',
                                transition: 'all 0.3s',
                                position: 'relative',
                                cursor: 'pointer',
                                bgcolor: isActive ? 'white' : isDone ? 'rgba(236, 253, 245, 0.3)' : 'white',
                                borderColor: isActive ? '#10b981' : 'transparent',
                                boxShadow: isActive ? '0 15px 30px -10px rgba(16,185,129,0.15)' : 'none',
                                transform: isActive ? 'scale(1.02)' : 'none',
                                opacity: isDone ? 0.8 : 1,
                                outline: 'none',
                                '&:hover': !isActive && !isDone ? {
                                    boxShadow: 2,
                                    borderColor: '#e2e8f0'
                                } : {}
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                                <Box sx={{
                                    mt: 0.5, flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.75rem', fontWeight: 900, transition: 'colors 0.3s',
                                    bgcolor: isActive ? '#059669' : isDone ? '#d1fae5' : '#f1f5f9',
                                    color: isActive ? 'white' : isDone ? '#059669' : '#94a3b8',
                                    boxShadow: isActive ? '0 4px 12px rgba(16,185,129,0.3)' : 'none'
                                }}>
                                    {isDone ? <Check fontSize="small" /> : index + 1}
                                </Box>

                                <Box sx={{ flex: 1, overflow: 'hidden' }}>
                                    <Typography variant="body2" sx={{
                                        fontWeight: 800, lineHeight: 1.4, mb: 1,
                                        color: isActive ? '#064e3b' : isDone ? '#065f46' : '#334155'
                                    }}>
                                        {item.title}
                                    </Typography>

                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 10, bgcolor: isActive ? '#ecfdf5' : 'transparent', color: isActive ? '#059669' : '#94a3b8' }}>
                                            <AccessTime sx={{ fontSize: 12 }} />
                                            <Typography variant="caption" fontWeight="bold">{item.durationInMinutes} min</Typography>
                                        </Box>
                                        {item.attachments.length > 0 && (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 10, bgcolor: isActive ? '#ecfdf5' : 'transparent', color: isActive ? '#059669' : '#94a3b8' }}>
                                                <AttachFile sx={{ fontSize: 12 }} />
                                                <Typography variant="caption" fontWeight="bold">{item.attachments.length}</Typography>
                                            </Box>
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    );
                })}
            </Box>

            {/* Footer Status */}
            <Box sx={{ p: 3, borderTop: '1px solid #e2e8f0', bgcolor: 'rgba(255,255,255,0.5)' }}>
                <Box sx={{ bgcolor: '#0f172a', borderRadius: 3, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 900, textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: '0.1em' }}>
                            Statut
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#34d399', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#10b981', animation: 'pulse 2s infinite' }} />
                            Synchronisé
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton size="small" sx={{ color: '#475569', border: '1px solid #334155', borderRadius: 2, p: 0.5 }}><KeyboardArrowUp fontSize="small" /></IconButton>
                        <IconButton size="small" sx={{ color: '#475569', border: '1px solid #334155', borderRadius: 2, p: 0.5 }}><KeyboardArrowDown fontSize="small" /></IconButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};

export default AgendaSidebar;
