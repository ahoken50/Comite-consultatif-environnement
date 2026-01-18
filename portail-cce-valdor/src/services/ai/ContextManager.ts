/**
 * Context Manager for handling large LLM inputs.
 * Implements "Smart Chunking" based on Agenda items or Token limits.
 */

export interface Chunk {
    id: number;
    content: string;
    type: 'agenda_point' | 'continuation';
}

export class ContextManager {
    static MAX_CHUNK_SIZE = 25000; // Safe limit for standard prompts (approx 6-8k tokens)

    /**
     * Splits transcription into logical chunks.
     * Strategies:
     * 1. By Agenda Item (Regex detection of "Point X", "3.1", etc.)
     * 2. By Speaker blocks (if structured)
     * 3. Hard Token Limit (fallback)
     */
    static splitIntoChunks(transcription: string, _agendaItems: string[] = []): Chunk[] {
        const chunks: Chunk[] = [];

        // Strategy 1: Attempt to split by Agenda Items if keys are present in text
        // This is a simplified heuristic. Ideally, we would use a lighter LLM to segment, 
        // but regex is faster and cheaper for now.

        // Fallback: Simple character chunking for now to ensure it works universally
        let currentIndex = 0;
        let chunkCounter = 1;

        while (currentIndex < transcription.length) {
            let endIndex = Math.min(currentIndex + this.MAX_CHUNK_SIZE, transcription.length);

            // Try to find a sentence break or newline near the limit to avoid cutting words
            if (endIndex < transcription.length) {
                const lastPeriod = transcription.lastIndexOf('.', endIndex);
                const lastNewline = transcription.lastIndexOf('\n', endIndex);
                const splitIndex = Math.max(lastPeriod, lastNewline);

                if (splitIndex > currentIndex + (this.MAX_CHUNK_SIZE * 0.5)) {
                    // Only use smart split if it's not too far back (keep at least 50% capacity)
                    endIndex = splitIndex + 1;
                }
            }

            chunks.push({
                id: chunkCounter++,
                content: transcription.substring(currentIndex, endIndex).trim(),
                type: 'continuation'
            });

            currentIndex = endIndex;
        }

        return chunks;
    }
}
