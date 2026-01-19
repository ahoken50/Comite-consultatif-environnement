import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Card,
    CardContent,
    Typography,
    IconButton,
    Box,
    Chip
} from '@mui/material';
import {
    DragIndicator,
    Delete,
    Settings,
    BarChart,
    Notes,
    ListAlt,
    Gavel,
    Group,
    Title
} from '@mui/icons-material';
import type { ReportSection } from '../../types/report.types';
import { SECTION_TYPES } from '../../types/report.types';

interface ReportSectionCardProps {
    section: ReportSection;
    index: number;
    onRemove?: () => void;
    onEdit?: () => void;
    isOverlay?: boolean;
}

const ReportSectionCard: React.FC<ReportSectionCardProps> = ({
    section,
    index,
    onRemove,
    onEdit,
    isOverlay = false
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: section.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        // Ensure card is visible during drag overlay
        ...(isOverlay && { cursor: 'grabbing', opacity: 1, transform: undefined })
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'stats': return <BarChart />;
            case 'projects': return <ListAlt />;
            case 'recommendations': return <Gavel />;
            case 'members': return <Group />;
            case 'cover': return <Title />;
            default: return <Notes />;
        }
    };

    const sectionLabel = SECTION_TYPES.find(t => t.type === section.type)?.label || section.type;

    return (
        <Card
            ref={setNodeRef}
            style={style}
            sx={{
                mb: 2,
                position: 'relative',
                boxShadow: isOverlay ? 5 : 1,
                border: isOverlay ? '2px solid #1976d2' : '1px solid #e0e0e0',
                '&:hover .actions': { opacity: 1 }
            }}
        >
            <CardContent sx={{ display: 'flex', alignItems: 'center', p: 2, '&:last-child': { pb: 2 } }}>
                <Box
                    {...attributes}
                    {...listeners}
                    sx={{
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        mr: 2,
                        color: 'text.disabled',
                        '&:hover': { color: 'text.primary' }
                    }}
                >
                    <DragIndicator />
                    <Typography variant="caption" sx={{ ml: 1, width: 20 }}>{index + 1}</Typography>
                </Box>

                <Box sx={{ mr: 2, color: 'primary.main' }}>
                    {getIcon(section.type)}
                </Box>

                <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        {section.title}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Chip label={sectionLabel} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                        {section.subtitle && (
                            <Typography variant="caption" color="textSecondary">
                                {section.subtitle}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {!isOverlay && (
                    <Box className="actions" sx={{ opacity: 0.3, transition: 'opacity 0.2s' }}>
                        <IconButton size="small" onClick={onEdit} title="Configuration">
                            <Settings fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={onRemove} color="error" title="Supprimer">
                            <Delete fontSize="small" />
                        </IconButton>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default ReportSectionCard;
