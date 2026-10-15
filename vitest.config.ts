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
