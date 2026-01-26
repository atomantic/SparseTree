import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error('server', `Unhandled: ${err.message}`);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
};
