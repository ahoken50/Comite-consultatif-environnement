/**
 * Centralized Logger with Structured Levels
 * Includes API key masking for security (#10 + #13)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
    [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

// Get current log level from environment
const getCurrentLevel = (): LogLevel => {
    // In production, only show warnings and errors
    // In development, show everything
    return import.meta.env.DEV ? 'debug' : 'warn';
};

/**
 * Sensitive patterns to redact from logs
 */
const SENSITIVE_PATTERNS = [
    /key=[^&\s]+/gi,           // API keys in URLs
    /token=[^&\s]+/gi,         // Tokens in URLs
    /bearer\s+[^\s]+/gi,       // Bearer tokens
    /authorization:\s*[^\s]+/gi, // Authorization headers
];

const SENSITIVE_KEYS = [
    'key', 'apiKey', 'api_key', 'apikey',
    'token', 'accessToken', 'access_token',
    'secret', 'password', 'pwd',
    'authorization', 'auth'
];

/**
 * Sanitize a string value to mask sensitive information
 */
const sanitizeString = (value: string): string => {
    let sanitized = value;
    for (const pattern of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
};

/**
 * Deep sanitize an object to mask sensitive information
 */
const sanitize = (payload: LogPayload): LogPayload => {
    const sanitized: LogPayload = {};

    for (const [key, value] of Object.entries(payload)) {
        const lowerKey = key.toLowerCase();

        // Check if key name is sensitive
        if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '[REDACTED]';
            continue;
        }

        // Handle different value types
        if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            sanitized[key] = sanitize(value as LogPayload);
        } else if (Array.isArray(value)) {
            sanitized[key] = value.map(item =>
                typeof item === 'object' && item !== null
                    ? sanitize(item as LogPayload)
                    : item
            );
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
};

/**
 * Format timestamp for logs
 */
const getTimestamp = (): string => {
    return new Date().toISOString();
};

/**
 * Core logging function
 */
const log = (
    level: LogLevel,
    context: string,
    message: string,
    payload?: LogPayload
) => {
    const currentLevel = getCurrentLevel();

    // Skip if below current log level
    if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) {
        return;
    }

    const timestamp = getTimestamp();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
    const sanitizedPayload = payload ? sanitize(payload) : undefined;

    // Select appropriate console method
    const logFn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
            : level === 'debug' ? console.debug
                : console.log;

    // Log with or without payload
    if (sanitizedPayload && Object.keys(sanitizedPayload).length > 0) {
        logFn(`${prefix} ${message}`, sanitizedPayload);
    } else {
        logFn(`${prefix} ${message}`);
    }
};

/**
 * Logger interface with convenience methods
 */
export const logger = {
    /**
     * Debug level - Development only
     */
    debug: (context: string, message: string, payload?: LogPayload) =>
        log('debug', context, message, payload),

    /**
     * Info level - General information
     */
    info: (context: string, message: string, payload?: LogPayload) =>
        log('info', context, message, payload),

    /**
     * Warning level - Something unexpected but not critical
     */
    warn: (context: string, message: string, payload?: LogPayload) =>
        log('warn', context, message, payload),

    /**
     * Error level - Something went wrong
     */
    error: (context: string, message: string, payload?: LogPayload) =>
        log('error', context, message, payload),

    /**
     * Log an error object with stack trace
     */
    logError: (context: string, error: Error, additionalInfo?: LogPayload) => {
        log('error', context, error.message, {
            name: error.name,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
            ...additionalInfo
        });
    },

    /**
     * Create a scoped logger for a specific context
     */
    scope: (context: string) => ({
        debug: (message: string, payload?: LogPayload) => log('debug', context, message, payload),
        info: (message: string, payload?: LogPayload) => log('info', context, message, payload),
        warn: (message: string, payload?: LogPayload) => log('warn', context, message, payload),
        error: (message: string, payload?: LogPayload) => log('error', context, message, payload),
        logError: (error: Error, additionalInfo?: LogPayload) =>
            log('error', context, error.message, {
                name: error.name,
                stack: error.stack?.split('\n').slice(0, 5).join('\n'),
                ...additionalInfo
            })
    }),

    /**
     * Log performance timing
     */
    time: (context: string, label: string) => {
        const start = performance.now();
        return {
            end: (additionalInfo?: LogPayload) => {
                const duration = Math.round(performance.now() - start);
                log('debug', context, `${label} completed in ${duration}ms`, additionalInfo);
            }
        };
    }
};

export default logger;
