import { pathToFileURL } from 'node:url';

import { closeDb } from '@timeline/db';
import { hashPassword } from '@timeline/shared/passwords';

import { cleanupE2eDataWithinTransaction, withE2eDataTransaction } from './cleanup.js';
import {
  E2E_PASSWORD,
  e2eOtherTeam,
  e2eSeedEvents,
  e2eSeedTasks,
  e2eTeam,
  e2eUsers,
} from './test-data.js';

const TERMS_VERSION = '2026-06-02';
const PRIVACY_VERSION = '2026-06-02';

export async function setupE2eData(): Promise<void> {
  const passwordHash = await hashPassword(E2E_PASSWORD);

  await withE2eDataTransaction(async (sql) => {
    await cleanupE2eDataWithinTransaction(sql);
    await sql`
      INSERT INTO teams (id, slug, name, inbound_email)
      VALUES
        (${e2eTeam.id}, ${e2eTeam.slug}, ${e2eTeam.name}, ${e2eTeam.inboundEmail}),
        (${e2eOtherTeam.id}, ${e2eOtherTeam.slug}, ${e2eOtherTeam.name}, ${e2eOtherTeam.inboundEmail})
    `;
    await sql`
      INSERT INTO users (
        id,
        name,
        email,
        password_hash,
        "emailVerified",
        legal_terms_version,
        legal_privacy_version,
        legal_accepted_at
      )
      VALUES
        (${e2eUsers.owner.id}, ${e2eUsers.owner.name}, ${e2eUsers.owner.email}, ${passwordHash}, NOW(), ${TERMS_VERSION}, ${PRIVACY_VERSION}, NOW()),
        (${e2eUsers.admin.id}, ${e2eUsers.admin.name}, ${e2eUsers.admin.email}, ${passwordHash}, NOW(), ${TERMS_VERSION}, ${PRIVACY_VERSION}, NOW()),
        (${e2eUsers.member.id}, ${e2eUsers.member.name}, ${e2eUsers.member.email}, ${passwordHash}, NOW(), ${TERMS_VERSION}, ${PRIVACY_VERSION}, NOW()),
        (${e2eUsers.nonMember.id}, ${e2eUsers.nonMember.name}, ${e2eUsers.nonMember.email}, ${passwordHash}, NOW(), ${TERMS_VERSION}, ${PRIVACY_VERSION}, NOW()),
        (${e2eUsers.invitee.id}, ${e2eUsers.invitee.name}, ${e2eUsers.invitee.email}, ${passwordHash}, NOW(), ${TERMS_VERSION}, ${PRIVACY_VERSION}, NOW()),
        (${e2eUsers.pendingInvitee.id}, ${e2eUsers.pendingInvitee.name}, ${e2eUsers.pendingInvitee.email}, ${passwordHash}, NOW(), ${TERMS_VERSION}, ${PRIVACY_VERSION}, NOW())
    `;
    await sql`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES
        (${e2eTeam.id}, ${e2eUsers.owner.id}, 'owner'),
        (${e2eTeam.id}, ${e2eUsers.admin.id}, 'admin'),
        (${e2eTeam.id}, ${e2eUsers.member.id}, 'member'),
        (${e2eOtherTeam.id}, ${e2eUsers.owner.id}, 'owner'),
        (${e2eOtherTeam.id}, ${e2eUsers.nonMember.id}, 'owner')
    `;
    await sql`
      INSERT INTO raw_events (
        team_id,
        author_user_id,
        source,
        content_text,
        visibility,
        visibility_user_ids,
        visibility_owner_user_id,
        source_metadata
      )
      VALUES
        (
          ${e2eTeam.id},
          ${e2eUsers.owner.id},
          'web',
          ${e2eSeedEvents.privateForOwner},
          'private',
          NULL,
          ${e2eUsers.owner.id},
          '{"e2e":true}'::jsonb
        ),
        (
          ${e2eTeam.id},
          ${e2eUsers.owner.id},
          'web',
          ${e2eSeedEvents.specificForMember},
          'specific_users',
          ARRAY[${e2eUsers.member.id}]::uuid[],
          ${e2eUsers.owner.id},
          '{"e2e":true}'::jsonb
        ),
        (
          ${e2eOtherTeam.id},
          ${e2eUsers.nonMember.id},
          'web',
          ${e2eSeedEvents.otherTeam},
          'team',
          NULL,
          NULL,
          '{"e2e":true}'::jsonb
        )
    `;
    await sql`
      INSERT INTO entities (id, team_id, type, canonical_name, status)
      VALUES (
        ${e2eSeedTasks.mobileKanban.id},
        ${e2eTeam.id},
        'task',
        ${e2eSeedTasks.mobileKanban.canonicalName},
        'backlog'
      )
    `;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await setupE2eData();
  await closeDb();
}
