import { closeDb } from '@timeline/db';

import { cleanupE2eData } from './cleanup.js';

export default async function globalTeardown(): Promise<void> {
  await cleanupE2eData();
  await closeDb();
}
