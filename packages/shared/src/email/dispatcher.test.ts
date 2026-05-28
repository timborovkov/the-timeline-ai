import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { rawEvents, teamMembers, teams, teamVisibilityDefaults, users } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { handleInbound } from './dispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function inboundPayload(messageId: string) {
  return {
    MessageID: `postmark-${messageId}`,
    Date: '2026-05-27T09:00:00Z',
    Subject: 'Vendor note',
    From: 'vendor@example.net',
    FromName: 'Vendor',
    FromFull: { Email: 'vendor@example.net', Name: 'Vendor' },
    To: 'team-a@inbound.test',
    ToFull: [{ Email: 'team-a@inbound.test', Name: 'Team A' }],
    CcFull: [],
    BccFull: [],
    OriginalRecipient: '',
    MailboxHash: 'team-a',
    TextBody: 'Please review this.',
    HtmlBody: '',
    Headers: [{ Name: 'Message-ID', Value: `<${messageId}@example.net>` }],
    Attachments: [],
  };
}

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) await pg.exec(stmt);
  }
}

describe('email dispatcher', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    db = drizzle(pg);

    await db.insert(teams).values({
      id: TEAM_ID,
      slug: 'team-a',
      name: 'Team A',
      inboundEmail: 'team-a@inbound.test',
    });
    await db.insert(users).values({ id: USER_ID, email: 'member@example.com' });
    await db.insert(teamMembers).values({
      teamId: TEAM_ID,
      userId: USER_ID,
      role: 'owner',
    });
  });

  it('falls back to team visibility for unverified private email with no real owner', async () => {
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_ID,
      source: 'email',
      visibility: 'private',
    });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test' },
        inboundPayload('vendor-note'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row?.source).toBe('email');
    expect(row?.authorUserId).toBeNull();
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityOwnerUserId).toBeNull();
  });

  it('treats unexpected email specific-users defaults as binary team visibility', async () => {
    await db.insert(teamVisibilityDefaults).values({
      teamId: TEAM_ID,
      source: 'email',
      visibility: 'specific_users',
      visibilityUserIds: [USER_ID],
    });

    await expect(
      handleInbound(
        { db: db as never, inboundDomain: 'inbound.test' },
        inboundPayload('specific-users-default'),
      ),
    ).resolves.toMatchObject({ ok: true, inserted: 1 });

    const [row] = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });
});
