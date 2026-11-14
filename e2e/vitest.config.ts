import { defineConfig } from 'vitest/config';

// Browser tests: Vitest runs them, Playwright drives Chromium. They spend real chipnet coins
// from the merchant key in ../.env, so everything runs in one worker, one test at a time.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    globalSetup: ['tests/servers.ts'],
    testTimeout: 240_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
