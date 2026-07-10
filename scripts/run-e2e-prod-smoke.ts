import { spawn } from 'node:child_process';

import { buildE2eEnv } from './e2e-env.js';

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

const env = buildE2eEnv();

await run('pnpm', ['--filter', '@timeline/web', 'build'], env);

await run('pnpm', ['exec', 'tsx', 'scripts/run-e2e-strict.ts', 'e2e/prod-smoke.spec.ts'], {
  ...env,
  E2E_PROD_SMOKE: '1',
  E2E_WEB_SERVER_COMMAND: 'pnpm --filter @timeline/web start',
});
