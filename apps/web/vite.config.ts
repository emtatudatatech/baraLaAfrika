import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { securityHeadersPlugin } from './build/securityHeaders.ts';

export default defineConfig({
  plugins: [react(), securityHeadersPlugin()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
  },
});
