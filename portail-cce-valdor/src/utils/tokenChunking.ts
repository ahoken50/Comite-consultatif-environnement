/**
 * Token Chunking Utility for AI
 * Intelligently splits large texts to reduce token usage and improve AI responses
 */

import { logger } from './logger';

// Approximate token counts (1 token ≈ 4 characters for French)
const CHARS_PER_TOKEN = 4;

export interface ChunkOptions {
    maxTokens?: number;          // Max tokens per chunk (default: 8000)
    overlapTokens?: number;      // Overlap between chunks (default: 200)
    preserveSections?: boolean;  // Try to keep sections intact (default: true)
    priority?: 'start' | 'end' | 'balanced'; // Which parts to prioritize (default: balanced)
}

export interface ChunkedText {
    chunks: string[];
    totalTokens: number;
    chunksCount: number;
    wasTruncated: boolean;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
    maxTokens: 8000,
    overlapTokens: 200,
    preserveSections: true,
    priority: 'balanced'
};

/**
 * Estimate token count for a string
 */
export const estimateTokens = (text: string): number => {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
};

/**
 * Estimate character count for a token target
 */
export const tokensToChars = (tokens: number): number => {
    return tokens * CHARS_PER_TOKEN;
};

/**
 * Section markers for French meeting documents
 */
const SECTION_PATTERNS = [
    /^#{1,3}\s+/m,                          // Markdown headers
    /^\d+\.\s+/m,                           // Numbered items (1., 2., etc.)
    /^\d+\.\d+\s+/m,                        // Subnumbered items (1.1, 2.3, etc.)
    /^RÉSOLUTION\s+/mi,                     // Resolution markers
    /^COMMENTAIRE\s+/mi,                    // Comment markers
    /^CONSIDÉRANT\s+/mi,                    // Considering clauses
    /^IL EST RÉSOLU/mi,                     // Resolved clauses
    /^-{3,}/m,                              // Section breaks
    /^\*{3,}/m,                             // Section breaks
];

/**
 * Find section boundaries in text
 */
const findSectionBoundaries = (text: string): number[] => {
    const boundaries: number[] = [0]; // Start is always a boundary

    for (const pattern of SECTION_PATTERNS) {
        let match;
        const regex = new RegExp(pattern.source, 'gmi');
        while ((match = regex.exec(text)) !== null) {
            boundaries.push(match.index);
        }
    }

    // Add end
    boundaries.push(text.length);

    // Sort and dedupe
    return [...new Set(boundaries)].sort((a, b) => a - b);
};

/**
 * Smart text chunking that respects section boundaries
 */
export const chunkText = (
    text: string,
    options: ChunkOptions = {}
): ChunkedText => {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const maxChars = tokensToChars(opts.maxTokens);
    const overlapChars = tokensToChars(opts.overlapTokens);

    const totalTokens = estimateTokens(text);

    // If text fits in one chunk, return as-is
    if (text.length <= maxChars) {
        return {
            chunks: [text],
            totalTokens,
            chunksCount: 1,
            wasTruncated: false
        };
    }

    const chunks: string[] = [];

    if (opts.preserveSections) {
        // Find section boundaries
        const boundaries = findSectionBoundaries(text);
        let currentChunk = '';

        for (let i = 1; i < boundaries.length; i++) {
            const section = text.slice(boundaries[i - 1], boundaries[i]);

            // If adding this section would exceed limit
            if (currentChunk.length + section.length > maxChars) {
                // Save current chunk if not empty
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                }

                // If single section is too large, split it
                if (section.length > maxChars) {
                    const subChunks = splitLongSection(section, maxChars, overlapChars);
                    chunks.push(...subChunks);
                    currentChunk = '';
                } else {
                    // Start new chunk with overlap from previous
                    const overlap = currentChunk.slice(-overlapChars);
                    currentChunk = overlap + section;
                }
            } else {
                currentChunk += section;
            }
        }

        // Don't forget the last chunk
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
    } else {
        // Simple character-based splitting
        for (let i = 0; i < text.length; i += maxChars - overlapChars) {
            const chunk = text.slice(i, i + maxChars);
            if (chunk.trim()) {
                chunks.push(chunk.trim());
            }
        }
    }

    logger.debug('TokenChunking', `Split ${totalTokens} tokens into ${chunks.length} chunks`);

    return {
        chunks,
        totalTokens,
        chunksCount: chunks.length,
        wasTruncated: false
    };
};

