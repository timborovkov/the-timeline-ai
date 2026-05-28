import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

let currentChild;
let receivedSignal;

for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => {
    receivedSignal = signal;
    if (currentChild && !currentChild.killed) {
      currentChild.kill(signal);
      return;
    }
    process.exit(SIGNAL_EXIT_CODES[signal]);
  });
}

async function run(command, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    currentChild = child;
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (currentChild === child) currentChild = undefined;
      if (signal) {
        resolvePromise({ code: SIGNAL_EXIT_CODES[signal] ?? 1, signal });
        return;
      }
      if (code === 0) {
        resolvePromise({ code, signal: undefined });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

function firstExisting(paths) {
  const match = paths.find((path) => existsSync(path));
  if (!match) throw new Error(`none of these paths exist: ${paths.join(', ')}`);
  return match;
}

const migratePath = firstExisting([
  resolve(appRoot, '../../packages/db/dist/migrate.js'),
  resolve(appRoot, 'packages/db/dist/migrate.js'),
]);
const serverPath = firstExisting([
  resolve(appRoot, 'server.js'),
  resolve(appRoot, '.next/standalone/apps/web/server.js'),
]);

const migrationResult = await run(process.execPath, [migratePath]);
if (migrationResult.code !== 0 || receivedSignal) {
  process.exit(receivedSignal ? SIGNAL_EXIT_CODES[receivedSignal] : migrationResult.code);
}
const result = await run(process.execPath, [serverPath]);
process.exit(receivedSignal ? SIGNAL_EXIT_CODES[receivedSignal] : result.code);
