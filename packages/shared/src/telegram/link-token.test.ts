import { expect } from '@timeline/test-support';
import { PGlite } from '@electric-sql/pglite';
import { type Db, telegramLinkTokens, teams, users, teamMembers } from '@timeline/db';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

import { consumeVerifiedTelegramLink } from '#src/telegram/link-token.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const pg = new PGlite();
const db = drizzle(pg) as unknown as Db;

beforeAll(async () => {
  await applyDbMigrations(pg);
  await db.insert(teams).values({ id: teamId, slug: 'token-test', name: 'Before' });
  await db.insert(users).values({ id: userId, email: 'token@example.test' });
  await db.insert(teamMembers).values({ teamId, userId, role: 'member' });
});
afterAll(() => pg.close());

async function token(
  name: string,
  scope: 'personal' | 'group',
  expiresAt = new Date(Date.now() + 60_000),
) {
  await db.insert(telegramLinkTokens).values({
    token: name,
    teamId,
    scope,
    issuedByUserId: userId,
    targetTgUsername: 'alice',
    expiresAt,
  });
  return { db, token: name, scope, username: 'ALICE', tgUserId: 7 };
}

async function readToken(name: string) {
  const [row] = await db
    .select()
    .from(telegramLinkTokens)
    .where(eq(telegramLinkTokens.token, name));
  if (!row) throw new Error('Missing test token');
  return row;
}

describe('verified Telegram link consumption', () => {
  it('commits the personal binding with consumption and rejects replay', async () => {
    const input = await token('personal', 'personal');
    expect(
      await consumeVerifiedTelegramLink(input, async (tx, row) => {
        await tx.update(teams).set({ name: 'Bound' }).where(eq(teams.id, row.teamId));
        return row.teamId;
      }),
    ).toBe(teamId);
    expect((await readToken('personal')).consumedByTgUserId).toBe(7);
    await expect(
      consumeVerifiedTelegramLink(input, () => Promise.resolve('invalid')),
    ).rejects.toThrow('consumed');
  });

  it('rejects expired, mismatched and legacy identities before binding', async () => {
    const expired = await token('expired', 'personal', new Date(Date.now() - 60_000));
    const wrongUser = await token('wrong-user', 'personal');
    const legacy = await token('legacy', 'personal');
    await db
      .update(telegramLinkTokens)
      .set({ targetTgUsername: null })
      .where(eq(telegramLinkTokens.token, legacy.token));
    let bound = false;
    const bind = () => {
      bound = true;
      return Promise.resolve();
    };
    await expect(consumeVerifiedTelegramLink(expired, bind)).rejects.toThrow('expired');
    await expect(
      consumeVerifiedTelegramLink({ ...wrongUser, username: 'bob' }, bind),
    ).rejects.toThrow('wrong_user');
    await expect(consumeVerifiedTelegramLink(legacy, bind)).rejects.toThrow('legacy_no_username');
    expect(bound).toBe(false);
  });

  it('requires a current admin for group binding but permits personal member links', async () => {
    const input = await token('group', 'group');
    await expect(
      consumeVerifiedTelegramLink(input, () => Promise.resolve('invalid')),
    ).rejects.toThrow('issuer_revoked');
    expect((await readToken('group')).consumedAt).toBeNull();
    await db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, userId));
    await consumeVerifiedTelegramLink({ ...input, chatId: -100 }, () => Promise.resolve('bound'));
    expect((await readToken('group')).consumedChatId).toBe(-100);
    await db.update(teamMembers).set({ role: 'member' }).where(eq(teamMembers.userId, userId));
  });

  it('rolls back binding writes and leaves the token reusable when binding fails', async () => {
    const input = await token('rollback', 'personal');
    const [before] = await db.select().from(teams).where(eq(teams.id, teamId));
    await expect(
      consumeVerifiedTelegramLink(input, async (tx) => {
        await tx.update(teams).set({ name: 'Must roll back' }).where(eq(teams.id, teamId));
        throw new Error('binding rejected');
      }),
    ).rejects.toThrow('binding rejected');
    expect((await db.select().from(teams).where(eq(teams.id, teamId)))[0]?.name).toBe(before?.name);
    expect((await readToken('rollback')).consumedAt).toBeNull();
    await consumeVerifiedTelegramLink(input, () => Promise.resolve('retry'));
    expect((await readToken('rollback')).consumedAt).not.toBeNull();
  });

  it('rechecks membership at consumption time and enforces token scope', async () => {
    const input = await token('revoked', 'personal');
    await expect(
      consumeVerifiedTelegramLink({ ...input, scope: 'group' }, () => Promise.resolve('invalid')),
    ).rejects.toThrow('wrong_scope_group');
    await db
      .update(teamMembers)
      .set({ removedAt: new Date() })
      .where(eq(teamMembers.userId, userId));
    await expect(
      consumeVerifiedTelegramLink(input, () => Promise.resolve('invalid')),
    ).rejects.toThrow('issuer_revoked');
    expect((await readToken('revoked')).consumedAt).toBeNull();
    await db.update(teamMembers).set({ removedAt: null }).where(eq(teamMembers.userId, userId));
  });
});
