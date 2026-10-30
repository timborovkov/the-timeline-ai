import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { PGlite as PGliteType } from '@electric-sql/pglite';
type PGlite = PGliteType;

await vi.mock(
  import.meta.resolve('#src/messaging/delivery.js'),
  () => ({
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  }),
  () => import('#src/messaging/delivery.js'),
);

const { PGlite } = await import('@electric-sql/pglite');
const { integrationAuditLog, integrations, integrationSyncState, notifications, teams, users } =
  await import('@timeline/db');
const { and, eq } = await import('drizzle-orm');
const { drizzle } = await import('drizzle-orm/pglite');
const { healthPauseNotificationDedupeKey } = await import('#src/integrations/health.js');
const {
  adminRecordCountedHealthFailure,
  adminResetIntegrationHealth,
  adminResumeIntegrationHealth,
} = await import('#src/integrations/scope.js');
const { sendMessage } = await import('#src/messaging/delivery.js');
const { withTeam } = await import('#src/team-scope.js');
const { applyDbMigrations } = await import('#src/test/pglite.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const PAUSE_AFTER_MS = 72 * 60 * 60 * 1000;
const FIRST_FAILED_AT = new Date('2026-06-25T12:00:00.000Z');
const BEFORE_WINDOW = new Date('2026-06-27T11:00:00.000Z');
const AFTER_WINDOW = new Date('2026-06-28T12:00:00.000Z');
const SECOND_FIRST_FAILED_AT = new Date('2026-07-01T12:00:00.000Z');
const SECOND_PAUSE_AT = new Date('2026-07-01T12:00:01.000Z');
const HEALTH_RESUME_BACKFILL_RESOURCE = 'health.resume_backfill';

describe('integration health pause persistence', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    vi.mocked(sendMessage).mockClear();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await db.insert(teams).values([
      { id: TEAM_ID, slug: 'health-pause', name: 'Health pause' },
      { id: OTHER_TEAM_ID, slug: 'other-team', name: 'Other team' },
    ]);
    await db.insert(users).values([
      { id: USER_ID, email: 'owner@example.test', name: 'Owner' },
      { id: MEMBER_ID, email: 'member@example.test', name: 'Member' },
      { id: OTHER_USER_ID, email: 'other@example.test', name: 'Other' },
    ]);
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner'),
        ('${TEAM_ID}', '${MEMBER_ID}', 'member'),
        ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'owner');
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
    expect(sendMessage).toHaveBeenCalledWith(
      'connection_attention',
      expect.objectContaining({ to: 'owner@example.test' }),
      expect.objectContaining({
        dedupeKey: healthPauseNotificationDedupeKey(INTEGRATION_ID, AFTER_WINDOW),
      }),
    );

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

  it('uses a per-incident pause notification dedupe key after resume', async () => {
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: FIRST_FAILED_AT,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: AFTER_WINDOW,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    await adminResumeIntegrationHealth(db as never, INTEGRATION_ID);

    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: SECOND_FIRST_FAILED_AT,
      pauseAfterMs: 1,
    });
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: SECOND_PAUSE_AT,
      pauseAfterMs: 1,
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessage).mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        dedupeKey: healthPauseNotificationDedupeKey(INTEGRATION_ID, AFTER_WINDOW),
      }),
    );
    expect(vi.mocked(sendMessage).mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        dedupeKey: healthPauseNotificationDedupeKey(INTEGRATION_ID, SECOND_PAUSE_AT),
      }),
    );
    expect(healthPauseNotificationDedupeKey(INTEGRATION_ID, AFTER_WINDOW)).not.toBe(
      healthPauseNotificationDedupeKey(INTEGRATION_ID, SECOND_PAUSE_AT),
    );
  });

  it('scoped resume is admin-gated, team-scoped, and leaves a recoverable backfill', async () => {
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: FIRST_FAILED_AT,
      pauseAfterMs: PAUSE_AFTER_MS,
    });
    await adminRecordCountedHealthFailure(db as never, INTEGRATION_ID, {
      kind: 'connectivity',
      error: 'fetch failed ETIMEDOUT',
      now: AFTER_WINDOW,
      pauseAfterMs: PAUSE_AFTER_MS,
    });

    const memberScope = withTeam(db as never, TEAM_ID, MEMBER_ID);
    await expect(memberScope.integrations.resumeIntegrationHealth(INTEGRATION_ID)).rejects.toThrow(
      'Requires admin role',
    );

    const otherTeamScope = withTeam(db as never, OTHER_TEAM_ID, OTHER_USER_ID);
    await expect(
      otherTeamScope.integrations.resumeIntegrationHealth(INTEGRATION_ID),
    ).rejects.toThrow('Integration not found');

    const [stillPaused] = await db
      .select({ healthPausedAt: integrations.healthPausedAt })
      .from(integrations)
      .where(eq(integrations.id, INTEGRATION_ID));
    expect(stillPaused?.healthPausedAt).toEqual(AFTER_WINDOW);

    const ownerScope = withTeam(db as never, TEAM_ID, USER_ID);
    const resumed = await ownerScope.integrations.resumeIntegrationHealth(INTEGRATION_ID);
    expect(resumed).toMatchObject({
      resumed: true,
      backfillPending: true,
      previousKind: 'connectivity',
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

    const pending = await db
      .select({
        resourceType: integrationSyncState.resourceType,
        lastStatus: integrationSyncState.lastStatus,
        cursor: integrationSyncState.cursor,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.integrationId, INTEGRATION_ID),
          eq(integrationSyncState.resourceType, HEALTH_RESUME_BACKFILL_RESOURCE),
        ),
      );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      resourceType: HEALTH_RESUME_BACKFILL_RESOURCE,
      lastStatus: 'pending',
    });
    expect(pending[0]?.cursor).toEqual({
      pending: true,
      previousKind: 'connectivity',
      previousError: null,
      firstFailedAt: FIRST_FAILED_AT.toISOString(),
      pausedAt: AFTER_WINDOW.toISOString(),
    });

    const audits = await db
      .select({ kind: integrationAuditLog.kind, teamId: integrationAuditLog.teamId })
      .from(integrationAuditLog)
      .where(eq(integrationAuditLog.integrationId, INTEGRATION_ID));
    expect(audits).toContainEqual({ kind: 'sync_resumed:health', teamId: TEAM_ID });

    const retry = await ownerScope.integrations.resumeIntegrationHealth(INTEGRATION_ID);
    expect(retry).toMatchObject({
      resumed: false,
      backfillPending: true,
      previousKind: 'connectivity',
    });
    await expect(
      db
        .select({ kind: integrationAuditLog.kind })
        .from(integrationAuditLog)
        .where(eq(integrationAuditLog.kind, 'sync_resumed:health')),
    ).resolves.toHaveLength(1);

    await ownerScope.integrations.completeHealthResumeBackfill(INTEGRATION_ID);
    const done = await ownerScope.integrations.resumeIntegrationHealth(INTEGRATION_ID);
    expect(done).toMatchObject({ resumed: false, backfillPending: false });
    await expect(
      db
        .select()
        .from(integrationSyncState)
        .where(eq(integrationSyncState.resourceType, HEALTH_RESUME_BACKFILL_RESOURCE)),
    ).resolves.toEqual([]);
  });
});
