import React, { useState, useEffect } from 'react';
import { Box, Typography, IconButton, IconButtonProps } from '@mui/material';
import { PlayArrow, Pause, Refresh, HourglassEmpty, Warning } from '@mui/icons-material';
import { keyframes } from '@emotion/react';

interface TopicTimerProps {
    initialMinutes: number;
    onTimeEnd?: () => void;
}

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
`;

const spinSlow = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const TopicTimer: React.FC<TopicTimerProps> = ({ initialMinutes, onTimeEnd }) => {
    const [secondsRemaining, setSecondsRemaining] = useState(initialMinutes * 60);
    const [isActive, setIsActive] = useState(false);
    const totalSeconds = initialMinutes * 60;

    useEffect(() => {
        setSecondsRemaining(initialMinutes * 60);
        setIsActive(false);
    }, [initialMinutes]);

    useEffect(() => {
        let interval: any = null;
        if (isActive && secondsRemaining > 0) {
            interval = setInterval(() => {
                setSecondsRemaining((prev) => prev - 1);
            }, 1000);
        } else if (secondsRemaining === 0) {
            setIsActive(false);
            onTimeEnd?.();
        }
        return () => clearInterval(interval);
    }, [isActive, secondsRemaining, onTimeEnd]);

    const toggle = () => setIsActive(!isActive);
    const reset = () => {
        setSecondsRemaining(initialMinutes * 60);
        setIsActive(false);
    };

    const formatTime = (totalSecs: number) => {
        const mins = Math.floor(Math.abs(totalSecs) / 60);
        const secs = Math.abs(totalSecs) % 60;
        const sign = totalSecs < 0 ? '-' : '';
        return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const percentageLeft = totalSeconds > 0 ? (secondsRemaining / totalSeconds) * 100 : 0;

    let bgColor = '#ecfdf5'; // emerald-50
    let textColor = '#047857'; // emerald-700
    let borderColor = '#a7f3d0'; // emerald-200
    let iconColor = '#059669'; // emerald-600
    let statusText = 'TEMPS RESTANT';
    let isUrgent = false;

    if (secondsRemaining <= 0) {
        bgColor = '#ffe4e6'; // rose-100
        textColor = '#be123c'; // rose-700
        borderColor = '#fda4af'; // rose-300
        iconColor = '#e11d48'; // rose-600
        statusText = 'DÉPASSEMENT';
        isUrgent = true;
    } else if (percentageLeft <= 20) {
        bgColor = '#fffbeb'; // amber-50
        textColor = '#b45309'; // amber-700
        borderColor = '#fcd34d'; // amber-300
        iconColor = '#d97706'; // amber-600
        statusText = 'BIENTÔT ÉCOULÉ';
    }

    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 3,
            py: 1.5,
            borderRadius: 4,
            border: '2px solid',
            borderColor: borderColor,
            bgcolor: bgColor,
            color: textColor,
            transition: 'all 0.5s',
            position: 'relative',
            overflow: 'hidden',
            animation: isUrgent ? `${pulse} 2s infinite` : 'none',
            boxShadow: isUrgent ? '0 0 15px rgba(244,63,94,0.3)' : 'none'
        }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', zIndex: 1 }}>
                <Typography variant="caption" sx={{
                    fontSize: '9px', fontWeight: 900, letterSpacing: '0.1em', opacity: 0.7, mb: 0.5, textTransform: 'uppercase',
                    display: 'flex', alignItems: 'center'
                }}>
                    {isActive && secondsRemaining > 0 && <HourglassEmpty sx={{ fontSize: 10, mr: 0.5, animation: `${spinSlow} 3s linear infinite` }} />}
                    {statusText}
                </Typography>
                <Typography variant="h4" sx={{
                    fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em', fontFamily: 'monospace'
                }}>
                    {formatTime(secondsRemaining)}
                </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ml: 2, pl: 2, borderLeft: '1px solid rgba(0,0,0,0.1)', zIndex: 1 }}>
                <IconButton
                    onClick={toggle}
                    size="small"
                    sx={{
                        color: iconColor,
                        bgcolor: 'rgba(0,0,0,0.05)',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.1)' },
                        p: 0.5
                    }}
                    title={isActive ? "Pause" : "Démarrer"}
                >
                    {isActive ? <Pause fontSize="small" /> : <PlayArrow fontSize="small" />}
                </IconButton>
                <IconButton
                    onClick={reset}
                    size="small"
                    sx={{
                        opacity: 0.6,
                        '&:hover': { opacity: 1, bgcolor: 'rgba(0,0,0,0.05)' },
                        p: 0.5
                    }}
                    title="Réinitialiser"
                >
                    <Refresh fontSize="small" />
                </IconButton>
            </Box>

            {/* Progress Bar Background */}
            <Box sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                height: 4,
                bgcolor: 'currentColor',
                opacity: 0.2,
                transition: 'width 1s linear',
                width: `${Math.max(0, percentageLeft)}%`
            }} />
        </Box>
    );
};

export default TopicTimer;
