import { defineConfig, devices } from '@playwright/test';
import replay from '@replayio/replay';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['@replayio/replay', { upload: false }], // Set upload: true to upload to Replay Dashboard
  ],
  use: {
    baseURL: 'http://localhost:4173', // Preview server
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'replay-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Enable Replay instrumentation
          executablePath: process.env.RECORD_REPLAY_PATH || undefined,
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
