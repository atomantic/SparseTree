import { useEffect, useRef } from 'react';

type SSEEventHandler = (event: MessageEvent) => void;

/**
 * Subscribe to Server-Sent Events on a given URL.
 *
 * @param url       The SSE endpoint URL (pass `null` to disable)
 * @param handlers  A stable record mapping event names to handlers.
 *                  Use `message` key for the default `onmessage` handler.
 *                  Callers MUST memoise this object (e.g. with useRef or
 *                  useMemo) to avoid reconnecting on every render.
 */
export function useSSE(
  url: string | null,
  handlers: Record<string, SSEEventHandler>,
) {
  // Keep a ref to the latest handlers so we don't reconnect when they change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!url) return;

    const eventSource = new EventSource(url);

    // Proxy every named event through the ref so the EventSource instance
    // stays stable while handler implementations can change freely.
    const names = Object.keys(handlersRef.current);
    for (const name of names) {
      if (name === 'message') {
        eventSource.onmessage = (e) => handlersRef.current.message?.(e);
      } else {
        eventSource.addEventListener(name, (e) => {
          handlersRef.current[name]?.(e as MessageEvent);
        });
      }
    }

    return () => eventSource.close();
  }, [url]);
}
