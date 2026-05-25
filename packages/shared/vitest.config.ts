import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
      // Many helpers (env-guarded webhook verifiers, OAuth state signing)
      // resolve the env schema lazily. Provide the required fields so test
      // imports don't fail with `AUTH_SECRET required`.
      AUTH_SECRET: 'test-auth-secret-must-be-at-least-16-chars',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    },
  },
});
