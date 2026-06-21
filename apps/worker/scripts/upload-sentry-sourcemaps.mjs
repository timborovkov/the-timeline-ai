import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SentryCli } from '@sentry/cli/js/index.js';

const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.log(
    `[sentry] skipping worker source-map upload; missing ${missing.join(', ')} at build time`,
  );
  process.exit(0);
}

const root = resolve(import.meta.dirname, '../../..');
const distDirs = ['apps/worker/dist', 'packages/shared/dist', 'packages/db/dist']
  .map((path) => resolve(root, path))
  .filter((path) => existsSync(path));

if (distDirs.length === 0) {
  console.log('[sentry] skipping worker source-map upload; no dist directories found');
  process.exit(0);
}

const baseArgs = [
  '--org',
  process.env.SENTRY_ORG,
  '--project',
  process.env.SENTRY_PROJECT,
  '--auth-token',
  process.env.SENTRY_AUTH_TOKEN,
];

if (process.env.SENTRY_RELEASE) {
  baseArgs.push('--release', process.env.SENTRY_RELEASE);
}

runSentryCli(['sourcemaps', 'inject', ...baseArgs, ...distDirs]);
runSentryCli(['sourcemaps', 'upload', ...baseArgs, '--validate', '--strict', ...distDirs]);

function runSentryCli(args) {
  const result = spawnSync(SentryCli.getPath(), args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`[sentry] failed to run sentry-cli: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