/**
 * Split a single long section into smaller pieces
 */
const splitLongSection = (
    section: string,
    maxChars: number,
    overlapChars: number
): string[] => {
    const chunks: string[] = [];

    // Try to split on paragraph boundaries first
    const paragraphs = section.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
        if (currentChunk.length + para.length + 2 <= maxChars) {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
        } else {
            if (currentChunk) chunks.push(currentChunk);

            // If single paragraph is too long, split by sentences
            if (para.length > maxChars) {
                const sentences = para.split(/(?<=[.!?])\s+/);
                let sentenceChunk = '';

                for (const sentence of sentences) {
                    if (sentenceChunk.length + sentence.length + 1 <= maxChars) {
                        sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
                    } else {
                        if (sentenceChunk) chunks.push(sentenceChunk);
                        // If single sentence is still too long, hard split
                        if (sentence.length > maxChars) {
                            for (let i = 0; i < sentence.length; i += maxChars - overlapChars) {
                                chunks.push(sentence.slice(i, i + maxChars));
                            }
                            sentenceChunk = '';
                        } else {
                            sentenceChunk = sentence;
                        }
                    }
                }
                if (sentenceChunk) currentChunk = sentenceChunk;
                else currentChunk = '';
            } else {
                currentChunk = para;
            }
        }
    }

    if (currentChunk) chunks.push(currentChunk);

    return chunks;
};

/**
 * Truncate text intelligently to fit token limit
 * Keeps beginning and end, removes middle if needed
 */
export const truncateToTokens = (
    text: string,
    maxTokens: number,
    priority: 'start' | 'end' | 'balanced' = 'balanced'
): { text: string; wasTruncated: boolean } => {
    const maxChars = tokensToChars(maxTokens);

    if (text.length <= maxChars) {
        return { text, wasTruncated: false };
    }

    const truncationMarker = '\n\n[... CONTENU TRONQUÉ POUR OPTIMISATION ...]\n\n';
    const markerLength = truncationMarker.length;
    const availableChars = maxChars - markerLength;

    let result: string;

    switch (priority) {
        case 'start':
            result = text.slice(0, availableChars) + truncationMarker;
            break;

        case 'end':
            result = truncationMarker + text.slice(-availableChars);
            break;

        case 'balanced':
        default: {
            const halfLength = Math.floor(availableChars / 2);
            result = text.slice(0, halfLength) + truncationMarker + text.slice(-halfLength);
            break;
        }
    }

    logger.info('TokenChunking', `Truncated ${estimateTokens(text)} tokens to ${maxTokens}`);

    return { text: result, wasTruncated: true };
};

/**
 * Summarize key sections for AI context (structural summary)
 */
export const createStructuralSummary = (text: string): string => {
    const boundaries = findSectionBoundaries(text);
    const sections: string[] = [];

    for (let i = 1; i < boundaries.length && sections.length < 20; i++) {
        const section = text.slice(boundaries[i - 1], boundaries[i]).trim();
        if (section.length > 10) {
            // Take first line as section title/summary
            const firstLine = section.split('\n')[0].slice(0, 100);
            sections.push(`- ${firstLine}${section.length > 100 ? '...' : ''}`);
        }
    }

    return `STRUCTURE DU DOCUMENT (${sections.length} sections):\n${sections.join('\n')}`;
};
