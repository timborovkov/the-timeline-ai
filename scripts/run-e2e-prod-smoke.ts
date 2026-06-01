import { spawn } from 'node:child_process';

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

const env = { ...process.env };
delete env.NO_COLOR;
env.DATABASE_URL ??= 'postgres://timeline:timeline_dev@localhost:5432/timeline';
env.AUTH_SECRET ??= 'e2e-auth-secret-at-least-sixteen-characters';
env.NODE_OPTIONS = [env.NODE_OPTIONS, '--conditions=development'].filter(Boolean).join(' ');

await run('pnpm', ['--filter', '@timeline/web', 'build'], env);

await run('pnpm', ['exec', 'tsx', 'scripts/run-e2e-strict.ts', 'e2e/prod-smoke.spec.ts'], {
  ...env,
  E2E_PROD_SMOKE: '1',
  E2E_WEB_SERVER_COMMAND: 'pnpm --filter @timeline/web start',
});
