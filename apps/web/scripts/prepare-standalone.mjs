import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '../..');
const standaloneAppRoot = resolve(appRoot, '.next/standalone/apps/web');

function copyRequiredDirectory(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`required standalone asset source does not exist: ${source}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true, recursive: true });
  cpSync(source, destination, { recursive: true });
}

copyRequiredDirectory(resolve(appRoot, '.next/static'), resolve(standaloneAppRoot, '.next/static'));
copyRequiredDirectory(resolve(appRoot, 'public'), resolve(standaloneAppRoot, 'public'));
copyRequiredDirectory(
  resolve(workspaceRoot, 'packages/shared/dist/messaging/email-templates'),
  resolve(standaloneAppRoot, 'packages/shared/dist/messaging/email-templates'),
);
