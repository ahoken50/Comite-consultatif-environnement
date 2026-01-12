import React from 'react';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography, Box } from '@mui/material';
import { NavigateNext } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';

export interface BreadcrumbItem {
    label: string;
    to?: string;
    icon?: React.ReactNode;
}

interface BreadcrumbsProps {
    items: BreadcrumbItem[];
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
    return (
        <Box sx={{ mb: 3 }}>
            <MuiBreadcrumbs
                separator={<NavigateNext fontSize="small" />}
                aria-label="breadcrumb"
            >
                {items.map((item, index) => {
                    const isLast = index === items.length - 1;

                    return isLast ? (
                        <Typography
                            key={index}
                            color="text.primary"
                            sx={{ display: 'flex', alignItems: 'center', fontWeight: 'medium' }}
                        >
                            {item.icon && <Box component="span" sx={{ mr: 0.5, display: 'flex' }}>{item.icon}</Box>}
                            {item.label}
                        </Typography>
                    ) : (
                        <Link
                            key={index}
                            component={RouterLink}
                            to={item.to || '#'}
                            underline="hover"
                            color="inherit"
                            sx={{ display: 'flex', alignItems: 'center' }}
                        >
                            {item.icon && <Box component="span" sx={{ mr: 0.5, display: 'flex' }}>{item.icon}</Box>}
                            {item.label}
                        </Link>
                    );
                })}
            </MuiBreadcrumbs>
        </Box>
    );
};

export default Breadcrumbs;
