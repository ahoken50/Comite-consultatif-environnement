import React from 'react';
import {
    ListItem,
    ListItemAvatar,
    Avatar,
    ListItemText,
    IconButton,
    Typography,
    Paper,
    Chip,
    Box
} from '@mui/material';
import {
    Description,
    PictureAsPdf,
    Image,
    Delete,
    Download,
    AttachFile,
    Visibility
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Document } from '../../types/document.types';
import type { AgendaItem } from '../../types/meeting.types';

interface DocumentListItemProps {
    doc: Document;
    onPreview: (doc: Document) => void;
    onDelete?: (id: string, storagePath: string) => void;
    agendaItems?: AgendaItem[];
}

const DocumentListItem: React.FC<DocumentListItemProps> = React.memo(({ doc, onPreview, onDelete, agendaItems }) => {
    const navigate = useNavigate();

    const getIcon = (type: string) => {
        if (type.includes('pdf')) return <PictureAsPdf />;
        if (type.includes('image')) return <Image />;
        return <Description />;
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 o';
        const k = 1024;
        const sizes = ['o', 'Ko', 'Mo', 'Go'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getAgendaItemLabel = (agendaItemId: string) => {
        if (!agendaItems) return null;
        const index = agendaItems.findIndex(i => i.id === agendaItemId);
        if (index === -1) return null;
        const item = agendaItems[index];
        return `Point ${index + 1}: ${item.title}`;
    };

    return (
        <Paper variant="outlined" sx={{ mb: 1 }}>
            <ListItem
                secondaryAction={
                    <>
                        <IconButton onClick={() => onPreview(doc)} size="small" title="Prévisualiser">
                            <Visibility />
                        </IconButton>
                        <IconButton href={doc.url} target="_blank" rel="noopener noreferrer" size="small" title="Télécharger">
                            <Download />
                        </IconButton>
                        {onDelete && (
                            <IconButton
                                edge="end"
                                aria-label="delete"
                                onClick={() => onDelete(doc.id, doc.storagePath)}
                                size="small"
                                color="error"
                            >
                                <Delete />
                            </IconButton>
                        )}
                    </>
                }
            >
                <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'primary.light', cursor: 'pointer' }} onClick={() => onPreview(doc)}>
                        {getIcon(doc.type)}
                    </Avatar>
                </ListItemAvatar>
                <ListItemText
                    primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => onPreview(doc)}>
                            <Typography variant="body1" sx={{ textDecoration: 'underline', color: 'primary.main' }}>
                                {doc.name}
                            </Typography>
                            {doc.agendaItemId && (
                                <Chip
                                    label={getAgendaItemLabel(doc.agendaItemId)}
                                    size="small"
                                    variant="outlined"
                                    color="primary"
                                    icon={<AttachFile sx={{ fontSize: 14 }} />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (doc.linkedEntityType === 'meeting' && doc.linkedEntityId) {
                                            navigate(`/meetings/${doc.linkedEntityId}`, {
                                                state: { tab: 0, agendaItemId: doc.agendaItemId }
                                            });
                                        }
                                    }}
                                    sx={{ cursor: 'pointer' }}
                                />
                            )}
                        </Box>
                    }
                    secondary={
                        <React.Fragment>
                            <Typography component="span" variant="body2" color="text.primary">
                                {formatSize(doc.size)}
                            </Typography>
                            {" — " + format(new Date(doc.dateUploaded), 'd MMM yyyy', { locale: fr })}
                        </React.Fragment>
                    }
                />
            </ListItem>
        </Paper>
    );
});

export default DocumentListItem;
