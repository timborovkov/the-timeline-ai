import { defineConfig } from 'vitest/config';

const env = {
  LOG_LEVEL: 'silent',
  // Bypass the OPENROUTER_API_KEY env gate in handlers that call
  // `requireEnv()` with the default IO. Tests inject their own IO
  // so the real env is never read, but the gate runs first.
  OPENROUTER_API_KEY: 'test-key',
  DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
  AUTH_SECRET: 'test-secret-at-least-sixteen-characters',
};

const integrationTests = [
  'src/workers/documentExtract.test.ts',
  'src/workers/embed.test.ts',
  'src/workers/extract.test.ts',
  'src/workers/janitor.test.ts',
  'src/workers/meetingFinalize.test.ts',
  'src/workers/overdue.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: integrationTests,
          environment: 'node',
          env,
        },
      },
      {
        test: {
          name: 'integration',
          include: integrationTests,
          environment: 'node',
          fileParallelism: false,
          testTimeout: 15_000,
          env,
        },
      },
    ],
  },
});
