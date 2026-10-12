import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    // Must match the port `npm run dev` actually serves on. These were left at
    // 3000 after the dev script moved to 3102, so `webServer` waited for a URL
    // that never came up and every e2e test timed out before running (#177).
    baseURL: 'http://localhost:3102',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3102',
    reuseExistingServer: !process.env.CI,
  },
});
