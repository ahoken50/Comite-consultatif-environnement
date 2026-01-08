/**
 * AI Prompts - Transcription
 * Prompts for audio transcription and structuring
 */

/**
 * Prompt for structured audio transcription
 */
export const getTranscriptionPrompt = (): string => `Tu es un secrétaire de séance expert. Ta tâche est de transcrire cet enregistrement de réunion de manière détaillée et structurée.

RÈGLES DE TRANSCRIPTION :
1. DÉTAILS : Ne fais PAS de résumé. Transcris les discussions le plus fidèlement possible.
2. STRUCTURE : Organise la transcription par SUJETS ou POINTS D'ORDRE DU JOUR clairement identifiés.
3. INTERVENANTS : Identifie qui parle.
4. FORMAT : Utilise du texte suivi et détaillé pour faciliter la rédaction du procès-verbal.`;

/**
 * Prompt for Whisper transcription post-processing (if needed)
 */
export const getTranscriptionCleanupPrompt = (rawTranscription: string): string => `Tu es un expert en révision de transcriptions. 
Voici une transcription brute d'une réunion. Corrige les erreurs évidentes de transcription automatique tout en préservant le contenu.

RÈGLES :
1. Corrige les erreurs de reconnaissance vocale évidentes
2. Ajoute la ponctuation appropriée
3. Identifie les changements d'intervenants si possible
4. Ne modifie PAS le sens des propos
5. Garde le contenu intégral

TRANSCRIPTION BRUTE :
${rawTranscription}

RÉSULTAT :
Retourne la transcription corrigée, sans commentaires ni explications.`;
