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
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { resetEnvForTests } from '#src/env.js';
import type * as TelegramApiModule from '#src/telegram/api.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const send = vi.hoisted(() => vi.fn(() => Promise.resolve()));
await vi.mock(
  import.meta.resolve('#src/telegram/api.js'),
  async (original) => ({
    ...(await original<typeof TelegramApiModule>()),
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
      windowStart: '2026-06-13T12:00:00Z',
      windowEnd: '2026-06-14T12:00:00Z',
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

it('leaves an inactive workspace digest untouched even after the recipient leaves', async () => {
  await db.update(teamMembers).set({ removedAt: new Date() }).where(eq(teamMembers.teamId, teamId));
  await db.update(teams).set({ disabledAt: new Date() }).where(eq(teams.id, teamId));
  const [before] = await db.select().from(dailyDigests).where(eq(dailyDigests.id, digestId));
  try {
    expect(
      await sendDailyDigest({
        db,
        digestId,
        to: 'digest@example.test',
        digestUrl: 'https://example.test',
        now,
      }),
    ).toMatchObject({ ok: true, skipped: true });
    const [after] = await db.select().from(dailyDigests).where(eq(dailyDigests.id, digestId));
    expect(after).toEqual(before);
    expect(send).not.toHaveBeenCalled();
  } finally {
    await db.update(teams).set({ disabledAt: null }).where(eq(teams.id, teamId));
    await db.update(teamMembers).set({ removedAt: null }).where(eq(teamMembers.teamId, teamId));
  }
});

it('sends configured updates as link-only notices and preserves the archive if paused', async () => {
  const revision = new Date('2026-06-12T09:00:00.000Z');
  const [digest] = await db.select().from(dailyDigests).where(eq(dailyDigests.id, digestId));
  if (!digest) throw new Error('Missing test digest');
  await db
    .update(messagePreferences)
    .set({
      dailyDigestEnabled: false,
      updateOptions: {
        cadence: 'daily',
        scope: 'workspace',
        focus: 'balanced',
        destination: 'personal',
      },
      updatedAt: revision,
    })
    .where(eq(messagePreferences.teamId, teamId));
  await db
    .update(dailyDigests)
    .set({
      payload: {
        ...(digest.payload as Record<string, unknown>),
        updateRevision: revision.toISOString(),
        windowStart: digest.windowStart.toISOString(),
        windowEnd: digest.windowEnd.toISOString(),
        summary: 'Private project details',
        links: [{ label: 'Sensitive source title', href: '/app/timeline' }],
      },
    })
    .where(eq(dailyDigests.id, digestId));
  try {
    expect(await deliver()).toMatchObject({ ok: true, skipped: true });
    expect(send).not.toHaveBeenCalled();
    const [archived] = await db.select().from(dailyDigests).where(eq(dailyDigests.id, digestId));
    expect(archived?.status).toBe('generated');

    await db
      .update(messagePreferences)
      .set({ dailyDigestEnabled: true })
      .where(eq(messagePreferences.teamId, teamId));
    expect(await deliver()).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(send.mock.calls);
    expect(sent).toContain('example.test/digest');
    expect(sent).not.toContain('Private project details');
    expect(sent).not.toContain('Sensitive source title');

    expect(await deliver()).toMatchObject({ ok: true, skipped: true });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    await db
      .update(messagePreferences)
      .set({ dailyDigestEnabled: true, updateOptions: null })
      .where(eq(messagePreferences.teamId, teamId));
    await db
      .update(dailyDigests)
      .set({ payload: digest.payload })
      .where(eq(dailyDigests.id, digestId));
  }
});

it('keeps configured updates in the archive when every workspace destination is disabled', async () => {
  const revision = new Date('2026-06-12T09:00:00.000Z');
  const [digest] = await db.select().from(dailyDigests).where(eq(dailyDigests.id, digestId));
  if (!digest) throw new Error('Missing test digest');
  await db
    .update(messagePreferences)
    .set({
      updateOptions: {
        cadence: 'daily',
        scope: 'workspace',
        focus: 'balanced',
        destination: 'personal',
      },
      updatedAt: revision,
    })
    .where(eq(messagePreferences.teamId, teamId));
  await db
    .update(dailyDigests)
    .set({
      payload: {
        ...(digest.payload as Record<string, unknown>),
        updateRevision: revision.toISOString(),
      },
    })
    .where(eq(dailyDigests.id, digestId));
  await db
    .update(teamDigestDestinations)
    .set({ enabled: false })
    .where(eq(teamDigestDestinations.teamId, teamId));
  const interceptedEmail = vi.fn(() => Promise.resolve(Response.json({ id: 'fixture-email' })));
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_updates_fixture';
  resetEnvForTests();
  try {
    expect(
      await sendDailyDigest({
        db,
        digestId,
        to: 'digest@example.test',
        digestUrl: 'https://example.test/digest',
        now,
        fetch: interceptedEmail,
      }),
    ).toMatchObject({ ok: true, skipped: true });
    expect(interceptedEmail).toHaveBeenCalledTimes(0);
    expect(send).toHaveBeenCalledTimes(0);
    expect(await db.select().from(messageDeliveries)).toHaveLength(0);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    resetEnvForTests();
    await db
      .update(messagePreferences)
      .set({ updateOptions: null })
      .where(eq(messagePreferences.teamId, teamId));
    await db
      .update(dailyDigests)
      .set({ payload: digest.payload })
      .where(eq(dailyDigests.id, digestId));
    await db
      .update(teamDigestDestinations)
      .set({ enabled: true })
      .where(eq(teamDigestDestinations.teamId, teamId));
  }
});

it('keeps a transient destination retryable when another destination fails permanently', async () => {
  const [email] = await db
    .insert(teamDigestDestinations)
    .values({
      teamId,
      kind: 'email_members',
      createdAt: new Date('2099-01-01T00:00:00Z'),
    })
    .returning({ id: teamDigestDestinations.id });
  if (!email) throw new Error('Missing test destination');
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_updates_fixture';
  resetEnvForTests();
  const interceptedEmail = vi.fn(() =>
    Promise.resolve(Response.json({ name: 'validation_error' }, { status: 422 })),
  );
  send.mockRejectedValueOnce(new Error('Temporary Telegram provider outage'));
  try {
    expect(
      await sendDailyDigest({
        db,
        digestId,
        to: 'digest@example.test',
        digestUrl: 'https://example.test/digest',
        now,
        fetch: interceptedEmail,
      }),
    ).toMatchObject({ ok: false, retryable: true });
    expect(send).toHaveBeenCalledOnce();
    const rows = await db.select().from(messageDeliveries);
    expect(
      rows
        .filter((row) => row.status === 'failed')
        .map((row) => row.channel)
        .sort(),
    ).toEqual(['email', 'telegram']);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    resetEnvForTests();
    await db.delete(teamDigestDestinations).where(eq(teamDigestDestinations.id, email.id));
  }
});
