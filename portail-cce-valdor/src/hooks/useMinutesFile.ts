import { useState, useEffect } from 'react';
import { documentsAPI } from '../features/documents/documentsAPI';
import type { Meeting } from '../types/meeting.types';

interface UseMinutesFileProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
}

export const useMinutesFile = ({ meeting, onUpdate }: UseMinutesFileProps) => {
    const [localFile, setLocalFile] = useState<{
        url: string | null | undefined;
        name: string | null | undefined;
        path: string | null | undefined;
    }>({
        url: meeting.minutesFileUrl ?? null,
        name: meeting.minutesFileName ?? null,
        path: meeting.minutesFileStoragePath ?? null
    });

    // Sync local file state if meeting prop updates externally
    useEffect(() => {
        const meetingUrl = meeting.minutesFileUrl ?? null;
        const localUrl = localFile.url ?? null;

        if (meetingUrl !== localUrl) {
            setLocalFile({
                url: meeting.minutesFileUrl ?? null,
                name: meeting.minutesFileName ?? null,
                path: meeting.minutesFileStoragePath ?? null
            });
        }
    }, [meeting.minutesFileUrl, meeting.minutesFileName, meeting.minutesFileStoragePath, localFile.url]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        try {
            const file = e.target.files[0];

            // Upload file to storage
            const doc = await documentsAPI.upload(
                file,
                meeting.id,
                'meeting',
                'user' // Placeholder
            );

            // Optimistic local update
            setLocalFile({
                url: doc.url,
                name: file.name,
                path: doc.storagePath
            });

            // File upload is saved immediately (auto-save)
            onUpdate({
                minutesFileUrl: doc.url,
                minutesFileName: file.name,
                minutesFileStoragePath: doc.storagePath,
                minutesFileDocumentId: doc.id
            });

            return file; // Return file for further processing (e.g. DOCX parsing)

        } catch (error) {
            console.error("Upload failed", error);
            throw error;
        }
    };

    const handleDeleteFile = async () => {
        console.log('[DEBUG] handleDeleteFile called');

        // Optimistic update
        setLocalFile({
            url: null,
            name: null,
            path: null
        });

        // Try to delete physical file if IDs are available
        if (meeting.minutesFileDocumentId && meeting.minutesFileStoragePath) {
            try {
                await documentsAPI.delete(
                    meeting.minutesFileDocumentId,
                    meeting.minutesFileStoragePath
                );
            } catch (e) {
                console.warn('[DEBUG] Failed to delete physical file:', e);
            }
        }

        // ALWAYS unlink from meeting
        onUpdate({
            minutesFileUrl: null as any,
            minutesFileName: null as any,
            minutesFileStoragePath: null as any,
            minutesFileDocumentId: null as any
        });
    };

    return {
        localFile,
        handleFileUpload,
        handleDeleteFile
    };
};
