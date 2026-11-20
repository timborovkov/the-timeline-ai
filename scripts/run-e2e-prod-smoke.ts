import { spawn } from 'node:child_process';

import { buildE2eEnv, buildE2eWebServerConfig } from './e2e-env.js';

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'unknown status'}`));
    });
  });
}

// Production smoke must resolve the same compiled workspace exports as images.
const fixtureEnv = buildE2eEnv({ ...process.env, E2E_PROD_SMOKE: '1' });
const { baseURL } = buildE2eWebServerConfig(fixtureEnv);
const env = { ...fixtureEnv, AUTH_URL: baseURL, NEXTAUTH_URL: baseURL, NODE_OPTIONS: '' };

await run(
  process.execPath,
  ['run', 'build', '--filter=@timeline/web', '--env-mode=loose', '--force'],
  env,
);

await run(process.execPath, ['run', 'scripts/run-e2e-strict.ts', 'e2e/prod-smoke.spec.ts'], {
  ...env,
  E2E_PROD_SMOKE: '1',
  E2E_WEB_SERVER_COMMAND: 'bun run --filter @timeline/web start',
});
