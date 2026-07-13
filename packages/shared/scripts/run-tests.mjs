#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const vitestBin = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';

const pgliteChunks = [
  [
    'src/agent/ask.test.ts',
    'src/agent/evals.test.ts',
    'src/artifacts/index.test.ts',
    'src/boards/index.test.ts',
    'src/calendar/raw-events.test.ts',
    'src/calendar/scope.test.ts',
    'src/documents/scope.test.ts',
    'src/email/dispatcher.test.ts',
    'src/embedding/sources.test.ts',
    'src/extract/resolve.test.ts',
    'src/ingest-webhooks/keys.test.ts',
  ],
  [
    'src/integrations/event-writer.test.ts',
    'src/integrations/provider-budget.test.ts',
    'src/integrations/webhooks.test.ts',
    'src/job-recovery/index.test.ts',
    'src/mcp-server/handler.test.ts',
    'src/meetings/quick-capture.test.ts',
    'src/meetings/scope.test.ts',
    'src/onboarding/index.test.ts',
  ],
  ['src/objects/index.test.ts'],
  ['src/task-categories/state.test.ts', 'src/task-categories/evals.test.ts'],
  ['src/suggestions/index.test.ts'],
  [
    'src/reconciliation/backfill.test.ts',
    'src/reconciliation/dashboard.test.ts',
    'src/reconciliation/normalization.test.ts',
    'src/reconciliation/production-sampling.test.ts',
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
  ...pgliteChunks.flat().flatMap((file) => pgliteCommandsForFile(file)),
];

function pgliteCommandsForFile(file) {
  if (file !== 'src/suggestions/index.test.ts') {
    return [
      {
        label: `pglite:${file}`,
        args: ['run', file, '--project', 'pglite', '--maxWorkers=1', '--no-file-parallelism'],
      },
    ];
  }

  return chunks(testNamesForFile(file), 20).map((names, index) => ({
    label: `pglite:${file}:${index + 1}`,
    args: [
      'run',
      file,
      '--project',
      'pglite',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--testNamePattern',
      names.map(escapeRegExp).join('|'),
    ],
  }));
}

function testNamesForFile(file) {
  const source = readFileSync(file, 'utf8');
  const names = [...source.matchAll(/\bit\('((?:\\'|[^'])+)'/g)].map((match) =>
    match[1].replaceAll("\\'", "'"),
  );
  if (names.length === 0) throw new Error(`No test names found in ${file}`);
  return names;
}

function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
