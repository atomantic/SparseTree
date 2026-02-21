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

export const fscget = async <T = unknown>(url: string): Promise<T> =>
  new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fsc.get(url, (error: Error | null, response: any) => {
      // Handle network-level errors (no response received)
      if (error) {
        const errorCode = (error as NodeJS.ErrnoException).code || String((error as NodeJS.ErrnoException).errno);
        const isTransient = TRANSIENT_ERROR_CODES.includes(errorCode || '');
        return reject({
          isNetworkError: true,
          isTransient,
          code: errorCode,
          message: error.message || String(error),
          originalError: error,
        } as FetchError);
      }

      // Handle HTTP errors (response received but with error status)
      if (response.statusCode >= 400) {
        const errors = response?.data?.errors;
        logger.error('fs-api', `HTTP ${response.statusCode}: ${errors ? errors.map((e: { label?: string; message?: string }) => e.label || e.message).join(', ') : 'Unknown error'}`);
        if (errors && errors[0]?.label === 'Unauthorized') {
          logger.error('fs-api', `FS_ACCESS_TOKEN is invalid, please use a new one`);
          const authError = new Error('FS_ACCESS_TOKEN is invalid, please use a new one');
          (authError as any).isAuthError = true;
          return reject(authError);
        }
        return reject({
          isNetworkError: false,
          isTransient: response.statusCode >= 500, // 5xx errors are often transient
          statusCode: response.statusCode,
          data: response.data,
          errors: errors,
        } as FetchError);
      }

      resolve(response.data as T);
    });
  });

export default fscget;
