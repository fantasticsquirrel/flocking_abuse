import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', 'dist-server/**'],
    coverage: { reporter: ['text', 'html'] },
  },
});
