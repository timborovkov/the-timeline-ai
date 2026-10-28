import { Queue, Worker } from 'bullmq';
import { chunkText } from '@timeline/shared/chunk';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const connection = { host: '127.0.0.1', port: 6379, db: 15, maxRetriesPerRequest: null };
const name = 'runtime-bench-' + randomUUID();
const queue = new Queue(name, { connection });
const paragraph =
  'Synthetic release planning document. The team reviews the launch checklist, records decisions, assigns owners, and verifies completed work before deployment.\n\n';
const document = paragraph.repeat(200);
let completed = 0,
  target = 0,
  resolveBatch,
  rejectBatch,
  durations = [],
  measured = false,
  checksum = 0;
const worker = new Worker(
  name,
  async (job) => {
    const start = performance.now();
    const chunks = chunkText(document + String(job.data.index));
    const output = chunks.map((c) => ({
      index: c.index,
      tokens: c.tokenCount,
      hash: createHash('sha256').update(c.text).digest('hex'),
    }));
    const encoded = JSON.stringify(output);
    checksum += encoded.length;
    if (measured) durations.push(performance.now() - start);
    return output.length;
  },
  { connection, concurrency: 4 },
);
worker.on('completed', () => {
  completed++;
  if (completed === target) resolveBatch?.();
});
worker.on('failed', (_, e) => rejectBatch?.(e));
worker.on('error', (e) => rejectBatch?.(e));
async function batch(count) {
  completed = 0;
  target = count;
  const done = new Promise((resolve, reject) => {
    resolveBatch = resolve;
    rejectBatch = reject;
  });
  for (let i = 0; i < count; i += 500)
    await queue.addBulk(
      Array.from({ length: Math.min(500, count - i) }, (_, j) => ({
        name: 'chunk-document',
        data: { index: i + j },
        opts: { removeOnComplete: true, removeOnFail: true },
      })),
    );
  await done;
}
try {
  await worker.waitUntilReady();
  await batch(1000);
  measured = true;
  checksum = 0;
  const rssStart = process.memoryUsage().rss,
    cpuStart = process.cpuUsage(),
    start = performance.now();
  await batch(20000);
  const elapsedMs = performance.now() - start,
    cpu = process.cpuUsage(cpuStart);
  durations.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      runtime: process.versions.bun ? 'bun' : 'node',
      version: process.versions.bun ?? process.version,
      jobs: 20000,
      concurrency: 4,
      documentBytes: Buffer.byteLength(document),
      elapsedMs,
      jobsPerSecond: 20000 / (elapsedMs / 1000),
      processorP50Ms: durations[Math.floor(durations.length * 0.5)],
      processorP95Ms: durations[Math.floor(durations.length * 0.95)],
      cpuMs: (cpu.user + cpu.system) / 1000,
      rssAfterWarmupMiB: rssStart / 1048576,
      rssEndMiB: process.memoryUsage().rss / 1048576,
      peakRssMiB: process.resourceUsage().maxRSS / 1024,
      checksum,
    }),
  );
} finally {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
}
