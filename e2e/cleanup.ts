import { pathToFileURL } from 'node:url';

import { closeDb, getDbClient } from '@timeline/db';

import { E2E_PREFIX, e2eOtherTeam, e2eTeam, e2eUsers } from './test-data.js';

export async function cleanupE2eData(): Promise<void> {
  const sql = getDbClient();
  await sql`
    DELETE FROM teams
    WHERE id IN (${e2eTeam.id}, ${e2eOtherTeam.id})
       OR slug LIKE ${`${E2E_PREFIX}%`}
  `;
  await sql`
    DELETE FROM users
    WHERE id IN (${e2eUsers.owner.id}, ${e2eUsers.admin.id}, ${e2eUsers.member.id}, ${e2eUsers.nonMember.id})
       OR email LIKE ${`${E2E_PREFIX}-%@example.test`}
  `;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cleanupE2eData();
  await closeDb();
}
