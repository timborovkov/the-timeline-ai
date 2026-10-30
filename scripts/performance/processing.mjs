import { chunkText } from '@timeline/shared/chunk';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const document =
  'Synthetic release planning document. The team reviews the launch checklist, records decisions, assigns owners, and verifies completed work before deployment.\n\n'.repeat(
    200,
  );
const chunks = chunkText(document);
const payload = chunks.map((c) => ({
  index: c.index,
  tokens: c.tokenCount,
  hash: createHash('sha256').update(c.text).digest('hex'),
}));
let checksum = 0;
const cases = {
  chunk: () => {
    checksum += chunkText(document).length;
  },
  hash: () => {
    for (const c of chunks) checksum += createHash('sha256').update(c.text).digest('hex').length;
  },
  json: () => {
    checksum += JSON.stringify(payload).length;
  },
};
const result = {
  runtime: process.versions.bun ? 'bun' : 'node',
  iterations: 100000,
  documentBytes: Buffer.byteLength(document),
  measurements: {},
};
for (const [name, fn] of Object.entries(cases)) {
  for (let i = 0; i < 5000; i++) fn();
  const cpu = process.cpuUsage(),
    start = performance.now();
  for (let i = 0; i < 100000; i++) fn();
  const time = performance.now() - start,
    used = process.cpuUsage(cpu);
  result.measurements[name] = { elapsedMs: time, cpuMs: (used.user + used.system) / 1000 };
}
result.checksum = checksum;
console.log(JSON.stringify(result));
