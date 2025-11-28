import React from 'react';
import { Card, CardContent, Box, Typography } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: SvgIconComponent;
    color: 'primary' | 'secondary' | 'warning' | 'error' | 'info' | 'success';
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon: Icon, color }) => {
    // Map color prop to theme palette colors for background (light) and icon (main)
    const getColors = (color: string) => {
        switch (color) {
            case 'primary': return { bg: '#d1fae5', text: '#059669' }; // Emerald 100/600
            case 'secondary': return { bg: '#dbeafe', text: '#2563eb' }; // Blue 100/600
            case 'warning': return { bg: '#fef3c7', text: '#d97706' }; // Yellow 100/600
            case 'error': return { bg: '#fee2e2', text: '#dc2626' }; // Red 100/600
            default: return { bg: '#f3f4f6', text: '#4b5563' };
        }
    };

    const { bg, text } = getColors(color);

    return (
        <Card>
            <CardContent sx={{ p: '20px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{
                        flexShrink: 0,
                        bgcolor: bg,
                        borderRadius: 1, // rounded-md
                        p: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Icon sx={{ color: text, fontSize: 24 }} />
                    </Box>
                    <Box sx={{ ml: 2.5, flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" color="textSecondary" noWrap sx={{ fontWeight: 500 }}>
                            {title}
                        </Typography>
                        <Typography variant="h5" color="textPrimary" sx={{ fontWeight: 600, mt: 0.5 }}>
                            {value}
                        </Typography>
                    </Box>
                </Box>
            </CardContent>
        </Card>
    );
};

export default StatsCard;
