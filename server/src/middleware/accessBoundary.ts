import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_ORIGIN = 'http://localhost:6373';

export const resolveAccessConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const host = env.HOST || 'localhost';
  const external = !LOOPBACK_HOSTS.has(host);
  const token = env.SPARSETREE_API_TOKEN;
  if (token !== undefined && !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('SPARSETREE_API_TOKEN must be a non-empty token without whitespace');
  }
  if (external && !token) {
    throw new Error('Non-loopback HOST requires SPARSETREE_API_TOKEN');
  }

  const origins = (env.CORS_ORIGIN || DEFAULT_ORIGIN).split(',').map(value => {
    const origin = value.trim();
    const url = URL.parse(origin);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGIN must contain only exact HTTP(S) origins');
    }
    return origin;
  });
  return { host, token, origins };
};

/** Fixed-length hashes compare credentials without revealing token lengths. */
export const createBearerCheck = (token: string | undefined) => {
  const expected = token ? createHash('sha256').update(token).digest() : null;
  return (authorization: string | undefined): 401 | 403 | null => {
    if (!expected) return null;
    const match = /^Bearer ([\x21-\x7e]+)$/i.exec(authorization || '');
    if (!match) return 401;
    const supplied = createHash('sha256').update(match[1]).digest();
    return timingSafeEqual(expected, supplied) ? null : 403;
  };
};

export const createAccessBoundary = (token: string | undefined): RequestHandler => {
  const check = createBearerCheck(token);
  return (req, res, next) => {
    const status = check(req.headers.authorization);
    if (status) {
      res.status(status).json({ success: false, error: status === 401
        ? 'Bearer authentication required' : 'Invalid bearer credentials' });
      return;
    }
    next();
  };
};
