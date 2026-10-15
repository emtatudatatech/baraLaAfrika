import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { securityHeadersPlugin } from './build/securityHeaders.ts';

// End-to-end tests (and optionally local dev) proxy /api to a local API server, e.g. the
// PGlite-backed e2e server (e2e/api-server.ts) or `netlify dev` functions.
const apiProxy = process.env.BLA_API_PROXY;
const proxy = apiProxy ? { '/api': { target: apiProxy, changeOrigin: true } } : undefined;

export default defineConfig({
  plugins: [react(), securityHeadersPlugin()],
  server: { port: 5173, strictPort: true, ...(proxy ? { proxy } : {}) },
  preview: { port: 4173, strictPort: true, ...(proxy ? { proxy } : {}) },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
  },
});
