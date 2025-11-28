import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
    palette: {
        primary: {
            main: '#059669', // Emerald 600
            light: '#34d399', // Emerald 400
            dark: '#047857', // Emerald 700
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#2563eb', // Blue 600
            light: '#60a5fa',
            dark: '#1d4ed8',
            contrastText: '#ffffff',
        },
        warning: {
            main: '#d97706', // Yellow 600
            light: '#fcd34d',
            dark: '#b45309',
        },
        background: {
            default: '#f9fafb', // Gray 50
            paper: '#ffffff',
        },
        text: {
            primary: '#111827', // Gray 900
            secondary: '#6b7280', // Gray 500
        },
    },
    typography: {
        fontFamily: [
            'Inter',
            'Roboto',
            '"Helvetica Neue"',
            'Arial',
            'sans-serif',
        ].join(','),
        h1: { fontWeight: 700 },
        h2: { fontWeight: 600 },
        h3: { fontWeight: 600 },
        h4: { fontWeight: 600 },
        h5: { fontWeight: 600 },
        h6: { fontWeight: 600 },
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    borderRadius: 8,
                    fontWeight: 500,
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    borderRadius: 12,
                    boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)', // Tailwind shadow
                    border: '1px solid #e5e7eb', // Gray 200
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: '#ffffff',
                    color: '#111827',
                    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', // shadow-sm
                    borderBottom: '1px solid #e5e7eb',
                },
            },
        },
    },
});
