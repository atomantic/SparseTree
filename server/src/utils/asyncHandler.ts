import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to the Express error handler via next(err).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
