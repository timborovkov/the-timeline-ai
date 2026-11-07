import type * as TelegramApiModule from '#src/telegram/api.js';
import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  teams,
  users,
  teamMembers,
  dailyDigests,
  messagePreferences,
  teamDigestDestinations,
  telegramUsers,
  telegramUserTeams,
  messageDeliveries,
} from '@timeline/db';
import { vi, expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { resetEnvForTests } from '#src/env.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const send = vi.hoisted(() => vi.fn(() => Promise.resolve()));
await vi.mock(
  import.meta.resolve('#src/telegram/api.js'),
  async (original) => ({
    ...(await original<TelegramApiModule>()),
    sendTelegramBotMessage: send,
  }),
  () => import('#src/telegram/api.js'),
);
const { sendDailyDigest } = await import('#src/messaging/digest-delivery.js');
const pg = new PGlite();
const db = drizzle(pg) as unknown as Db;
const teamId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const digestId = '33333333-3333-4333-8333-333333333333';
const telegramUserId = '44444444-4444-4444-8444-444444444444';
const dedupeKey = `daily_digest:${digestId}:telegram_dm_members`;
const previousToken = process.env.TELEGRAM_BOT_TOKEN;
const now = new Date('2026-06-14T13:00:00Z');

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'synthetic-test-token';
  resetEnvForTests();
  await applyDbMigrations(pg);
  await db.insert(teams).values({ id: teamId, slug: 'digest-test', name: 'Team' });
  await db.insert(users).values({ id: userId, email: 'digest@example.test' });
  await db.insert(teamMembers).values({ teamId, userId, role: 'member' });
  await db
    .insert(messagePreferences)
    .values({ teamId, userId, timezone: 'UTC', dailyDigestHour: 12 });
  await db.insert(teamDigestDestinations).values({ teamId, kind: 'telegram_dm_members' });
  await db.insert(telegramUsers).values({ id: telegramUserId, tgUserId: 7, userId });
  await db
    .insert(telegramUserTeams)
    .values({ telegramUserId, teamId, linkedByUserId: userId, isActive: true });
  await db.insert(dailyDigests).values({
    id: digestId,
    teamId,
    userId,
    windowStart: new Date('2026-06-13T12:00:00Z'),
    windowEnd: new Date('2026-06-14T12:00:00Z'),
    summary: 'Summary',
    payload: {
      teamName: 'Team',
      userName: 'User',
      summary: 'Summary',
      pendingApprovals: 0,
      eventCount: 0,
      sourceDistribution: {},
      objectChangesByType: {},
      newTeamMembers: [],
      tasks: [],
      upcomingCalendar: [],
      links: [],
    },
  });
});
afterAll(async () => {
  if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  resetEnvForTests();
  await pg.close();
});
beforeEach(async () => {
  send.mockClear();
  await db
    .update(dailyDigests)
    .set({ deliveryId: null, status: 'generated' })
    .where(eq(dailyDigests.id, digestId));
  await db.delete(messageDeliveries);
});
const deliver = () =>
  sendDailyDigest({
    db,
    digestId,
    to: 'digest@example.test',
    digestUrl: 'https://example.test/digest',
    now,
  });

async function prior(status: 'sent' | 'pending' | 'failed', updatedAt = new Date()) {
  await db.insert(messageDeliveries).values({
    intent: 'daily_digest',
    channel: 'telegram',
    teamId,
    userId,
    provider: 'telegram',
    dedupeKey,
    status,
    updatedAt,
  });
}

describe('bot digest delivery ledger', () => {
  it('does not resend a sent delivery', async () => {
    await prior('sent');
    expect(await deliver()).toMatchObject({ ok: true, skipped: true, skippedStatus: 'sent' });
    expect(send).not.toHaveBeenCalled();
  });
  it('leaves an active pending claim alone', async () => {
    await prior('pending');
    expect(await deliver()).toMatchObject({ ok: false, skipped: true, skippedStatus: 'pending' });
    expect(send).not.toHaveBeenCalled();
  });
  it('reclaims a failed delivery and records successful sending', async () => {
    await prior('failed');
    expect(await deliver()).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.select().from(messageDeliveries))[0]?.status).toBe('sent');
  });
  it('reclaims a stale pending delivery using the same ledger row', async () => {
    await prior('pending', new Date(Date.now() - 60_000));
    const [before] = await db.select().from(messageDeliveries);
    expect(await deliver()).toMatchObject({ ok: true, deliveryId: before?.id });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.select().from(messageDeliveries)).toHaveLength(1);
  });
});
