import type { RequestHandler } from 'express';

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'API route not found'
  });
};
