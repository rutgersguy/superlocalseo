import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './tests/e2e/config';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/global-setup.ts', '**/global-teardown.ts', '**/helpers/**', '**/config.ts'],
  timeout: 45_000,
  retries: 1,
  // Serial by necessity: the suite shares one database and cleans up by email
  // pattern. Safe to raise once a disposable test stack exists (see tests/e2e/config.ts).
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
