import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertE2eDiskCapacity,
  buildE2eEnv,
  buildE2eWebServerConfig,
  MIN_E2E_FREE_DISK_BYTES,
} from './e2e-env.js';

const dockerPorts = new Map<string, string>([
  ['timeline-e2e-postgres-1:5432', '55432'],
  ['timeline-e2e-redis-1:6379', '56379'],
  ['timeline-e2e-rustfs-1:9000', '59000'],
  ['timeline-e2e-qdrant-1:6333', '56333'],
]);

function lookupPort(container: string, port: number): string | null {
  return dockerPorts.get(`${container}:${port}`) ?? null;
}

{
  const env = buildE2eEnv(
    { NODE_OPTIONS: '--trace-warnings', NO_COLOR: '1' },
    { publishedPort: lookupPort },
  );

  assert.deepEqual(
    pick(env, [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_PUBLIC_ENDPOINT',
      'QDRANT_URL',
      'QDRANT_API_KEY',
      'AUTH_SECRET',
      'OPENROUTER_API_KEY',
      'E2E_DETERMINISTIC_EMBEDDINGS',
      'TASK_CATEGORY_CLASSIFICATION_ENABLED',
      'TASK_CATEGORY_AUTO_ENQUEUE_ENABLED',
      'TASK_CATEGORY_WORKER_ENABLED',
      'TASK_CATEGORY_UI_ENABLED',
      'CROSS_SOURCE_EVIDENCE_MODE',
    ]),
    {
      DATABASE_URL: 'postgres://timeline:timeline_dev@localhost:55432/timeline',
      REDIS_URL: 'redis://localhost:56379',
      S3_ENDPOINT: 'http://localhost:59000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:59000',
      QDRANT_URL: 'http://localhost:56333',
      QDRANT_API_KEY: 'dev_qdrant_key',
      AUTH_SECRET: 'e2e-auth-secret-at-least-sixteen-characters',
      OPENROUTER_API_KEY: 'e2e-deterministic-chat',
      E2E_DETERMINISTIC_EMBEDDINGS: 'true',
      TASK_CATEGORY_CLASSIFICATION_ENABLED: 'true',
      TASK_CATEGORY_AUTO_ENQUEUE_ENABLED: 'true',
      TASK_CATEGORY_WORKER_ENABLED: 'true',
      TASK_CATEGORY_UI_ENABLED: 'true',
      CROSS_SOURCE_EVIDENCE_MODE: 'off',
    },
  );
  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.NODE_OPTIONS, '--trace-warnings --conditions=development');
}

{
  const env = buildE2eEnv(
    buildE2eEnv(
      { NODE_OPTIONS: '--conditions=development --trace-warnings' },
      { publishedPort: lookupPort },
    ),
    { publishedPort: lookupPort },
  );

  assert.equal(env.NODE_OPTIONS, '--conditions=development --trace-warnings');
}

{
  const env = buildE2eEnv(
    {
      DATABASE_URL: 'postgres://custom@localhost:15432/custom',
      REDIS_URL: 'redis://localhost:16379',
      S3_ENDPOINT: 'http://localhost:19000',
      S3_PUBLIC_ENDPOINT: 'http://public.example.test',
      QDRANT_URL: 'http://localhost:16333',
    },
    { publishedPort: lookupPort },
  );

  assert.deepEqual(
    pick(env, [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_PUBLIC_ENDPOINT',
      'QDRANT_URL',
      'QDRANT_API_KEY',
    ]),
    {
      DATABASE_URL: 'postgres://custom@localhost:15432/custom',
      REDIS_URL: 'redis://localhost:16379',
      S3_ENDPOINT: 'http://localhost:19000',
      S3_PUBLIC_ENDPOINT: 'http://public.example.test',
      QDRANT_URL: 'http://localhost:16333',
      QDRANT_API_KEY: 'dev_qdrant_key',
    },
  );
}

{
  const env = buildE2eEnv(
    { E2E_USE_DOCKER_PORTS: '0' },
    {
      publishedPort: () => {
        throw new Error('Docker lookup should not run when disabled.');
      },
    },
  );

  assert.deepEqual(
    pick(env, [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_PUBLIC_ENDPOINT',
      'QDRANT_URL',
      'QDRANT_API_KEY',
    ]),
    {
      DATABASE_URL: 'postgres://timeline:timeline_dev@localhost:5432/timeline',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      QDRANT_URL: 'http://qdrant.e2e.invalid',
      QDRANT_API_KEY: 'dev_qdrant_key',
    },
  );
}

