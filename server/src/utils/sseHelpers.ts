import type { Response } from 'express';

/**
 * Set standard SSE headers on a response.
 */
function setSSEHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setTimeout(0);
  res.flushHeaders();
}

/**
 * Initialize an SSE response with named events.
 * Returns a sendEvent(event, data) function.
 */
export function initSSE(res: Response): (event: string, data: unknown) => void {
  setSSEHeaders(res);

  return (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Initialize an SSE response with unnamed (data-only) events.
 * Returns a sendEvent(data) function — clients receive these on the default 'message' event.
 */
export function initSSEData(res: Response): (data: unknown) => void {
  setSSEHeaders(res);

  return (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}
