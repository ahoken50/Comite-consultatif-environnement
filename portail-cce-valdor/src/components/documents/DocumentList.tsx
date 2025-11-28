import React from 'react';
import {
    List,
    ListItem,
    ListItemAvatar,
    Avatar,
    ListItemText,
    IconButton,
    Typography,
    Paper
} from '@mui/material';
import {
    Description,
    PictureAsPdf,
    Image,
    Delete,
    Download
} from '@mui/icons-material';
import type { Document } from '../../types/document.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DocumentListProps {
    documents: Document[];
    onDelete?: (id: string, storagePath: string) => void;
}

const DocumentList: React.FC<DocumentListProps> = ({ documents, onDelete }) => {
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

    if (documents.length === 0) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                Aucun document.
            </Typography>
        );
    }

    return (
        <List>
            {documents.map((doc) => (
                <Paper key={doc.id} variant="outlined" sx={{ mb: 1 }}>
                    <ListItem
                        secondaryAction={
                            <>
                                <IconButton href={doc.url} target="_blank" rel="noopener noreferrer" size="small">
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
                            <Avatar sx={{ bgcolor: 'primary.light' }}>
                                {getIcon(doc.type)}
                            </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                            primary={doc.name}
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
    );
};

export default DocumentList;
