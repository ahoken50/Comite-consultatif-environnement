/**
 * API Utilities
 * Centralized error handling and API result types
 */

import { logger } from './logger';
import { ErrorMessages } from '../constants';

// ============================================
// RESULT TYPES
// ============================================

/**
 * Generic API result type for consistent success/error handling
 */
export interface ApiResult<T> {
    success: true;
    data: T;
    error?: never;
}

export interface ApiError {
    success: false;
    data?: never;
    error: string;
    technicalError?: string; // For debugging, not shown to user
}

export type ApiResponse<T> = ApiResult<T> | ApiError;

/**
 * Helper to create a success result
 */
export const success = <T>(data: T): ApiResult<T> => ({
    success: true,
    data
});

/**
 * Helper to create an error result
 */
export const failure = (error: string, technicalError?: string): ApiError => ({
    success: false,
    error,
    technicalError
});

// ============================================
// ERROR MAPPING
// ============================================

/**
 * Map technical errors to user-friendly messages
 */
const mapErrorToUserMessage = (error: Error): string => {
    const msg = error.message.toLowerCase();

    // API/Configuration errors
    if (msg.includes('api') || msg.includes('key') || msg.includes('unauthorized')) {
        return ErrorMessages.API_KEY_MISSING;
    }

    // Network errors
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
        return ErrorMessages.NETWORK_ERROR;
    }

    // Timeout errors
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('deadline')) {
        return ErrorMessages.TIMEOUT_ERROR;
    }

    // Transcription errors
    if (msg.includes('transcription') || msg.includes('whisper') || msg.includes('audio')) {
        return ErrorMessages.TRANSCRIPTION_FAILED;
    }

    // Parse errors
    if (msg.includes('parse') || msg.includes('json') || msg.includes('format')) {
        return ErrorMessages.PARSE_ERROR;
    }

    // Permission errors
    if (msg.includes('permission') || msg.includes('denied') || msg.includes('forbidden')) {
        return ErrorMessages.PERMISSION_DENIED;
    }

    // Not found
    if (msg.includes('not found') || msg.includes('404') || msg.includes('missing')) {
        return ErrorMessages.NOT_FOUND;
    }

    // Default
    return ErrorMessages.UNKNOWN;
};

// ============================================
// ERROR HANDLING WRAPPER
// ============================================

/**
 * Execute an async operation with standardized error handling
 * 
 * @param context - Logging context (e.g., 'Claude', 'Gemini', 'Firestore')
 * @param operation - The async operation to execute
 * @returns ApiResponse with either success data or user-friendly error
 * 
 * @example
 * const result = await withErrorHandling('Claude', async () => {
 *     const response = await fetch(...);
 *     return response.json();
 * });
 * 
 * if (result.success) {
 *     console.log(result.data);
 * } else {
 *     showError(result.error);
 * }
 */
export const withErrorHandling = async <T>(
    context: string,
    operation: () => Promise<T>
): Promise<ApiResponse<T>> => {
    const timer = logger.time(context, 'Operation');

    try {
        const data = await operation();
        timer.end({ success: true });
        return success(data);

    } catch (error) {
        const err = error as Error;
        const userMessage = mapErrorToUserMessage(err);

        logger.logError(context, err);
        timer.end({ success: false, error: err.message });

        return failure(userMessage, err.message);
    }
};

/**
 * Execute with error handling and custom error message
 */
export const withErrorHandlingCustom = async <T>(
    context: string,
    operation: () => Promise<T>,
    customErrorMessage: string
): Promise<ApiResponse<T>> => {
    const timer = logger.time(context, 'Operation');

    try {
        const data = await operation();
        timer.end({ success: true });
        return success(data);

    } catch (error) {
        const err = error as Error;
        logger.logError(context, err);
        timer.end({ success: false, error: err.message });

        return failure(customErrorMessage, err.message);
    }
};

// ============================================
// RETRY LOGIC
// ============================================

interface RetryOptions {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: Error) => boolean;
}

const defaultRetryOptions: Required<RetryOptions> = {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
    shouldRetry: (error) => {
        const msg = error.message.toLowerCase();
        // Retry on network/timeout errors, not on auth/validation errors
        return msg.includes('network') ||
            msg.includes('timeout') ||
            msg.includes('fetch') ||
            msg.includes('429'); // Rate limit
    }
};

/**
 * Execute with retry logic for transient failures
 */
export const withRetry = async <T>(
    context: string,
    operation: () => Promise<T>,
    options?: RetryOptions
): Promise<ApiResponse<T>> => {
    const opts = { ...defaultRetryOptions, ...options };
    let lastError: Error | null = null;
    let delay = opts.delayMs;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            const data = await operation();
            if (attempt > 1) {
                logger.info(context, `Succeeded on attempt ${attempt}`);
            }
            return success(data);

        } catch (error) {
            lastError = error as Error;

            if (attempt < opts.maxAttempts && opts.shouldRetry(lastError)) {
                logger.warn(context, `Attempt ${attempt} failed, retrying in ${delay}ms`, {
                    error: lastError.message
                });
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= opts.backoffMultiplier;
            }
        }
    }

    logger.error(context, `All ${opts.maxAttempts} attempts failed`);
    return failure(mapErrorToUserMessage(lastError!), lastError!.message);
};

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validate that a value exists, return error if not
 */
export const requireValue = <T>(
    value: T | null | undefined,
    errorMessage: string
): ApiResponse<T> => {
    if (value === null || value === undefined) {
        return failure(errorMessage);
    }
    return success(value);
};

/**
 * Validate API key is present
 */
export const requireApiKey = (key: string | undefined, serviceName: string): ApiResponse<string> => {
    if (!key) {
        logger.error(serviceName, 'API key is missing');
        return failure(ErrorMessages.API_KEY_MISSING);
    }
    return success(key);
};
