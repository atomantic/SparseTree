import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createBearerCheck, resolveAccessConfig } from '../server/src/middleware/accessBoundary';
import tailwindcss from '@tailwindcss/vite';

// A remotely reachable dev proxy must never expose a token-free local API.
const access = resolveAccessConfig({ ...process.env, HOST: process.env.VITE_HOST || 'localhost' });

const check = createBearerCheck(access.token);
const accessGate = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  const status = check(req.headers.authorization);
  if (!status) return next();
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: false, error: status === 401
    ? 'Bearer authentication required' : 'Invalid bearer credentials' }));
};

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'sparsetree-access-boundary',
    configResolved(config) {
      // Validate final binds, including CLI --host overrides and preview.
      for (const host of [config.server.host, config.preview.host ?? config.server.host]) {
        resolveAccessConfig({ ...process.env, HOST: typeof host === 'string'
          ? host : host ? '0.0.0.0' : 'localhost' });
      }
    },
    configureServer(server) {
      // Gate the proxy itself even if its target was started without a token.
      server.middlewares.use(accessGate);
    },
    configurePreviewServer(server) {
      server.middlewares.use(accessGate);
    }
  }],
  // The monorepo hoists react@18 (pulled in as an optional peer of
  // portos-ai-toolkit) to the root node_modules while the app itself uses
  // react@19 under client/node_modules. Without deduping, hoisted packages
  // such as react-router-dom resolve the root react@18, producing two copies
  // of React in the browser ("Invalid hook call" / useRef on null). Force every
  // bare react/react-dom import to resolve to the single client copy.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: access.host,
    port: 6373,
    proxy: {
      '/api': {
        target: 'http://localhost:6374',
        changeOrigin: true
      }
    }
  }
});
