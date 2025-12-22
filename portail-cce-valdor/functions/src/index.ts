import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallableContext } from "firebase-functions/v1/https";
import axios from "axios";

// --- DEBUG MODE : PING TEST ---
// We commented out the complex logic to verify connectivity first.

try {
    admin.initializeApp();
} catch (e) { }

export const transcribeAudio = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .https.onCall(async (data: any, context: CallableContext) => {

        console.log('[DEBUG] Function reached successfully!');
        console.log('[DEBUG] Data received:', data);
        console.log('[DEBUG] Auth context:', context.auth?.uid);

        // 1. SIMPLE RETURN TO VERIFY INFRASTRUCTURE
        return {
            success: true,
            transcription: "## [TEST] Connexion Réussie\n\nLe serveur fonctionne correctement. La logique de transcription est temporairement désactivée pour ce test.",
            debug_info: {
                auth: !!context.auth,
                has_api_key: !!functions.config().google?.api_key || !!process.env.GOOGLE_API_KEY,
                region: process.env.FUNCTION_REGION
            }
        };
    });
