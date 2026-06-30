#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const vitestBin = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';

const pgliteChunks = [
  [
    'src/agent/ask.test.ts',
    'src/agent/evals.test.ts',
    'src/calendar/scope.test.ts',
    'src/documents/scope.test.ts',
    'src/email/dispatcher.test.ts',
    'src/embedding/sources.test.ts',
  ],
  [
    'src/integrations/event-writer.test.ts',
    'src/job-recovery/index.test.ts',
    'src/mcp-server/handler.test.ts',
    'src/meetings/quick-capture.test.ts',
    'src/meetings/scope.test.ts',
    'src/onboarding/index.test.ts',
  ],
  ['src/objects/index.test.ts'],
  ['src/suggestions/index.test.ts'],
  [
    'src/reconciliation/backfill.test.ts',
    'src/reconciliation/normalization.test.ts',
    'src/reconciliation/resolver.test.ts',
    'src/slack/dispatcher.test.ts',
  ],
  [
    'src/suggestions/reconciliation-projection.test.ts',
    'src/team-exports/index.test.ts',
    'src/team-scope.search.test.ts',
    'src/team-scope.test.ts',
    'src/telegram/dispatcher.test.ts',
  ],
];

const commands = [
  { label: 'unit', args: ['run', '--project', 'unit'] },
  ...pgliteChunks.map((files, index) => ({
    label: `pglite:${index + 1}`,
    args: ['run', ...files, '--project', 'pglite', '--maxWorkers=1', '--no-file-parallelism'],
  })),
];

for (const command of commands) {
  console.log(`\n[shared-tests] ${command.label}`);
  const result = spawnSync(vitestBin, command.args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[shared-tests] ${command.label} failed to start`);
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
