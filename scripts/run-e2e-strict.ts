import { spawn } from 'node:child_process';

const forbiddenPatterns = [
  { name: 'missing module', pattern: /MODULE_NOT_FOUND/ },
  { name: 'uncaught exception', pattern: /uncaughtException/i },
  { name: 'critical dependency warning', pattern: /Critical dependency/i },
  { name: 'worker thread exit', pattern: /worker thread exited/i },
  { name: 'NO_COLOR warning', pattern: /Warning: The 'NO_COLOR' env is ignored/ },
  {
    name: 'React hydration failure',
    pattern:
      /Hydration failed|There was an error while hydrating|Text content does not match server-rendered HTML|Minified React error #418/i,
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

const env = { ...process.env };
delete env.NO_COLOR;
env.DATABASE_URL ??= 'postgres://timeline:timeline_dev@localhost:5432/timeline';
env.AUTH_SECRET ??= 'e2e-auth-secret-at-least-sixteen-characters';
env.REDIS_URL ??= 'redis://localhost:6379';
env.S3_ENDPOINT ??= 'http://localhost:9000';
env.S3_PUBLIC_ENDPOINT ??= 'http://localhost:9000';
env.S3_REGION ??= 'us-east-1';
env.S3_ACCESS_KEY_ID ??= 'timeline';
env.S3_SECRET_ACCESS_KEY ??= 'timeline_dev_secret';
env.S3_FORCE_PATH_STYLE ??= 'true';
env.S3_BUCKET_DOCUMENTS ??= 'timeline-documents';
env.E2E_DETERMINISTIC_CHAT ??= '1';
env.OPENROUTER_API_KEY ??= 'e2e-deterministic-chat';
env.QDRANT_URL ??= 'http://qdrant.e2e.invalid';
env.NODE_OPTIONS = [env.NODE_OPTIONS, '--conditions=development'].filter(Boolean).join(' ');

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
