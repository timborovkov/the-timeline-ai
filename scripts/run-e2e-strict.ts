import { spawn } from 'node:child_process';

import { assertE2eDiskCapacity, buildE2eEnv, buildE2eWebServerConfig } from './e2e-env.js';

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

async function runChecked(
  label: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<number> {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  const matches = scanOutput(output);
  if (matches.length) {
    console.error(`Strict E2E log check failed during ${label}: ${matches.join(', ')}`);
    return 1;
  }
  return code ?? 1;
}

assertE2eDiskCapacity();

const args = process.argv.slice(2);
const precompiled = args[0] === '--precompile-fixtures';
const env = buildE2eEnv(precompiled ? { ...process.env, E2E_PRECOMPILED: '1' } : process.env);
if (precompiled) {
  const { baseURL } = buildE2eWebServerConfig(env);
  env.AUTH_URL = baseURL;
  env.NEXTAUTH_URL = baseURL;
  const buildStatus = await runChecked(
    'fixture compilation',
    ['x', '--bun', '--no-install', 'next', 'build', '--webpack'],
    env,
    'apps/web',
  );
  if (buildStatus !== 0) process.exit(buildStatus);
}

process.exit(
  await runChecked(
    'Playwright',
    ['x', '--bun', '--no-install', 'playwright', 'test', ...(precompiled ? args.slice(1) : args)],
    env,
  ),
);
