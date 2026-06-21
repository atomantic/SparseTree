import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    host: '0.0.0.0',
    port: 6373,
    // Allow access over Tailscale MagicDNS (http://<node>.<tailnet>.ts.net:6373/,
    // or https://<node>.<tailnet>.ts.net/ when fronted by `tailscale serve`).
    // A leading dot matches the domain and all subdomains, so every node name
    // in the tailnet is accepted.
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: 'http://localhost:6374',
        changeOrigin: true
      }
    }
  }
});
