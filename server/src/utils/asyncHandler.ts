import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to the Express error handler via next(err).
 * Generic over route params so handlers can declare `Request<{ id: string }>`.
 */
export function asyncHandler<P = ParamsDictionary>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler<P> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
