import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const [path, countText, concurrencyText] = process.argv.slice(2);
const count = Number(countText),
  concurrency = Number(concurrencyText);
const cookies = JSON.parse(readFileSync(process.env.BENCH_AUTH_STATE, 'utf8'))
  .cookies.map((c) => `${c.name}=${c.value}`)
  .join('; ');
let next = 0,
  bytes = 0;
const times = [];
const start = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next++ < count) {
      const begin = performance.now();
      const response = await fetch((process.env.BENCH_BASE_URL ?? 'http://127.0.0.1:3102') + path, {
        headers: { cookie: cookies },
        redirect: 'manual',
      });
      const body = await response.text();
      if (response.status !== 200)
        throw Error(
          `${path}: HTTP ${response.status}, redirect=${response.headers.get('location')}`,
        );
      if (path.startsWith('/app/') && !body.includes('Timeline'))
        throw Error('Missing application content');
      bytes += Buffer.byteLength(body);
      times.push(performance.now() - begin);
    }
  }),
);
const elapsedMs = performance.now() - start;
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    path,
    count,
    concurrency,
    elapsedMs,
    requestsPerSecond: count / (elapsedMs / 1000),
    p50Ms: times[Math.floor(count * 0.5)],
    p95Ms: times[Math.floor(count * 0.95)],
    p99Ms: times[Math.floor(count * 0.99)],
    bytes,
  }),
);
