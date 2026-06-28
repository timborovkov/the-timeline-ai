import { defineConfig } from 'vitest/config';

import { filterExpectedTestConsole } from '../../scripts/vitest-console';

const env = {
  LOG_LEVEL: 'silent',
  // Many helpers (env-guarded webhook verifiers, OAuth state signing)
  // resolve the env schema lazily. Provide the required fields so test
  // imports don't fail with `AUTH_SECRET required`.
  AUTH_SECRET: 'test-auth-secret-must-be-at-least-16-chars',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
};

const pgliteTests = [
  'src/agent/ask.test.ts',
  'src/agent/evals.test.ts',
  'src/calendar/raw-events.test.ts',
  'src/calendar/scope.test.ts',
  'src/documents/scope.test.ts',
  'src/email/dispatcher.test.ts',
  'src/embedding/sources.test.ts',
  'src/integrations/event-writer.test.ts',
  'src/integrations/provider-budget.test.ts',
  'src/integrations/webhooks.test.ts',
  'src/job-recovery/index.test.ts',
  'src/mcp-server/handler.test.ts',
  'src/meetings/quick-capture.test.ts',
  'src/meetings/scope.test.ts',
  'src/onboarding/index.test.ts',
  'src/objects/index.test.ts',
  'src/slack/dispatcher.test.ts',
  'src/suggestions/index.test.ts',
  'src/team-exports/index.test.ts',
  'src/team-scope.search.test.ts',
  'src/team-scope.test.ts',
  'src/team-scope.search.test.ts',
  'src/telegram/dispatcher.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: pgliteTests,
          environment: 'node',
          env,
          onConsoleLog: filterExpectedTestConsole,
        },
      },
      {
        test: {
          name: 'pglite',
          include: pgliteTests,
          environment: 'node',
          fileParallelism: false,
          hookTimeout: 240_000,
          env,
          onConsoleLog: filterExpectedTestConsole,
        },
      },
    ],
    onConsoleLog: filterExpectedTestConsole,
  },
});
