import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '../..');
const standaloneRoot = resolve(appRoot, '.next/standalone');
const standaloneAppRoot = resolve(standaloneRoot, 'apps/web');
const sharedEmailTemplatesSource = resolve(
  workspaceRoot,
  'packages/shared/dist/messaging/email-templates',
);

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

for (const destination of [
  resolve(standaloneRoot, 'packages/shared/dist/messaging/email-templates'),
  resolve(standaloneAppRoot, 'packages/shared/dist/messaging/email-templates'),
]) {
  copyRequiredDirectory(sharedEmailTemplatesSource, destination);
}
