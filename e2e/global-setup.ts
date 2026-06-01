import { closeDb } from '@timeline/db';

import { setupE2eData } from './setup.js';

export default async function globalSetup(): Promise<void> {
  await setupE2eData();
  await closeDb();
}
