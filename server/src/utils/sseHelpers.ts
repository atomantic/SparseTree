import type { Response } from 'express';

/**
 * Initialize an SSE (Server-Sent Events) response.
 * Sets the required headers and returns a sendEvent function.
 */
export function initSSE(res: Response): (event: string, data: unknown) => void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setTimeout(0);
  res.flushHeaders();

  return (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}
