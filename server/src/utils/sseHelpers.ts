import type { Request, Response } from 'express';
import { logger } from '../lib/logger.js';

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
    if (res.destroyed || res.writableEnded) return;
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
    if (res.destroyed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

/** A request owns this operation; observers of background work must not use it. */
export function createSSEOperation(
  req: Request,
  res: Response,
  cancel: () => unknown,
  metadata: { route: string; operationId: () => string | null },
) {
  const controller = new AbortController();
  let finished = false;
  const disconnect = () => {
    if (finished || controller.signal.aborted) return;
    logger.warn('sse-operation', JSON.stringify({
      route: metadata.route, operationId: metadata.operationId(), cause: 'client-disconnect',
    }));
    controller.abort();
    cancel();
  };
  req.on('close', disconnect);
  res.on('close', disconnect);

  const finish = () => {
    finished = true;
    req.off('close', disconnect);
    res.off('close', disconnect);
    if (!controller.signal.aborted && !res.destroyed && !res.writableEnded) res.end();
  };

  return {
    signal: controller.signal,
    async run(work: (signal: AbortSignal) => Promise<void>) {
      try {
        if (req.destroyed || res.destroyed) disconnect();
        if (!controller.signal.aborted) await work(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        finish();
      }
    },
  };
}
