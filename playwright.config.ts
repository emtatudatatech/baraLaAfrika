import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const API_PORT = '4174';
const isCI = Boolean(process.env.CI);

/** iPhone 13-class metrics (390×844) on Chromium, so CI needs only one browser. */
const mobile = {
  ...devices['iPhone 13'],
  browserName: 'chromium' as const,
  defaultBrowserType: 'chromium' as const,
  viewport: { width: 390, height: 844 },
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // The real API handlers on an in-memory Postgres loaded with the committed seeds.
      command: 'node e2e/api-server.ts',
      url: `http://127.0.0.1:${API_PORT}/api/regions`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      env: { E2E_API_PORT: API_PORT },
    },
    {
      command: 'npm run build && npm run preview',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: { BLA_API_PROXY: `http://127.0.0.1:${API_PORT}` },
    },
  ],
  projects: [
    {
      name: 'desktop',
      testIgnore: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', testIgnore: /screenshots\.spec\.ts/, use: mobile },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
