import React, { useCallback } from 'react';
import {
    List,
    Typography,
} from '@mui/material';
import type { Document } from '../../types/document.types';
import type { AgendaItem } from '../../types/meeting.types';

import DocumentPreviewModal from './DocumentPreviewModal';
import { useState } from 'react';
import DocumentListItem from './DocumentListItem';

interface DocumentListProps {
    documents: Document[];
    onDelete?: (id: string, storagePath: string) => void;
    agendaItems?: AgendaItem[];
}

const DocumentList: React.FC<DocumentListProps> = ({ documents, onDelete, agendaItems }) => {
    const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

    const handlePreview = useCallback((doc: Document) => {
        setPreviewDoc(doc);
    }, []);

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
                    <DocumentListItem
                        key={doc.id}
                        doc={doc}
                        onPreview={handlePreview}
                        onDelete={onDelete}
                        agendaItems={agendaItems}
                    />
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
