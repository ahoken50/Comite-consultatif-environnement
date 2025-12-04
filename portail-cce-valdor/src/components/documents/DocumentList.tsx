import React from 'react';
import {
    List,
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
    AttachFile
} from '@mui/icons-material';
import type { Document } from '../../types/document.types';
import type { AgendaItem } from '../../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DocumentListProps {
    documents: Document[];
    onDelete?: (id: string, storagePath: string) => void;
    agendaItems?: AgendaItem[];
}

import DocumentPreviewModal from './DocumentPreviewModal';
import { useState } from 'react';
import { Visibility } from '@mui/icons-material';

const DocumentList: React.FC<DocumentListProps> = ({ documents, onDelete, agendaItems }) => {
    const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

    const getIcon = (type: string) => {
        if (type.includes('pdf')) return <PictureAsPdf />;
        if (type.includes('image')) return <Image />;
        return <Description />;
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
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

    if (documents.length === 0) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                Aucun document.
            </Typography>
        );
    }

    return (
        <>
            <List>
                {documents.map((doc) => (
                    <Paper key={doc.id} variant="outlined" sx={{ mb: 1 }}>
                        <ListItem
                            secondaryAction={
                                <>
                                    <IconButton onClick={() => setPreviewDoc(doc)} size="small" title="Prévisualiser">
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
                                <Avatar sx={{ bgcolor: 'primary.light', cursor: 'pointer' }} onClick={() => setPreviewDoc(doc)}>
                                    {getIcon(doc.type)}
                                </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => setPreviewDoc(doc)}>
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
                ))}
            </List>
            <DocumentPreviewModal
                open={!!previewDoc}
                onClose={() => setPreviewDoc(null)}
                document={previewDoc}
            />
        </>
    );
};

export default DocumentList;
