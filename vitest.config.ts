import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          // Database tests build an in-memory Postgres with every seed; under a full parallel
          // run that can take longer than the 5-second default.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          include: [
            'packages/**/*.test.ts',
            'netlify/tests/**/*.test.ts',
            'db/tests/**/*.test.ts',
            'apps/web/build/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
