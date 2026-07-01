#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const vitestBin = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';

const integrationTests = [
  'src/workers/documentExtract.test.ts',
  'src/workers/embed.test.ts',
  'src/workers/extract.test.ts',
  'src/workers/janitor.test.ts',
  'src/workers/meetingFinalize.test.ts',
  'src/workers/meetingScheduler.test.ts',
  'src/workers/overdue.test.ts',
  'src/workers/reconciliation.test.ts',
  'src/workers/suggestions.test.ts',
];

const commands = [
  { label: 'unit', args: ['run', '--project', 'unit'] },
  ...integrationTests.map((file) => ({
    label: `integration:${file}`,
    args: ['run', file, '--project', 'integration', '--maxWorkers=1', '--no-file-parallelism'],
  })),
];

for (const command of commands) {
  console.log(`\n[worker-tests] ${command.label}`);
  const result = spawnSync(vitestBin, command.args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[worker-tests] ${command.label} failed to start`);
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
