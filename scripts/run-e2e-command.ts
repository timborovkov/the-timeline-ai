import { spawn } from 'node:child_process';

import { buildE2eEnv } from './e2e-env.js';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: tsx scripts/run-e2e-command.ts <command> [...args]');
  process.exit(1);
}

const child = spawn(command, args, {
  env: buildE2eEnv(),
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
