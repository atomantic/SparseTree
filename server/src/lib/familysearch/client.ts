/** FamilySearch reads with a fixed production origin and per-client credentials. */
import { config } from '../config.js';

const API_ORIGIN = 'https://api.familysearch.org';

export interface FamilySearchResponse<T = unknown> {
  statusCode: number;
  data: T;
}

interface ClientOptions {
  accessToken: string;
  maxThrottledRetries?: number;
  timeout?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function apiUrl(path: string): URL {
  if (!path.startsWith('/platform/') || path.includes('\\') || /[\r\n]/.test(path)) {
    throw new Error('FamilySearch requests require a relative /platform/ path');
  }
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/platform/')) {
    throw new Error('Invalid FamilySearch API path');
  }
  return url;
}

export function createFamilySearchClient({
  accessToken,
  maxThrottledRetries = 10,
  timeout = config.timeout,
  fetch = globalThis.fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
}: ClientOptions) {
  return {
    async get<T = unknown>(path: string): Promise<FamilySearchResponse<T>> {
      const url = apiUrl(path);
      for (let retries = 0; ; retries++) {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/x-fs-v1+json',
            'X-Expect-Override': '200-ok',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          // Never forward a bearer token to an upstream-supplied redirect target.
          redirect: 'manual',
          signal: AbortSignal.timeout(timeout),
        });
        if (response.status === 429 && retries < maxThrottledRetries) {
          await response.body?.cancel();
          const retry = Number(response.headers.get('retry') || response.headers.get('retry-after'));
          const milliseconds = Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 60_000) : 1000;
          await sleep(milliseconds);
          continue;
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error('FamilySearch API redirect rejected');
        }
        const body = await response.text();
        // Keep HTTP failures classifiable even when the upstream error page is HTML.
        const data = body ? await Promise.resolve().then(() => JSON.parse(body)).catch(error => {
          if (response.ok) throw new Error('Malformed FamilySearch JSON response', { cause: error });
          return undefined;
        }) : undefined;
        if (response.ok && data === undefined) throw new Error('Empty FamilySearch JSON response');
        return { statusCode: response.status, data: data as T };
      }
    },
  };
}

export const fsc = createFamilySearchClient({ accessToken: config.accessToken });
export default fsc;
