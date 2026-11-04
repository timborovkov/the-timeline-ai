import { PGlite } from '@electric-sql/pglite';
import { type Db, telegramChatBindings, telegramLinkTokens, telegramUsers } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_TOKEN_ID = '44444444-4444-4444-8444-444444444444';
const BINDING_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_BINDING_ID = '66666666-6666-4666-8666-666666666666';
const TG_USER_ID = '77777777-7777-4777-8777-777777777777';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'acme', 'Acme'),
      ('${OTHER_TEAM_ID}', 'other', 'Other');
    INSERT INTO users (id, email, name)
    VALUES
      ('${OWNER_ID}', 'owner@example.test', 'Owner'),
      ('${MEMBER_ID}', 'member@example.test', 'Member');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${OWNER_ID}', 'owner'),
      ('${TEAM_ID}', '${MEMBER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${OWNER_ID}', 'owner');
    INSERT INTO telegram_link_tokens (
      id, token, team_id, scope, issued_by_user_id, target_tg_username, expires_at
    )
    VALUES
      (
        '${TOKEN_ID}',
        'owner-token',
        '${TEAM_ID}',
        'group',
        '${OWNER_ID}',
        'owner_tg',
        NOW() + INTERVAL '15 minutes'
      ),
      (
        '${MEMBER_TOKEN_ID}',
        'member-token',
        '${TEAM_ID}',
        'personal',
        '${MEMBER_ID}',
        'member_tg',
        NOW() + INTERVAL '15 minutes'
      );
    INSERT INTO telegram_chat_bindings (id, tg_chat_id, team_id, title)
    VALUES
      ('${BINDING_ID}', 101, '${TEAM_ID}', 'Acme group'),
      ('${OTHER_BINDING_ID}', 202, '${OTHER_TEAM_ID}', 'Other group');
    INSERT INTO telegram_users (id, tg_user_id, username, first_name, user_id)
    VALUES ('${TG_USER_ID}', 9001, 'member_tg', 'Mem', '${MEMBER_ID}');
    INSERT INTO telegram_user_teams (telegram_user_id, team_id, is_active)
    VALUES ('${TG_USER_ID}', '${TEAM_ID}', true);
  `);
}

describe('telegram scope', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg) as unknown as Db;
  });

  afterEach(async () => {
    await pg.close();
  });

  it('lists team-scoped tokens, bindings, and linked users through withTeam', async () => {
    const owner = withTeam(db, TEAM_ID, OWNER_ID).telegram;
    const member = withTeam(db, TEAM_ID, MEMBER_ID).telegram;

    const ownerTokens = await owner.listActiveLinkTokens();
    const memberTokens = await member.listActiveLinkTokens();
    expect(ownerTokens.map((row) => row.id).sort()).toEqual([MEMBER_TOKEN_ID, TOKEN_ID].sort());
    expect(memberTokens.map((row) => row.id)).toEqual([MEMBER_TOKEN_ID]);

    expect(await owner.listChatBindings()).toMatchObject([{ id: BINDING_ID, title: 'Acme group' }]);
    expect(await owner.listLinkedUsers()).toMatchObject([
      {
        id: TG_USER_ID,
        username: 'member_tg',
        userId: MEMBER_ID,
        isActive: true,
        appName: 'Member',
        appEmail: 'member@example.test',
      },
    ]);
  });

  it('creates link tokens and admin-only revoke/unbind stay on the active team', async () => {
    const owner = withTeam(db, TEAM_ID, OWNER_ID).telegram;
    await owner.createLinkToken({
      scope: 'personal',
      token: 'fresh-token',
      targetTgUsername: 'fresh_tg',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const tokens = await db
      .select({ token: telegramLinkTokens.token, teamId: telegramLinkTokens.teamId })
      .from(telegramLinkTokens)
      .where(eq(telegramLinkTokens.token, 'fresh-token'));
    expect(tokens).toEqual([{ token: 'fresh-token', teamId: TEAM_ID }]);

    await owner.revokeLinkToken(TOKEN_ID);
    await owner.unbindChat(BINDING_ID);
    await owner.unbindChat(OTHER_BINDING_ID);

    const remainingTokens = await db
      .select({ id: telegramLinkTokens.id })
      .from(telegramLinkTokens)
      .where(eq(telegramLinkTokens.teamId, TEAM_ID));
    expect(remainingTokens).toHaveLength(2);
    expect(remainingTokens.some((row) => row.id === TOKEN_ID)).toBe(false);
    expect(remainingTokens.some((row) => row.id === MEMBER_TOKEN_ID)).toBe(true);

    const remainingBindings = await db
      .select({ id: telegramChatBindings.id })
      .from(telegramChatBindings);
    expect(remainingBindings.map((row) => row.id).sort()).toEqual([OTHER_BINDING_ID]);

    const leftoverUsers = await db
      .select({ id: telegramUsers.id })
      .from(telegramUsers)
      .where(eq(telegramUsers.id, TG_USER_ID));
    expect(leftoverUsers).toHaveLength(1);
  });
});
