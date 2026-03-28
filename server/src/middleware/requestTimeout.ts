/**
 * Request timeout middleware (30s default)
 *
 * Prevents any single request from blocking the event loop indefinitely.
 * Returns 504 Gateway Timeout if request takes too long.
 * Skips SSE and WebSocket requests automatically.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export const requestTimeout = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers.accept === 'text/event-stream' || req.headers.upgrade === 'websocket') {
    return next();
  }

  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) {
      logger.warn('http', `Request timeout: ${req.method} ${req.path}`);
      res.status(504).json({
        success: false,
        error: 'Request timeout - operation took too long',
        timeout: true,
        path: req.path,
        method: req.method
      });
    }
  }, 30000);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

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
