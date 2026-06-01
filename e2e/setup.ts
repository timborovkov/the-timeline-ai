import { pathToFileURL } from 'node:url';

import { closeDb, getDbClient } from '@timeline/db';
import { hashPassword } from '@timeline/shared/passwords';

import { cleanupE2eData } from './cleanup.js';
import { E2E_PASSWORD, e2eTeam, e2eUsers } from './test-data.js';

export async function setupE2eData(): Promise<void> {
  await cleanupE2eData();

  const sql = getDbClient();
  const passwordHash = await hashPassword(E2E_PASSWORD);

  await sql`
    INSERT INTO teams (id, slug, name, inbound_email)
    VALUES (${e2eTeam.id}, ${e2eTeam.slug}, ${e2eTeam.name}, ${e2eTeam.inboundEmail})
  `;
  await sql`
    INSERT INTO users (id, name, email, password_hash, "emailVerified")
    VALUES
      (${e2eUsers.owner.id}, ${e2eUsers.owner.name}, ${e2eUsers.owner.email}, ${passwordHash}, NOW()),
      (${e2eUsers.member.id}, ${e2eUsers.member.name}, ${e2eUsers.member.email}, ${passwordHash}, NOW())
  `;
  await sql`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      (${e2eTeam.id}, ${e2eUsers.owner.id}, 'owner'),
      (${e2eTeam.id}, ${e2eUsers.member.id}, 'member')
  `;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await setupE2eData();
  await closeDb();
}
