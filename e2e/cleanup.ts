import { pathToFileURL } from 'node:url';

import { closeDb, getDbClient } from '@timeline/db';

import { e2eTeam, e2eUsers } from './test-data.js';

export async function cleanupE2eData(): Promise<void> {
  const sql = getDbClient();
  await sql`DELETE FROM teams WHERE id = ${e2eTeam.id}`;
  await sql`DELETE FROM users WHERE id IN (${e2eUsers.owner.id}, ${e2eUsers.member.id})`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cleanupE2eData();
  await closeDb();
}