{
  const dir = mkdtempSync(path.join(tmpdir(), 'timeline-e2e-env-'));
  const originalPath = process.env.PATH;
  try {
    const dockerPath = path.join(dir, 'docker');
    writeFileSync(dockerPath, '#!/bin/sh\nsleep 2\n', { mode: 0o755 });
    process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ''}`;

    const started = Date.now();
    const env = buildE2eEnv({}, { dockerInspectTimeoutMs: 25 });

    assert(Date.now() - started < 1_000, 'slow docker inspect should time out quickly');
    assert.equal(env.DATABASE_URL, 'postgres://timeline:timeline_dev@localhost:5432/timeline');
    assert.equal(env.REDIS_URL, 'redis://localhost:6379');
    assert.equal(env.S3_ENDPOINT, 'http://localhost:9000');
    assert.equal(env.QDRANT_URL, 'http://qdrant.e2e.invalid');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const first = buildE2eEnv({}, { publishedPort: lookupPort, workspacePath: '/workspace/one' });
  const repeat = buildE2eEnv({}, { publishedPort: lookupPort, workspacePath: '/workspace/one' });
  const second = buildE2eEnv({}, { publishedPort: lookupPort, workspacePath: '/workspace/two' });

  assert.equal(first.E2E_RUN_ID, undefined);
  assert.match(first.E2E_NAMESPACE ?? '', /^worktree-[a-f0-9]{12}$/);
  assert.equal(first.E2E_NAMESPACE, repeat.E2E_NAMESPACE);
  assert.notEqual(first.E2E_NAMESPACE, second.E2E_NAMESPACE);
  assert.equal(first.E2E_WEB_PORT, repeat.E2E_WEB_PORT);
  assert.notEqual(first.E2E_WEB_PORT, second.E2E_WEB_PORT);

  const firstServer = buildE2eWebServerConfig(first);
  const secondServer = buildE2eWebServerConfig(second);
  assert.notEqual(firstServer.baseURL, secondServer.baseURL);
  assert.notEqual(firstServer.command, secondServer.command);
  assert.match(firstServer.command, new RegExp(` -p ${first.E2E_WEB_PORT}$`));
}

{
  const compose = readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8');
  assert.match(compose, /<AllowedOrigin>http:\/\/localhost:\*<\/AllowedOrigin>/);
  assert.match(compose, /<AllowedOrigin>http:\/\/127\.0\.0\.1:\*<\/AllowedOrigin>/);
}

{
  const env = buildE2eEnv(
    { E2E_RUN_ID: 'explicit-run', E2E_WEB_PORT: '43123' },
    { publishedPort: lookupPort, workspacePath: '/workspace/ignored' },
  );

  assert.equal(env.E2E_RUN_ID, 'explicit-run');
  assert.equal(env.E2E_NAMESPACE, 'explicit-run');
  assert.equal(env.E2E_WEB_PORT, '43123');
  assert.deepEqual(buildE2eWebServerConfig(env), {
    baseURL: 'http://localhost:43123',
    command: 'pnpm --filter @timeline/web exec next dev -H 127.0.0.1 -p 43123',
  });
}

{
  assert.throws(
    () => buildE2eWebServerConfig({ E2E_WEB_PORT: '3000; rm -rf /' }),
    /Invalid E2E_WEB_PORT/,
  );
}

{
  assert.doesNotThrow(() =>
    assertE2eDiskCapacity('/workspace', () => ({
      bavail: 2,
      bsize: MIN_E2E_FREE_DISK_BYTES,
    })),
  );
  assert.throws(
    () =>
      assertE2eDiskCapacity('/workspace', () => ({
        bavail: 512,
        bsize: 1024 * 1024,
      })),
    /Strict E2E requires at least 4 GiB of free disk space at \/workspace; only 0\.50 GiB is available\./,
  );
}

console.log('e2e-env tests passed');

function pick<T extends Record<string, unknown>, K extends keyof T>(
  input: T,
  keys: K[],
): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, input[key]])) as Pick<T, K>;
}
