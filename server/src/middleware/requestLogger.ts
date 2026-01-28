import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const isGet = req.method === 'GET';
  if (!isGet) {
    logger.api('http', `${req.method} ${req.path} started`);
  }

  res.on('finish', () => {
    const elapsed = performance.now() - start;
    const formatted = elapsed >= 1000
      ? `${(elapsed / 1000).toFixed(1)}s`
      : `${Math.round(elapsed)}ms`;
    const isSlow = elapsed >= 500;
    const shouldLog = !isGet || res.statusCode >= 400 || isSlow;

    if (!shouldLog) return;

    if (res.statusCode < 400) {
      logger.done('http', `${req.method} ${req.path} ${res.statusCode} (${formatted})`);
    } else {
      logger.error('http', `${req.method} ${req.path} ${res.statusCode} (${formatted})`);
    }
  });

  next();
};
