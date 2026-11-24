import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { expect } from '@timeline/test-support';
import { it } from 'bun:test';

import { copyBunSentryRuntime } from './standalone-runtime.ts';

it('loads the Bun Sentry runtime from an isolated artifact without repository dependencies', async () => {
  const artifact = mkdtempSync(resolve(tmpdir(), 'timeline-sentry-runtime-'));
  try {
    const workspaceRoot = resolve(import.meta.dir, '../../..');
    await copyBunSentryRuntime(workspaceRoot, artifact);
    expect(
      readFileSync(resolve(artifact, 'node_modules/@sentry/nextjs/package.json'), 'utf8'),
    ).toContain('"name": "@sentry/nextjs"');
    const probe = resolve(artifact, 'probe.cjs');
    writeFileSync(
      probe,
      `const sdk = require('@sentry/nextjs');
       if (!require.resolve('@sentry/nextjs').endsWith('/index.bun.js')) throw Error('Wrong runtime');
       if (typeof sdk.wrapRouteHandlerWithSentry !== 'function') throw Error('Missing route instrumentation');
       if (typeof sdk.init !== 'function') throw Error('Missing initialization');
       process.stdout.write('bun-sentry-loaded');`,
    );
    const result = Bun.spawnSync([process.execPath, '--no-env-file', probe], {
      cwd: artifact,
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toBe('bun-sentry-loaded');
  } finally {
    rmSync(artifact, { recursive: true, force: true });
  }
}, 120_000);
