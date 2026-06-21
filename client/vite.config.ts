import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    port: 6373,
    // Allow access over Tailscale MagicDNS (https://<node>.<tailnet>.ts.net/)
    // fronted by `tailscale serve`. A leading dot matches the domain and all
    // subdomains, so every node name in the tailnet is accepted.
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: 'http://localhost:6374',
        changeOrigin: true
      }
    }
  }
});
