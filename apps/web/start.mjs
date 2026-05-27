import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
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

await run(process.execPath, [migratePath]);
await run(process.execPath, [serverPath]);
