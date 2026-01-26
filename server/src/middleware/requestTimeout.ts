/**
 * Request timeout middleware
 *
 * Prevents any single request from blocking the event loop indefinitely.
 * Returns 504 Gateway Timeout if request takes too long.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export interface TimeoutOptions {
  timeout: number; // milliseconds
  message?: string;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MESSAGE = 'Request timeout - operation took too long';

/**
 * Create a timeout middleware with configurable timeout
 */
export function createTimeoutMiddleware(options: Partial<TimeoutOptions> = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const message = options.message || DEFAULT_MESSAGE;

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip for SSE endpoints (they're meant to be long-lived)
    if (req.headers.accept === 'text/event-stream') {
      return next();
    }

    // Skip for WebSocket upgrade requests
    if (req.headers.upgrade === 'websocket') {
      return next();
    }

    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;

      // Only send error if headers haven't been sent
      if (!res.headersSent) {
        logger.warn('http', `Request timeout: ${req.method} ${req.path}`);
        res.status(504).json({
          success: false,
          error: message,
          timeout: true,
          path: req.path,
          method: req.method
        });
      }
    }, timeout);

    // Clean up timer when response finishes
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    // Wrap next to prevent further processing after timeout
    const originalEnd = res.end.bind(res);
    res.end = function(...args: Parameters<typeof originalEnd>) {
      clearTimeout(timer);
      if (!timedOut) {
        return originalEnd(...args);
      }
      return res;
    } as typeof res.end;

    next();
  };
}

/**
 * Default timeout middleware (30 seconds)
 */
export const requestTimeout = createTimeoutMiddleware();

/**
 * Long timeout for specific routes (2 minutes)
 */
export const longRequestTimeout = createTimeoutMiddleware({
  timeout: 120000,
  message: 'Long-running operation timed out'
});

/**
 * Short timeout for quick endpoints (10 seconds)
 */
export const shortRequestTimeout = createTimeoutMiddleware({
  timeout: 10000,
  message: 'Quick operation timed out'
});
