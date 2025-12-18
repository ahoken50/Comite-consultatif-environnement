import { storage, db } from './firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import type { AudioRecording } from '../types/meeting.types';

// Supported audio/video formats
const SUPPORTED_FORMATS = [
    'audio/mpeg',      // .mp3
    'audio/mp4',       // .m4a
    'audio/wav',       // .wav
    'audio/webm',      // .webm audio
    'video/mp4',       // .mp4
    'video/webm',      // .webm video
    'audio/ogg',       // .ogg
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_DURATION = 2.5 * 60 * 60; // 2h30 in seconds

export interface UploadProgress {
    bytesTransferred: number;
    totalBytes: number;
    progress: number; // 0-100
    state: 'running' | 'paused' | 'error' | 'success';
}

export interface UploadResult {
    success: boolean;
    audioRecording?: AudioRecording;
    error?: string;
}

/**
 * Validate audio file before upload
 */
export const validateAudioFile = (file: File): { valid: boolean; error?: string } => {
    if (!SUPPORTED_FORMATS.includes(file.type)) {
        return {
            valid: false,
            error: `Format non supporté: ${file.type}. Formats acceptés: MP3, M4A, WAV, MP4, WEBM`
        };
    }

    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        return {
            valid: false,
            error: `Fichier trop volumineux: ${sizeMB} MB. Maximum: 500 MB`
        };
    }

    return { valid: true };
};

/**
 * Get audio duration from file
 */
export const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';

        audio.onloadedmetadata = () => {
            window.URL.revokeObjectURL(audio.src);
            const duration = audio.duration;

            if (duration > MAX_DURATION) {
                reject(new Error(`Durée trop longue: ${Math.round(duration / 60)} minutes. Maximum: 150 minutes`));
            } else {
                resolve(duration);
            }
        };

        audio.onerror = () => {
            reject(new Error('Impossible de lire le fichier audio'));
        };

        audio.src = URL.createObjectURL(file);
    });
};

/**
 * Upload audio file to Firebase Storage
 */
export const uploadAudioFile = (
    meetingId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
    return new Promise(async (resolve) => {
        try {
            // Validate file
            const validation = validateAudioFile(file);
            if (!validation.valid) {
                resolve({ success: false, error: validation.error });
                return;
            }

            // Get duration
            let duration = 0;
            try {
                duration = await getAudioDuration(file);
            } catch (error) {
                const err = error as Error;
                resolve({ success: false, error: err.message });
                return;
            }

            // Create storage path
            const timestamp = Date.now();
            const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const storagePath = `audio/${meetingId}/${timestamp}_${safeFileName}`;
            const storageRef = ref(storage, storagePath);

            // Start upload
            const uploadTask = uploadBytesResumable(storageRef, file, {
                contentType: file.type,
                customMetadata: {
                    meetingId,
                    originalName: file.name,
                    duration: duration.toString()
                }
            });

            // Monitor progress
            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    onProgress?.({
                        bytesTransferred: snapshot.bytesTransferred,
                        totalBytes: snapshot.totalBytes,
                        progress,
                        state: snapshot.state as 'running' | 'paused'
                    });
                },
                (error) => {
                    console.error('Upload error:', error);
                    onProgress?.({
                        bytesTransferred: 0,
                        totalBytes: file.size,
                        progress: 0,
                        state: 'error'
                    });
                    resolve({ success: false, error: `Erreur d'upload: ${error.message}` });
                },
                async () => {
                    // Upload completed
                    try {
                        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                        const audioRecording: AudioRecording = {
                            fileUrl: downloadURL,
                            fileName: file.name,
                            storagePath,
                            fileSize: file.size,
                            duration,
                            mimeType: file.type,
                            uploadedAt: new Date().toISOString(),
                            transcriptionStatus: 'pending'
                        };

                        // Update meeting in Firestore
                        const meetingRef = doc(db, 'meetings', meetingId);
                        await updateDoc(meetingRef, {
                            audioRecording,
                            dateUpdated: new Date().toISOString()
                        });

                        onProgress?.({
                            bytesTransferred: file.size,
                            totalBytes: file.size,
                            progress: 100,
                            state: 'success'
                        });

                        resolve({ success: true, audioRecording });
                    } catch (error) {
                        const err = error as Error;
                        resolve({ success: false, error: `Erreur de finalisation: ${err.message}` });
                    }
                }
            );
        } catch (error) {
            const err = error as Error;
            resolve({ success: false, error: err.message });
        }
    });
};

/**
 * Delete audio file from Firebase Storage
 */
export const deleteAudioFile = async (meetingId: string, storagePath: string): Promise<boolean> => {
    try {
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);

        // Update meeting to remove audio recording
        const meetingRef = doc(db, 'meetings', meetingId);
        await updateDoc(meetingRef, {
            audioRecording: null,
            dateUpdated: new Date().toISOString()
        });

        return true;
    } catch (error) {
        console.error('Error deleting audio:', error);
        return false;
    }
};

/**
 * Format file size for display
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Format duration for display
 */
export const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }
    return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
};
