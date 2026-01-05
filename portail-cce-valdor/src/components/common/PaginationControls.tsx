import React from 'react';
import {
    Box,
    FormControl,
    Select,
    MenuItem,
    Typography,
    IconButton,
    Stack
} from '@mui/material';
import {
    FirstPage,
    LastPage,
    KeyboardArrowLeft,
    KeyboardArrowRight
} from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material';

interface PaginationControlsProps {
    totalItems: number;
    page: number;
    rowsPerPage: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (rowsPerPage: number) => void;
    rowsPerPageOptions?: number[];
    showFirstLastButtons?: boolean;
}

/**
 * Reusable pagination controls component
 * Includes items per page selector and navigation buttons
 */
const PaginationControls: React.FC<PaginationControlsProps> = ({
    totalItems,
    page,
    rowsPerPage,
    onPageChange,
    onRowsPerPageChange,
    rowsPerPageOptions = [10, 25, 50, 100],
    showFirstLastButtons = true
}) => {
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startItem = totalItems === 0 ? 0 : page * rowsPerPage + 1;
    const endItem = Math.min((page + 1) * rowsPerPage, totalItems);

    const handleChangeRowsPerPage = (event: SelectChangeEvent<number>) => {
        onRowsPerPageChange(Number(event.target.value));
        onPageChange(0); // Reset to first page when changing items per page
    };


    const handleFirstPage = () => onPageChange(0);
    const handlePrevPage = () => onPageChange(Math.max(0, page - 1));
    const handleNextPage = () => onPageChange(Math.min(totalPages - 1, page + 1));
    const handleLastPage = () => onPageChange(Math.max(0, totalPages - 1));

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
                py: 2,
                px: 1,
                borderTop: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper'
            }}
        >
            {/* Items per page selector */}
            <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="body2" color="text.secondary">
                    Éléments par page:
                </Typography>
                <FormControl size="small" sx={{ minWidth: 80 }}>
                    <Select
                        value={rowsPerPage}
                        onChange={handleChangeRowsPerPage}
                        size="small"
                    >
                        {rowsPerPageOptions.map(option => (
                            <MenuItem key={option} value={option}>
                                {option}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Stack>

            {/* Page info and navigation */}
            <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="body2" color="text.secondary">
                    {startItem}–{endItem} sur {totalItems}
                </Typography>

                {showFirstLastButtons && (
                    <IconButton
                        onClick={handleFirstPage}
                        disabled={page === 0}
                        size="small"
                        aria-label="Première page"
                    >
                        <FirstPage />
                    </IconButton>
                )}

                <IconButton
                    onClick={handlePrevPage}
                    disabled={page === 0}
                    size="small"
                    aria-label="Page précédente"
                >
                    <KeyboardArrowLeft />
                </IconButton>

                <Typography variant="body2" sx={{ mx: 1 }}>
                    Page {totalPages === 0 ? 0 : page + 1} / {totalPages}
                </Typography>

                <IconButton
                    onClick={handleNextPage}
                    disabled={page >= totalPages - 1}
                    size="small"
                    aria-label="Page suivante"
                >
                    <KeyboardArrowRight />
                </IconButton>

                {showFirstLastButtons && (
                    <IconButton
                        onClick={handleLastPage}
                        disabled={page >= totalPages - 1}
                        size="small"
                        aria-label="Dernière page"
                    >
                        <LastPage />
                    </IconButton>
                )}
            </Stack>
        </Box>
    );
};

/**
 * Hook to manage pagination state
 */
export const usePagination = <T,>(items: T[], initialRowsPerPage = 10) => {
    const [page, setPage] = React.useState(0);
    const [rowsPerPage, setRowsPerPage] = React.useState(initialRowsPerPage);

    // Reset to first page when items change significantly
    React.useEffect(() => {
        const maxPage = Math.max(0, Math.ceil(items.length / rowsPerPage) - 1);
        if (page > maxPage) {
            setPage(maxPage);
        }
    }, [items.length, rowsPerPage, page]);

    const paginatedItems = React.useMemo(() => {
        const start = page * rowsPerPage;
        return items.slice(start, start + rowsPerPage);
    }, [items, page, rowsPerPage]);

    return {
        page,
        setPage,
        rowsPerPage,
        setRowsPerPage,
        paginatedItems,
        totalItems: items.length
    };
};

export default PaginationControls;
