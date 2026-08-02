import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.E2E_PORT || '4173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${e2ePort}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run prepare:e2e && npm run build && node dist-server/server/index.js',
    url: `http://127.0.0.1:${e2ePort}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: e2ePort,
      NODE_ENV: 'test',
      DATA_DIR: './.local/e2e-data',
      ADMIN_PASSWORD_HASH: '$2b$04$p0ebYL5Qf.wGWel0.6WHO./g3KFgN/zTwaspLDvDD9.zlcPE7sqgm',
      ADMIN_SESSION_SECRET: 'e2e-only-session-secret-at-least-32-bytes',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
});
