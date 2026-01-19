import React from 'react';
import {
    Box,
    Typography,
    Paper,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Chip,
    Divider,
    Tooltip
} from '@mui/material';
import { History, Download, Visibility } from '@mui/icons-material';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Document, DocumentVersion } from '../../types/document.types';

interface DocumentVersionHistoryProps {
    document: Document;
    onViewVersion?: (version: DocumentVersion) => void;
}

/**
 * Document Version History Component (#4.1)
 * Displays version history for a document with links to previous versions
 */
const DocumentVersionHistory: React.FC<DocumentVersionHistoryProps> = ({ document, onViewVersion }) => {
    const versions = document.versionHistory || [];

    // Add current version to the list
    const allVersions: DocumentVersion[] = [
        {
            versionNumber: document.version || 1,
            documentId: document.id,
            url: document.url,
            uploadedBy: document.uploadedBy,
            uploadedAt: document.dateUploaded,
            changeNote: 'Version actuelle'
        },
        ...versions
    ].sort((a, b) => b.versionNumber - a.versionNumber);

    if (allVersions.length <= 1) {
        return (
            <Paper sx={{ p: 2, mt: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <History color="action" fontSize="small" />
                    <Typography variant="subtitle2">Historique des versions</Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                    Aucune version précédente disponible
                </Typography>
            </Paper>
        );
    }

    return (
        <Paper sx={{ p: 2, mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <History color="primary" fontSize="small" />
                <Typography variant="subtitle2">Historique des versions</Typography>
                <Chip label={`${allVersions.length} versions`} size="small" />
            </Box>

            <List dense>
                {allVersions.map((version, index) => (
                    <React.Fragment key={`${version.documentId}-v${version.versionNumber}`}>
                        {index > 0 && <Divider />}
                        <ListItem sx={{ py: 1 }}>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip
                                            label={`v${version.versionNumber}`}
                                            size="small"
                                            color={index === 0 ? 'primary' : 'default'}
                                            sx={{ fontWeight: 600 }}
                                        />
                                        {index === 0 && (
                                            <Chip
                                                label="Actuelle"
                                                size="small"
                                                color="success"
                                            />
                                        )}
                                    </Box>
                                }
                                secondary={
                                    <Box sx={{ mt: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary">
                                            {format(new Date(version.uploadedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                                        </Typography>
                                        {version.changeNote && (
                                            <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                                                {version.changeNote}
                                            </Typography>
                                        )}
                                    </Box>
                                }
                            />
                            <ListItemSecondaryAction>
                                <Tooltip title="Voir cette version">
                                    <IconButton
                                        size="small"
                                        onClick={() => onViewVersion?.(version)}
                                    >
                                        <Visibility fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="Télécharger">
                                    <IconButton
                                        size="small"
                                        href={version.url}
                                        target="_blank"
                                    >
                                        <Download fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </ListItemSecondaryAction>
                        </ListItem>
                    </React.Fragment>
                ))}
            </List>
        </Paper>
    );
};

export default DocumentVersionHistory;
