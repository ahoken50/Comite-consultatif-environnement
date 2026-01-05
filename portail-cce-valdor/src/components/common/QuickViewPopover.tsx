import React, { useState, useRef, useCallback } from 'react';
import { Popover, Paper, Box, Typography, Chip, Divider, Fade } from '@mui/material';

interface QuickViewPopoverProps {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
    description?: string;
    details?: { icon: React.ReactNode; label: string; value: string }[];
    chips?: { label: string; color?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' }[];
    disabled?: boolean;
}

/**
 * QuickViewPopover - Shows a preview popup on hover
 * Wraps children and displays additional info in a popover after a delay
 */
const QuickViewPopover: React.FC<QuickViewPopoverProps> = ({
    children,
    title,
    subtitle,
    description,
    details = [],
    chips = [],
    disabled = false
}) => {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [open, setOpen] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const HOVER_DELAY = 400; // ms before showing popover

    const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (disabled) return;

        const target = event.currentTarget;
        timeoutRef.current = setTimeout(() => {
            setAnchorEl(target);
            setOpen(true);
        }, HOVER_DELAY);
    }, [disabled]);

    const handleMouseLeave = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setOpen(false);
    }, []);

    const handlePopoverMouseEnter = useCallback(() => {
        // Keep popover open when hovering over it
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
    }, []);

    const handlePopoverMouseLeave = useCallback(() => {
        setOpen(false);
    }, []);

    return (
        <>
            <Box
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                sx={{ display: 'contents' }}
            >
                {children}
            </Box>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={() => setOpen(false)}
                anchorOrigin={{
                    vertical: 'center',
                    horizontal: 'right'
                }}
                transformOrigin={{
                    vertical: 'center',
                    horizontal: 'left'
                }}
                TransitionComponent={Fade}
                transitionDuration={200}
                disableRestoreFocus
                sx={{
                    pointerEvents: 'none',
                    '& .MuiPaper-root': {
                        pointerEvents: 'auto'
                    }
                }}
            >
                <Paper
                    elevation={8}
                    onMouseEnter={handlePopoverMouseEnter}
                    onMouseLeave={handlePopoverMouseLeave}
                    sx={{
                        p: 2,
                        maxWidth: 320,
                        minWidth: 250,
                        borderRadius: 2
                    }}
                >
                    {/* Title */}
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        {title}
                    </Typography>

                    {/* Subtitle */}
                    {subtitle && (
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            {subtitle}
                        </Typography>
                    )}

                    {/* Chips */}
                    {chips.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
                            {chips.map((chip, index) => (
                                <Chip
                                    key={index}
                                    label={chip.label}
                                    size="small"
                                    color={chip.color || 'default'}
                                    variant="outlined"
                                />
                            ))}
                        </Box>
                    )}

                    {/* Description */}
                    {description && (
                        <>
                            <Divider sx={{ my: 1.5 }} />
                            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                                {description.length > 150 ? `${description.substring(0, 150)}...` : description}
                            </Typography>
                        </>
                    )}

                    {/* Details List */}
                    {details.length > 0 && (
                        <>
                            <Divider sx={{ my: 1.5 }} />
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                                {details.map((detail, index) => (
                                    <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
                                            {detail.icon}
                                        </Box>
                                        <Typography variant="caption" color="text.secondary">
                                            {detail.label}:
                                        </Typography>
                                        <Typography variant="caption" fontWeight={500}>
                                            {detail.value}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}
                </Paper>
            </Popover>
        </>
    );
};

export default QuickViewPopover;
