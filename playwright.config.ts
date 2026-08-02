import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.E2E_PORT || '4173';
const e2eDataDir = process.env.E2E_DATA_DIR || `./.local/e2e-data-${e2ePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${e2ePort}`, trace: 'retain-on-failure' },
  webServer: {
    command: "mkdir -p .local && flock -n .local/e2e.lock -c 'npm run prepare:e2e && npm run build && node dist-server/server/index.js'",
    url: `http://127.0.0.1:${e2ePort}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: e2ePort,
      NODE_ENV: 'test',
      DATA_DIR: e2eDataDir,
      ADMIN_PASSWORD_HASH: '$2b$04$p0ebYL5Qf.wGWel0.6WHO./g3KFgN/zTwaspLDvDD9.zlcPE7sqgm',
      ADMIN_SESSION_SECRET: 'e2e-only-session-secret-at-least-32-bytes',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
});
