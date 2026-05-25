import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
      // Bypass the OPENROUTER_API_KEY env gate in handlers that call
      // `requireEnv()` with the default IO. Tests inject their own IO
      // so the real env is never read, but the gate runs first.
      OPENROUTER_API_KEY: 'test-key',
      DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
      AUTH_SECRET: 'test-secret-at-least-sixteen-characters',
    },
  },
});
