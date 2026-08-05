import { PGlite } from '@electric-sql/pglite';
import {
  integrationSyncContinuationHandoffs,
  integrationSyncState,
  integrations,
  teams,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminAcknowledgePendingIntegrationSyncContinuation,
  adminCommitIntegrationSyncCheckpoint,
  adminClaimPendingIntegrationSyncContinuations,
  adminHasPendingIntegrationSyncContinuations,
  adminRecordPendingIntegrationSyncContinuations,
} from '#src/integrations/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '22222222-2222-4222-8222-222222222222';

describe('integration pagination continuation handoffs', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await db.insert(teams).values({ id: TEAM_ID, slug: 'handoff-test', name: 'Handoff test' });
    await db.insert(integrations).values({
      id: INTEGRATION_ID,
      teamId: TEAM_ID,
      provider: 'github',
      displayName: 'GitHub',
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await pg.close();
  });

  it('merges concurrent target staging, keeps surfaces independent, and recovers an unacknowledged claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const earlierRetryAt = new Date('2026-06-25T03:00:00.000Z');
    const laterRetryAt = new Date('2026-06-25T03:02:00.000Z');
    const issueComments = {
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'issue_comments',
    };

    await Promise.all([
      adminRecordPendingIntegrationSyncContinuations(db as never, INTEGRATION_ID, [
        { ...issueComments, retryAt: earlierRetryAt },
      ]),
      adminRecordPendingIntegrationSyncContinuations(db as never, INTEGRATION_ID, [
        { ...issueComments, retryAt: laterRetryAt, continuationAttempt: 3 },
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'pr_review_comments',
          retryAt: earlierRetryAt,
        },
      ]),
    ]);

    const staged = await db
      .select()
      .from(integrationSyncContinuationHandoffs)
      .where(eq(integrationSyncContinuationHandoffs.integrationId, INTEGRATION_ID));
    expect(staged).toHaveLength(2);
    expect(staged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'issue_comments',
          retryAt: laterRetryAt,
          continuationAttempt: 3,
        }),
        expect.objectContaining({
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'pr_review_comments',
          retryAt: earlierRetryAt,
        }),
      ]),
    );

    const firstClaims = await adminClaimPendingIntegrationSyncContinuations(
      db as never,
      INTEGRATION_ID,
    );
    expect(firstClaims).toHaveLength(2);
    expect(
      await adminClaimPendingIntegrationSyncContinuations(db as never, INTEGRATION_ID),
    ).toEqual([]);

    // This is the crash window: no BullMQ acknowledgement was recorded. The
    // expired lease makes exactly the same durable handoff rows claimable.
    vi.setSystemTime(new Date('2026-06-25T03:01:01.000Z'));
    const recoveredClaims = await adminClaimPendingIntegrationSyncContinuations(
      db as never,
      INTEGRATION_ID,
    );
    expect(recoveredClaims.map((claim) => claim.handoffId).sort()).toEqual(
      firstClaims.map((claim) => claim.handoffId).sort(),
    );
    expect(recoveredClaims.map((claim) => claim.claimToken)).not.toEqual(
      firstClaims.map((claim) => claim.claimToken),
    );

    for (const claim of recoveredClaims) {
      await expect(
        adminAcknowledgePendingIntegrationSyncContinuation(
          db as never,
          claim.handoffId,
          claim.claimToken,
        ),
      ).resolves.toBe(true);
    }
    await expect(
      adminHasPendingIntegrationSyncContinuations(db as never, INTEGRATION_ID),
    ).resolves.toBe(false);
  });

  it('rolls back both GitHub surfaces, their cursor checkpoint, and synced state when continuation staging fails', async () => {
    await pg.exec(`
      ALTER TABLE integration_sync_continuation_handoffs
      ADD CONSTRAINT continuation_handoff_fault_injection
      CHECK (surface <> 'pr_review_comments')
    `);

    await expect(
      adminCommitIntegrationSyncCheckpoint(db as never, {
        integrationId: INTEGRATION_ID,
        cursors: [
          {
            resourceType: 'github.repo:acme/app:issue_comments',
            cursor: {
              issue_comments_since: '2026-06-25T03:00:00.000Z',
              issue_comments_continuation: { page: 2, phase: 'drain' },
            },
          },
        ],
        continuations: [
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'issue_comments',
          },
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'pr_review_comments',
          },
        ],
        markSynced: { clearError: false },
      }),
    ).rejects.toThrow();

    await expect(
      db
        .select()
        .from(integrationSyncContinuationHandoffs)
        .where(eq(integrationSyncContinuationHandoffs.integrationId, INTEGRATION_ID)),
    ).resolves.toEqual([]);
    await expect(
      db
        .select()
        .from(integrationSyncState)
        .where(eq(integrationSyncState.integrationId, INTEGRATION_ID)),
    ).resolves.toEqual([]);
    await expect(
      db
        .select({ lastSyncedAt: integrations.lastSyncedAt })
        .from(integrations)
        .where(eq(integrations.id, INTEGRATION_ID)),
    ).resolves.toEqual([{ lastSyncedAt: null }]);
  });

  it('stages a partial checkpoint without advancing an integration health timestamp', async () => {
    const priorLastSyncedAt = new Date('2026-06-25T02:00:00.000Z');
    await db
      .update(integrations)
      .set({ lastSyncedAt: priorLastSyncedAt, lastError: 'previous sync error' })
      .where(eq(integrations.id, INTEGRATION_ID));

    await adminCommitIntegrationSyncCheckpoint(db as never, {
      integrationId: INTEGRATION_ID,
      cursors: [
        {
          resourceType: 'github.repo:acme/app:issue_comments',
          cursor: {
            issue_comments_since: '2026-06-25T03:00:00.000Z',
            issue_comments_continuation: { page: 2, phase: 'drain' },
          },
          status: { lastStatus: 'error', lastError: 'GitHub temporarily overloaded' },
        },
      ],
      continuations: [
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'issue_comments',
        },
      ],
    });

    await expect(
      db
        .select({ lastSyncedAt: integrations.lastSyncedAt, lastError: integrations.lastError })
        .from(integrations)
        .where(eq(integrations.id, INTEGRATION_ID)),
    ).resolves.toEqual([{ lastSyncedAt: priorLastSyncedAt, lastError: 'previous sync error' }]);
    await expect(
      db
        .select({
          cursor: integrationSyncState.cursor,
          lastStatus: integrationSyncState.lastStatus,
        })
        .from(integrationSyncState)
        .where(eq(integrationSyncState.integrationId, INTEGRATION_ID)),
    ).resolves.toEqual([
      {
        cursor: {
          issue_comments_since: '2026-06-25T03:00:00.000Z',
          issue_comments_continuation: { page: 2, phase: 'drain' },
        },
        lastStatus: 'error',
      },
    ]);
    await expect(
      db
        .select({
          resourceType: integrationSyncContinuationHandoffs.resourceType,
          externalId: integrationSyncContinuationHandoffs.externalId,
          surface: integrationSyncContinuationHandoffs.surface,
        })
        .from(integrationSyncContinuationHandoffs)
        .where(eq(integrationSyncContinuationHandoffs.integrationId, INTEGRATION_ID)),
    ).resolves.toEqual([
      {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
      },
    ]);
  });
});
