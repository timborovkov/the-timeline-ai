import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const bundleRoot = process.env.WEB_BUNDLE_HYGIENE_ROOT ?? 'apps/web/.next/server/app';

const pageOnlyPatterns = [
  { name: 'bullmq', pattern: /\bbullmq\b/ },
  { name: 'ioredis', pattern: /\bioredis\b/ },
];

const allBundlePatterns = [
  { name: 'thread-stream', pattern: /\bthread-stream\b/ },
  { name: 'pino-pretty', pattern: /\bpino-pretty\b/ },
  { name: 'Next worker vendor chunk', pattern: /vendor-chunks\/lib\/worker\.js/ },
  { name: 'dynamic dependency warning', pattern: /Critical dependency/i },
  { name: 'worker-thread runtime failure', pattern: /worker thread exited/i },
  { name: 'uncaught worker exception', pattern: /uncaughtException/i },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const file = join(dir, entry);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

function isPageBundle(file: string): boolean {
  return file.endsWith('/page.js') || file.endsWith('\\page.js');
}

function stripInertExternalStubs(text: string): string {
  return text
    .replace(/\d+:a=>\{"use strict";a\.exports=require\("bullmq"\)\},?/g, '')
    .replace(/\d+:a=>\{"use strict";a\.exports=require\("ioredis"\)\},?/g, '');
}

if (!existsSync(bundleRoot)) {
  console.error(
    `Built web bundle not found at ${bundleRoot}. Run pnpm --filter @timeline/web build first.`,
  );
  process.exit(1);
}

const failures: string[] = [];
for (const file of walk(bundleRoot).filter((candidate) => candidate.endsWith('.js'))) {
  const rel = relative(process.cwd(), file);
  const rawText = readFileSync(file, 'utf8');
  const text = isPageBundle(file) ? stripInertExternalStubs(rawText) : rawText;
  const patterns = isPageBundle(file)
    ? [...allBundlePatterns, ...pageOnlyPatterns]
    : allBundlePatterns;
  for (const { name, pattern } of patterns) {
    if (pattern.test(text)) {
      failures.push(`${rel}: contains ${name}`);
    }
  }
}

if (failures.length) {
  console.error('Web bundle hygiene check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Web bundle hygiene check passed for ${bundleRoot}`);
