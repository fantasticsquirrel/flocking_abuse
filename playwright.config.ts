import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run prepare:e2e && DATA_DIR=data npm run build && node dist-server/server/index.js',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: '4173',
      NODE_ENV: 'test',
      DATA_DIR: './.local/e2e-data',
      ADMIN_PASSWORD_HASH: '$2b$04$p0ebYL5Qf.wGWel0.6WHO./g3KFgN/zTwaspLDvDD9.zlcPE7sqgm',
      ADMIN_SESSION_SECRET: 'e2e-only-session-secret-at-least-32-bytes',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] }, testMatch: /homepage\.spec\.ts/ },
  ],
});
