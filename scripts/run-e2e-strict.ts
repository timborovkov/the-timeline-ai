import { spawn } from 'node:child_process';

import { buildE2eEnv } from './e2e-env.js';

const forbiddenPatterns = [
  { name: 'missing module', pattern: /MODULE_NOT_FOUND/ },
  { name: 'uncaught exception', pattern: /uncaughtException/i },
  { name: 'critical dependency warning', pattern: /Critical dependency/i },
  { name: 'worker thread exit', pattern: /worker thread exited/i },
  { name: 'NO_COLOR warning', pattern: /Warning: The 'NO_COLOR' env is ignored/ },
  {
    name: 'React hydration failure',
    pattern:
      /Hydration failed|A tree hydrated but some attributes|There was an error while hydrating|Text content does not match server-rendered HTML|Minified React error #418/i,
  },
  {
    name: 'React runtime overlay',
    pattern:
      /Unhandled Runtime Error|Unhandled RuntimeException|React has detected a change in the order of Hooks/i,
  },
];

function scanOutput(output: string): string[] {
  return forbiddenPatterns.filter(({ pattern }) => pattern.test(output)).map(({ name }) => name);
}

const fixture = process.env.E2E_STRICT_LOG_FIXTURE;
if (fixture !== undefined) {
  const matches = scanOutput(fixture);
  if (matches.length) {
    console.error(`Strict E2E log check failed: ${matches.join(', ')}`);
    process.exit(1);
  }
  console.log('Strict E2E log fixture passed');
  process.exit(0);
}

const env = buildE2eEnv();

const args = ['exec', 'playwright', 'test', ...process.argv.slice(2)];
const child = spawn('pnpm', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
child.stdout.on('data', (chunk: Buffer) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
});
child.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString();
  output += text;
  process.stderr.write(text);
});

child.on('close', (code) => {
  const matches = scanOutput(output);
  if (matches.length) {
    console.error(`Strict E2E log check failed: ${matches.join(', ')}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
