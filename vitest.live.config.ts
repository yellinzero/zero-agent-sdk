import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/live/**/*.live.test.ts'],
    setupFiles: ['./src/__tests__/live/setup-env.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
