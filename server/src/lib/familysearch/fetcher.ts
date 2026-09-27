/**
 * FamilySearch API fetcher with retry logic
 */

import { fsc } from './client.js';
import { logger } from '../logger.js';

// Transient network error codes that should trigger retry
const TRANSIENT_ERROR_CODES = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
];

export interface FetchError {
  isNetworkError: boolean;
  isTransient: boolean;
  code?: string;
  statusCode?: number;
  message: string;
  data?: unknown;
  errors?: Array<{ label?: string; message?: string }>;
  originalError?: Error;
}

export const fscget = async <T = unknown>(path: string): Promise<T> => {
  const response = await fsc.get<T>(path).catch((error: Error & { code?: string; cause?: { code?: string } }) => {
    const code = error.name === 'TimeoutError' ? 'ETIMEDOUT' : error.cause?.code || (typeof error.code === 'string' ? error.code : undefined);
    throw {
      isNetworkError: error instanceof TypeError || !!code,
      isTransient: TRANSIENT_ERROR_CODES.includes(code || ''),
      code,
      message: error.message,
      originalError: error,
    } satisfies FetchError;
  });
  if (response.statusCode >= 400) {
    const data = response.data as { errors?: FetchError['errors'] } | undefined;
    const errors = Array.isArray(data?.errors) ? data.errors : undefined;
    logger.error('fs-api', `HTTP ${response.statusCode}`);
    if (response.statusCode === 401 || errors?.[0]?.label === 'Unauthorized') {
      throw Object.assign(new Error('FS_ACCESS_TOKEN is invalid, please use a new one'), { isAuthError: true });
    }
    throw {
      isNetworkError: false,
      isTransient: response.statusCode === 429 || response.statusCode >= 500,
      statusCode: response.statusCode,
      message: `FamilySearch API error: ${response.statusCode}`,
      data: response.data,
      errors,
    } satisfies FetchError;
  }
  return response.data;
};

export default fscget;
