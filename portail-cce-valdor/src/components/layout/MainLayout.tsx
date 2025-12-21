import React, { useState } from 'react';
import { Box, CssBaseline, Toolbar } from '@mui/material';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

const MainLayout: React.FC = () => {
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    return (
        <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            <CssBaseline />
            <Header onMenuClick={handleDrawerToggle} />
            <Sidebar mobileOpen={mobileOpen} onClose={handleDrawerToggle} />
            <Box component="main" sx={{ flexGrow: 1, p: 3, width: { sm: `calc(100% - 240px)` }, overflow: 'auto' }}>
                <Toolbar /> {/* Spacer for fixed header */}
                <Outlet />
            </Box>
        </Box>
    );
};

export default MainLayout;
