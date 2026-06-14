import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

cpSync(join(root, 'src/messaging/email-templates'), join(root, 'dist/messaging/email-templates'), {
  recursive: true,
});
