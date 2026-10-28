import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Queue, QueueEvents, Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import ffmpeg from 'ffmpeg-static';

// This check never contacts providers and only accepts a local disposable Redis.
const redisUrl = new URL(process.env.RUNTIME_SMOKE_REDIS_URL ?? 'redis://127.0.0.1:6379');
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname),
  'Runtime smoke Redis must be local',
);
assert.equal(redisUrl.protocol, 'redis:');
assert.equal(redisUrl.username, '');
assert.equal(redisUrl.password, '');
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null,
};
const name = `bun-runtime-${crypto.randomUUID()}`;
const queue = new Queue(name, { connection });
const events = new QueueEvents(name, { connection });
let attempts = 0;
let markActive!: () => void;
let releaseActive!: () => void;
const active = new Promise<void>((resolve) => {
  markActive = resolve;
});
const release = new Promise<void>((resolve) => {
  releaseActive = resolve;
});
const worker = new Worker(
  name,
  async (job) => {
    if (job.name === 'shutdown') {
      markActive();
      await release;
      return 'drained';
    }
    attempts++;
    if (attempts === 1) throw new Error('intentional retry');
    return 'complete';
  },
  { connection },
);
const errors: Error[] = [];
worker.on('error', (error) => errors.push(error));
try {
  await events.waitUntilReady();
  await worker.waitUntilReady();
  const job = await queue.add('retry', {}, { attempts: 2, backoff: { type: 'fixed', delay: 25 } });
  assert.equal(await job.waitUntilFinished(events, 15_000), 'complete');
  assert.equal(attempts, 2);
  const client = await worker.getBackend().client;
  const ready = once(client, 'ready');
  client.disconnect(true);
  await Promise.race([
    ready,
    Bun.sleep(10_000).then(() => {
      throw new Error('Redis reconnect timed out');
    }),
  ]);
  const next = await queue.add('after-reconnect', {});
  assert.equal(await next.waitUntilFinished(events, 15_000), 'complete');
  const drainingJob = await queue.add('shutdown', {});
  await Promise.race([
    active,
    Bun.sleep(10_000).then(() => {
      throw new Error('Shutdown fixture job did not start');
    }),
  ]);
  let closeFinished = false;
  const closing = worker.close().then(() => {
    closeFinished = true;
  });
  await Bun.sleep(50);
  assert.equal(closeFinished, false, 'Graceful shutdown must wait for the active job');
  releaseActive();
  await closing;
  assert.equal(await drainingJob.waitUntilFinished(events, 15_000), 'drained');
  assert(worker.isRunning() === false);
  assert.equal(errors.length, 0);
  console.log('BullMQ retry, reconnect, and graceful close passed');
} finally {
  releaseActive();
  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
}

assert(ffmpeg, 'ffmpeg-static must provide a binary');
const media = spawnSync(
  ffmpeg,
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.1',
    '-f',
    'null',
    '-',
  ],
  { encoding: 'utf8', timeout: 10_000 },
);
assert.equal(media.status, 0, media.stderr);
console.log('FFmpeg subprocess passed');

let streamClosed!: () => void;
const closed = new Promise<void>((resolve) => {
  streamClosed = resolve;
});
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write('data: first\n\n');
  response.once('close', streamClosed);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let streamDeadline: ReturnType<typeof setTimeout> | undefined;
try {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}`, {
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  controller.abort();
  await assert.rejects(reader.read(), { name: 'AbortError' });
  reader.releaseLock();
  await Promise.race([
    closed,
    new Promise<never>((_resolve, reject) => {
      streamDeadline = setTimeout(() => reject(new Error('Stream did not close')), 5_000);
    }),
  ]);
  console.log('HTTP streaming cancellation and connection cleanup passed');
} finally {
  clearTimeout(streamDeadline);
  server.closeAllConnections();
  server.close();
}

let envelopes = 0;
Sentry.init({
  dsn: 'https://public@example.invalid/1',
  transport: () => ({
    send: async () => {
      envelopes++;
      return { statusCode: 200 };
    },
    flush: async () => true,
  }),
});
Sentry.captureException(new Error('synthetic Bun runtime smoke'));
assert.equal(await Sentry.flush(5_000), true);
assert.equal(envelopes, 1);
await Sentry.close(5_000);
console.log('Sentry reporting and flush passed (in-memory transport)');

const fixture = mkdtempSync(join(tmpdir(), 'bun-startup-'));
try {
  const app = join(fixture, 'apps/web');
  const db = join(fixture, 'packages/db/dist');
  mkdirSync(app, { recursive: true });
  mkdirSync(db, { recursive: true });
  copyFileSync(new URL('../../web/start.mjs', import.meta.url), join(app, 'start.mjs'));
  writeFileSync(join(db, 'migrate.js'), 'process.exit(7);');
  writeFileSync(join(app, 'server.js'), 'throw new Error("server must not start");');
  const failed = spawnSync(process.execPath, ['--no-env-file', join(app, 'start.mjs')], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(failed.status, 7, failed.stderr);
  assert(!failed.stderr.includes('server must not start'));
  writeFileSync(join(db, 'migrate.js'), 'console.log("migration-complete");');
  writeFileSync(join(app, 'server.js'), 'process.exit(9);');
  const serverFailed = spawnSync(process.execPath, ['--no-env-file', join(app, 'start.mjs')], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(serverFailed.status, 9, serverFailed.stderr);
  writeFileSync(
    join(app, 'server.js'),
    'process.on("SIGTERM", () => { console.log("signal-received"); process.exit(0); }); console.log("server-ready"); setInterval(() => {}, 1000);',
  );
  const child = spawn(process.execPath, ['--no-env-file', join(app, 'start.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
    if (output.includes('server-ready')) child.kill('SIGTERM');
  });
  const [code] = await exited;
  clearTimeout(deadline);
  assert.equal(code, 143);
  assert(output.indexOf('migration-complete') < output.indexOf('server-ready'));
  assert(output.includes('signal-received'));
  console.log('Migration failure, startup ordering, and signal forwarding passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
