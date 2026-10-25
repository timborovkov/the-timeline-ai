import { PGlite } from '@electric-sql/pglite';
import { integrations, notifications, teams, users } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#src/messaging/delivery.js', () => ({
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  adminRecordCountedHealthFailure,
  adminResetIntegrationHealth,
  adminResumeIntegrationHealth,
} from '#src/integrations/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const PAUSE_AFTER_MS = 72 * 60 * 60 * 1000;
const FIRST_FAILED_AT = new Date('2026-06-25T12:00:00.000Z');
const BEFORE_WINDOW = new Date('2026-06-27T11:00:00.000Z');
const AFTER_WINDOW = new Date('2026-06-28T12:00:00.000Z');

describe('integration health pause persistence', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await db.insert(teams).values({ id: TEAM_ID, slug: 'health-pause', name: 'Health pause' });
    await db.insert(users).values({ id: USER_ID, email: 'owner@example.test', name: 'Owner' });
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
    await db.insert(integrations).values({
      id: INTEGRATION_ID,
      teamId: TEAM_ID,
      connectedByUserId: USER_ID,
      provider: 'github',
      displayName: 'GitHub',
    });
  });

  afterEach(async () => {
    await pg.close();
  });

  it('pauses after two counted failures spanning the window and notifies the owner once', async () => {
    const first = await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: FIRST_FAILED_AT,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    expect(first).toMatchObject({
      consecutiveFailures: 1,
      paused: false,
      newlyPaused: false,
    });

    const tooSoon = await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: BEFORE_WINDOW,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    expect(tooSoon.paused).toBe(false);

    const paused = await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: AFTER_WINDOW,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    expect(paused).toMatchObject({
      paused: true,
      newlyPaused: true,
      pauseKind: 'connectivity',
    });

    const [row] = await db
      .select({
        healthPausedAt: integrations.healthPausedAt,
        healthPauseKind: integrations.healthPauseKind,
        healthOwnerNotifiedAt: integrations.healthOwnerNotifiedAt,
        consecutive: integrations.healthConsecutiveFailures,
      })
      .from(integrations)
      .where(eq(integrations.id, INTEGRATION_ID));
    expect(row?.healthPauseKind).toBe('connectivity');
    expect(row?.healthPausedAt).toEqual(AFTER_WINDOW);
    expect(row?.healthOwnerNotifiedAt).toEqual(AFTER_WINDOW);
    expect(row?.consecutive).toBeGreaterThanOrEqual(2);

    const notes = await db.select().from(notifications);
    expect(notes).toEqual([
      expect.objectContaining({
        teamId: TEAM_ID,
        userId: USER_ID,
        kind: 'connection_attention',
      }),
    ]);
    expect(String(notes[0]?.summary)).toContain("Paused: GitHub hasn't responded");

    const again = await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: new Date('2026-06-29T12:00:00.000Z'),
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    expect(again).toMatchObject({ paused: true, newlyPaused: false });
    await expect(db.select().from(notifications)).resolves.toHaveLength(1);
  });

  it('resume and reset clear pause columns without leaving a kind orphan', async () => {
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'access_revoked',
      error: 'GitHub GET /repos/acme/app: 403 forbidden',
      now: FIRST_FAILED_AT,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'access_revoked',
      error: 'GitHub GET /repos/acme/app: 403 forbidden',
      now: AFTER_WINDOW,
      pauseAfterMs: PAUSE_AFTER_MS,
    });

    const resumed = await adminResumeIntegrationHealth(db as never, INTEGRATION_ID);
    expect(resumed).toMatchObject({
      resumed: true,
      previousKind: 'access_revoked',
    });

    const [afterResume] = await db
      .select({
        healthPausedAt: integrations.healthPausedAt,
        healthPauseKind: integrations.healthPauseKind,
        consecutive: integrations.healthConsecutiveFailures,
      })
      .from(integrations)
      .where(eq(integrations.id, INTEGRATION_ID));
    expect(afterResume).toMatchObject({
      healthPausedAt: null,
      healthPauseKind: null,
      consecutive: 0,
    });

    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'permanent',
      error: '410 Gone: repository permanently deleted',
      now: FIRST_FAILED_AT,
      pauseAfterMs: 1,
    });
    await adminResetIntegrationHealth(db as never, INTEGRATION_ID);
    const [afterReset] = await db
      .select({
        healthPausedAt: integrations.healthPausedAt,
        healthPauseKind: integrations.healthPauseKind,
        notified: integrations.healthOwnerNotifiedAt,
      })
      .from(integrations)
      .where(eq(integrations.id, INTEGRATION_ID));
    expect(afterReset).toEqual({
      healthPausedAt: null,
      healthPauseKind: null,
      notified: null,
    });
  });
});
