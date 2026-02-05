
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export interface EnrollmentResponse {
    success: boolean;
    speaker_id: string;
}

/**
 * Enrolls a speaker by sending an audio blob to the cloud function.
 * @param name The name of the speaker (e.g. "Jean Dupont")
 * @param audioBlob The recorded audio file (WAV)
 */
export const enrollSpeaker = async (name: string, audioBlob: Blob): Promise<EnrollmentResponse> => {
    try {
        // We use fetch directly because sending Blob via httpsCallable is tricky/limited
        // However, we need the function URL. 
        // For now, let's assume we use the standard httpsCallable which supports JSON.
        // But sending binary audio in JSON is inefficient (base64).
        // A better approach is to upload to Storage or use raw HTTP request.

        // Let's use raw fetch to the function URL for multipart/form-data support
        // which our Python function supports.

        // Dynamically determine the URL based on the project
        // This is a bit hacky for client-side, usually better to helper.
        // Let's try to get it from the firebase config or hardcode the pattern for now if needed,
        // but cleaner is to use a callable that returns a signed URL or similar.

        // SIMPLIFICATION FOR PROTOTYPE:
        // Use FormData and fetch to the likely URL structure.

        const projectId = 'comite-cce-valdor'; // Start with hardcoded or env
        const region = 'us-central1';
        const functionName = 'enroll_speaker';

        // Local emulator fallback?
        const isLocal = window.location.hostname === 'localhost';
        const url = isLocal
            ? `http://127.0.0.1:5001/${projectId}/${region}/${functionName}`
            : `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;

        const formData = new FormData();
        formData.append('file', audioBlob, 'enrollment.wav');

        // We pass the name as a query param or headers, or inside form if we modify python.
        // Python code: name = req.args.get('name')
        const fullUrl = `${url}?name=${encodeURIComponent(name)}`;

        const response = await fetch(fullUrl, {
            method: 'POST',
            body: formData
            // No Content-Type header! fetch adds it with boundary automatically for FormData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur serveur (${response.status}): ${errorText}`);
        }

        const result = await response.json();
        return result as EnrollmentResponse;

    } catch (error) {
        console.error("Error enrolling speaker:", error);
        throw error;
    }
};
