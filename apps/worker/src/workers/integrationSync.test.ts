import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TimelineDb from '@timeline/db';
import type * as TimelineShared from '@timeline/shared';

type TestSyncContinuation = TimelineShared.integrations.SyncContinuation;
type TestCheckpointInput = TimelineShared.integrations.CommitIntegrationSyncCheckpointInput;

// Integration sync workers are the first durable signal that a provider
// connection needs human action. These tests keep owner-left, reconnect, and
// transient-failure attention categories honest without depending on Redis.

const fakes = vi.hoisted(() => {
  const reserved = vi.fn(() => Promise.resolve([{ locked: true }])) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<{ locked: boolean }[]>;
    mockClear: () => void;
    mockImplementation: (
      implementation: (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<{ locked: boolean }[]>,
    ) => void;
    release: ReturnType<typeof vi.fn>;
  };
  reserved.release = vi.fn();
  return {
    reserved,
    getDbClient: vi.fn(),
    adminLoadIntegration: vi.fn(),
    adminListEnabledIntegrations: vi.fn(),
    adminVerifyTeamMember: vi.fn(),
    adminRecordError: vi.fn(),
    adminRecordConnectionAttention: vi.fn(),
    adminDecryptIntegrationTokens: vi.fn(),
    adminListSelections: vi.fn(),
    adminRecordAudit: vi.fn(),
    adminLoadCursor: vi.fn(),
    adminSaveCursor: vi.fn(),
    adminPersistTokens: vi.fn(),
    adminMarkSynced: vi.fn(),
    adminCommitIntegrationSyncCheckpoint: vi.fn(),
    adminResetTransientSyncFailures: vi.fn(),
    adminLoadIntegrationSyncPause: vi.fn(),
    adminRecordIntegrationSyncPause: vi.fn(),
    adminRecordPendingIntegrationSyncContinuations: vi.fn(),
    adminClaimPendingIntegrationSyncContinuations: vi.fn(),
    adminHasPendingIntegrationSyncContinuations: vi.fn(),
    adminAcknowledgePendingIntegrationSyncContinuation: vi.fn(),
    adminReleasePendingIntegrationSyncContinuation: vi.fn(),
    adminLoadProviderBudgetPause: vi.fn(),
    adminRecordProviderBudgetPause: vi.fn(),
    adminReconcileExpiringWebhookSubscriptions: vi.fn(),
    adminResolveConnectionAttention: vi.fn(),
    adminRecordTransientSyncFailure: vi.fn(),
    writeIntegrationEvents: vi.fn(),
    getProvider: vi.fn(),
    incrementalSync: vi.fn(),
    enqueueIntegrationSyncJob: vi.fn(),
    pendingContinuationHandoffs: [] as {
      handoffId: string;
      claimToken: string | null;
      continuation: TestSyncContinuation;
    }[],
    continuationHandoffSequence: 0,
  };
});

vi.mock('@timeline/db', async (importOriginal) => ({
  ...(await importOriginal<typeof TimelineDb>()),
  getDbClient: fakes.getDbClient,
}));

vi.mock('@timeline/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof TimelineShared>();
  return {
    ...actual,
    childLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    integrations: {
      ...actual.integrations,
      adminLoadIntegration: fakes.adminLoadIntegration,
      adminListEnabledIntegrations: fakes.adminListEnabledIntegrations,
      adminVerifyTeamMember: fakes.adminVerifyTeamMember,
      adminRecordError: fakes.adminRecordError,
      adminRecordConnectionAttention: fakes.adminRecordConnectionAttention,
      adminDecryptIntegrationTokens: fakes.adminDecryptIntegrationTokens,
      adminListSelections: fakes.adminListSelections,
      adminRecordAudit: fakes.adminRecordAudit,
      adminLoadCursor: fakes.adminLoadCursor,
      adminSaveCursor: fakes.adminSaveCursor,
      adminPersistTokens: fakes.adminPersistTokens,
      adminMarkSynced: fakes.adminMarkSynced,
      adminCommitIntegrationSyncCheckpoint: fakes.adminCommitIntegrationSyncCheckpoint,
      adminResetTransientSyncFailures: fakes.adminResetTransientSyncFailures,
      adminLoadIntegrationSyncPause: fakes.adminLoadIntegrationSyncPause,
      adminRecordIntegrationSyncPause: fakes.adminRecordIntegrationSyncPause,
      adminRecordPendingIntegrationSyncContinuations:
        fakes.adminRecordPendingIntegrationSyncContinuations,
      adminClaimPendingIntegrationSyncContinuations:
        fakes.adminClaimPendingIntegrationSyncContinuations,
      adminHasPendingIntegrationSyncContinuations:
        fakes.adminHasPendingIntegrationSyncContinuations,
      adminAcknowledgePendingIntegrationSyncContinuation:
        fakes.adminAcknowledgePendingIntegrationSyncContinuation,
      adminReleasePendingIntegrationSyncContinuation:
        fakes.adminReleasePendingIntegrationSyncContinuation,
      adminLoadProviderBudgetPause: fakes.adminLoadProviderBudgetPause,
      adminRecordProviderBudgetPause: fakes.adminRecordProviderBudgetPause,
      adminReconcileExpiringWebhookSubscriptions: fakes.adminReconcileExpiringWebhookSubscriptions,
      adminResolveConnectionAttention: fakes.adminResolveConnectionAttention,
      adminRecordTransientSyncFailure: fakes.adminRecordTransientSyncFailure,
      writeIntegrationEvents: fakes.writeIntegrationEvents,
      getProvider: fakes.getProvider,
    },
    queue: {
      ...actual.queue,
      enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
    },
  };
});

const { handleTick, runOneIntegration } = await import('./integrationSync.js');
const { integrations } = await import('@timeline/shared');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

function continuationHandoffId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

interface TestIntegrationEvent {
  dedupKey: string;
  provider: string;
  eventType: string;
  externalObjectId: string;
  contentText: string;
  extra?: Record<string, unknown>;
}

interface TestWriteIntegrationEventsInput {
  db: unknown;
  integration: Record<string, unknown>;
  events: TestIntegrationEvent[];
}

const integration = {
  id: INTEGRATION_ID,
  teamId: TEAM_ID,
  connectedByUserId: USER_ID,
  providerConnectionId: CONNECTION_ID,
  provider: 'github',
  enabled: true,
};

beforeEach(() => {
  integrations.setSlackProviderFetchForTests((input, init) => globalThis.fetch(input, init));
  vi.clearAllMocks();
  fakes.reserved.mockClear();
  fakes.reserved.mockImplementation(() => Promise.resolve([{ locked: true }]));
  fakes.reserved.release.mockClear();
  fakes.getDbClient.mockReturnValue({ reserve: vi.fn(() => Promise.resolve(fakes.reserved)) });
  fakes.adminLoadIntegration.mockResolvedValue(integration);
  fakes.adminListEnabledIntegrations.mockResolvedValue([]);
  fakes.adminVerifyTeamMember.mockResolvedValue(true);
  fakes.adminDecryptIntegrationTokens.mockResolvedValue({ access_token: 'token' });
  fakes.adminListSelections.mockResolvedValue([]);
  fakes.adminRecordAudit.mockResolvedValue(undefined);
  fakes.adminLoadCursor.mockResolvedValue({});
  fakes.adminSaveCursor.mockResolvedValue(undefined);
  fakes.adminPersistTokens.mockResolvedValue(undefined);
  fakes.writeIntegrationEvents.mockResolvedValue(['raw-slack-1']);
  fakes.adminRecordError.mockResolvedValue(undefined);
  fakes.adminRecordConnectionAttention.mockResolvedValue(undefined);
  fakes.adminMarkSynced.mockResolvedValue(undefined);
  fakes.adminResetTransientSyncFailures.mockResolvedValue(undefined);
  fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);
  fakes.adminRecordIntegrationSyncPause.mockResolvedValue(undefined);
  fakes.pendingContinuationHandoffs = [];
  fakes.continuationHandoffSequence = 0;
  const stageContinuations = (continuations: readonly TestSyncContinuation[]) => {
    for (const continuation of continuations) {
      const existing = fakes.pendingContinuationHandoffs.find(
        (candidate) =>
          candidate.continuation.resourceType === continuation.resourceType &&
          candidate.continuation.externalId === continuation.externalId &&
          candidate.continuation.surface === continuation.surface,
      );
      if (existing) {
        if (
          continuation.retryAt &&
          (!existing.continuation.retryAt || continuation.retryAt > existing.continuation.retryAt)
        ) {
          existing.continuation.retryAt = continuation.retryAt;
        }
        existing.continuation.continuationAttempt = Math.max(
          existing.continuation.continuationAttempt ?? 0,
          continuation.continuationAttempt ?? 0,
        );
        continue;
      }
      fakes.continuationHandoffSequence += 1;
      fakes.pendingContinuationHandoffs.push({
        handoffId: continuationHandoffId(fakes.continuationHandoffSequence),
        claimToken: null,
        continuation: { ...continuation },
      });
    }
  };
  fakes.adminRecordPendingIntegrationSyncContinuations.mockImplementation(
    (_db: unknown, _integrationId: string, continuations: readonly TestSyncContinuation[]) => {
      stageContinuations(continuations);
      return Promise.resolve();
    },
  );
  fakes.adminCommitIntegrationSyncCheckpoint.mockImplementation(
    (_db: unknown, input: TestCheckpointInput) => {
      for (const cursor of input.cursors) {
        fakes.adminSaveCursor(
          _db,
          input.integrationId,
          cursor.resourceType,
          cursor.cursor,
          cursor.status,
        );
      }
      stageContinuations(input.continuations ?? []);
      if (input.markSynced) {
        fakes.adminMarkSynced(_db, input.integrationId, input.markSynced);
      }
      return Promise.resolve();
    },
  );
  fakes.adminClaimPendingIntegrationSyncContinuations.mockImplementation(() => {
    const claimed = fakes.pendingContinuationHandoffs.filter(
      (handoff) => handoff.claimToken === null,
    );
    return Promise.resolve(
      claimed.map((handoff) => {
        const claimToken = `10000000-0000-4000-8000-${handoff.handoffId.slice(-12)}`;
        handoff.claimToken = claimToken;
        return {
          handoffId: handoff.handoffId,
          claimToken,
          continuation: handoff.continuation,
        };
      }),
    );
  });
  fakes.adminHasPendingIntegrationSyncContinuations.mockImplementation(() =>
    Promise.resolve(fakes.pendingContinuationHandoffs.length > 0),
  );
  fakes.adminAcknowledgePendingIntegrationSyncContinuation.mockImplementation(
    (_db, handoffId, claimToken) => {
      const index = fakes.pendingContinuationHandoffs.findIndex(
        (handoff) => handoff.handoffId === handoffId && handoff.claimToken === claimToken,
      );
      if (index < 0) return Promise.resolve(false);
      fakes.pendingContinuationHandoffs.splice(index, 1);
      return Promise.resolve(true);
    },
  );
  fakes.adminReleasePendingIntegrationSyncContinuation.mockImplementation(
    (_db, handoffId, claimToken) => {
      const handoff = fakes.pendingContinuationHandoffs.find(
        (candidate) => candidate.handoffId === handoffId && candidate.claimToken === claimToken,
      );
      if (!handoff) return Promise.resolve(false);
      handoff.claimToken = null;
      return Promise.resolve(true);
    },
  );
  fakes.adminLoadProviderBudgetPause.mockResolvedValue(null);
  fakes.adminRecordProviderBudgetPause.mockResolvedValue(undefined);
  fakes.adminReconcileExpiringWebhookSubscriptions.mockResolvedValue({
    checked: 0,
    renewed: 0,
    degraded: 0,
    skipped: 0,
  });
  fakes.adminResolveConnectionAttention.mockResolvedValue(undefined);
  fakes.adminRecordTransientSyncFailure.mockResolvedValue({
    count: 1,
    shouldCreateAttention: false,
  });
  fakes.incrementalSync.mockResolvedValue(undefined);
  fakes.getProvider.mockReturnValue({ incrementalSync: fakes.incrementalSync });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
});

afterEach(() => {
  integrations.setSlackProviderFetchForTests();
  vi.unstubAllGlobals();
});

describe('handleTick provider reconciliation cadence', () => {
  it('sweeps expiring webhook subscriptions before scheduling reconciliation work', async () => {
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([]);

    await handleTick({} as never);

    expect(fakes.adminReconcileExpiringWebhookSubscriptions).toHaveBeenCalledWith(
      expect.anything(),
    );
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('does not enqueue paused integrations from the background tick', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([integration]);
    fakes.adminLoadIntegrationSyncPause.mockResolvedValueOnce({
      retryAt,
      reason: 'github_rate_limited',
    });

    await handleTick({} as never);

    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('throttles recently synced integrations by provider reconciliation policy', async () => {
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([
      { ...integration, provider: 'github', lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000) },
      {
        ...integration,
        id: '55555555-5555-4555-8555-555555555555',
        provider: 'google_drive',
        lastSyncedAt: new Date(Date.now() - 16 * 60 * 1000),
      },
    ]);
    fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);

    await handleTick({} as never);

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledTimes(1);
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: '55555555-5555-4555-8555-555555555555',
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
    });
  });

  it('does not enqueue integrations while their provider account budget is paused', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([
      {
        ...integration,
        provider: 'monday',
        externalAccountId: 'monday-account-1',
      },
    ]);
    fakes.adminLoadProviderBudgetPause.mockResolvedValueOnce({
      retryAt,
      reason: 'daily_limit_exceeded',
      scope: 'daily',
    });

    await handleTick({} as never);

    expect(fakes.adminLoadProviderBudgetPause).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'monday',
        appKey: 'monday',
        externalAccountId: 'monday-account-1',
      }),
    );
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('checks provider-specific budget scopes before enqueueing reconciliation', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([
      {
        ...integration,
        provider: 'slack',
        externalAccountId: 'T123',
      },
    ]);
    fakes.adminLoadProviderBudgetPause.mockResolvedValueOnce(null).mockResolvedValueOnce({
      retryAt,
      reason: 'slack_rate_limited',
      scope: 'web_api',
    });

    await handleTick({} as never);

    expect(fakes.adminLoadProviderBudgetPause).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        provider: 'slack',
        externalAccountId: 'T123',
        scope: 'requests',
      }),
    );
    expect(fakes.adminLoadProviderBudgetPause).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        provider: 'slack',
        externalAccountId: 'T123',
        scope: 'web_api',
      }),
    );
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('enqueues GitHub again after the reconciliation interval elapses', async () => {
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([
      { ...integration, lastSyncedAt: new Date(Date.now() - 7 * 60 * 60 * 1000) },
    ]);
    fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);

    await handleTick({} as never);

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
    });
  });
});

describe('runOneIntegration attention classification', () => {
  it('pauses sync with needs_new_owner when the connection owner left the team', async () => {
    fakes.adminVerifyTeamMember.mockResolvedValueOnce(false);

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminRecordError).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      'Connection owner left team — choose a replacement connection',
    );
    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'needs_new_owner',
      summary: 'Connection owner left team — choose a replacement connection',
    });
    expect(fakes.incrementalSync).not.toHaveBeenCalled();
  });

  it('creates reconnect attention when provider-connection tokens cannot be decrypted', async () => {
    fakes.adminDecryptIntegrationTokens.mockResolvedValueOnce(null);

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'needs_reconnect',
      summary: 'No tokens — reconnect required',
    });
    expect(fakes.incrementalSync).not.toHaveBeenCalled();
  });

  it('narrows targeted GitHub jobs to the changed repo when an org source is selected', async () => {
    fakes.adminListSelections.mockResolvedValueOnce([{ kind: 'github.org', externalId: 'acme' }]);

    await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      reason: 'github_repo_webhook',
    });

    expect(fakes.incrementalSync).toHaveBeenCalledWith(
      expect.objectContaining({
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      }),
    );
  });

  it('passes targeted Monday item jobs through the selected parent board', async () => {
    fakes.adminLoadIntegration.mockResolvedValueOnce({ ...integration, provider: 'monday' });
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'monday.board', externalId: 'board-1' },
    ]);

    await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
      resourceType: 'monday.item',
      externalId: 'board-1:item-1',
      surface: 'column.changed',
      reason: 'monday_item_webhook',
    });

    expect(fakes.incrementalSync).toHaveBeenCalledWith(
      expect.objectContaining({
        selections: [{ kind: 'monday.board', externalId: 'board-1' }],
        target: {
          resourceType: 'monday.item',
          externalId: 'board-1:item-1',
          surface: 'column.changed',
          reason: 'monday_item_webhook',
          triggeredBy: 'webhook',
        },
      }),
    );
  });

  it('stages a Monday conversation checkpoint before handing off its exact continuation', async () => {
    let lockHeld = false;
    fakes.reserved.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('pg_try_advisory_lock')) {
        lockHeld = true;
        return Promise.resolve([{ locked: true }]);
      }
      if (query.includes('pg_advisory_unlock')) lockHeld = false;
      return Promise.resolve([]);
    });
    fakes.adminLoadIntegration.mockResolvedValueOnce({ ...integration, provider: 'monday' });
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'monday.board', externalId: 'board-1' },
    ]);
    const continuation = {
      resourceType: 'monday.item',
      externalId: 'board-1:item-1:update-1',
    };
    fakes.incrementalSync.mockImplementationOnce(
      async ({ ctx }: { ctx: TimelineShared.integrations.SyncContext }) => {
        if (!ctx.saveCursorWithContinuations) {
          throw new Error('worker must provide a durable continuation checkpoint');
        }
        await ctx.saveCursorWithContinuations(
          'monday.board:board-1',
          { item_page_cursor: 'next-page' },
          [continuation],
        );
      },
    );
    fakes.enqueueIntegrationSyncJob.mockImplementationOnce(() => {
      expect(lockHeld).toBe(false);
      return Promise.resolve();
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'monday.item',
      externalId: 'board-1:item-1:update-1',
      reason: 'provider_pagination_continuation',
      continuationHandoffId: continuationHandoffId(1),
    });
    expect(fakes.adminCommitIntegrationSyncCheckpoint).toHaveBeenCalledWith(expect.anything(), {
      integrationId: INTEGRATION_ID,
      cursors: [
        {
          resourceType: 'monday.board:board-1',
          cursor: { item_page_cursor: 'next-page' },
        },
      ],
      continuations: [continuation],
    });
  });

  it('hands a GitHub conversation page-cap continuation to an immediate repository sync', async () => {
    let lockHeld = false;
    fakes.reserved.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('pg_try_advisory_lock')) {
        lockHeld = true;
        return Promise.resolve([{ locked: true }]);
      }
      if (query.includes('pg_advisory_unlock')) lockHeld = false;
      return Promise.resolve([]);
    });
    fakes.adminLoadIntegration.mockResolvedValueOnce(integration);
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'github.repo', externalId: 'acme/app' },
    ]);
    fakes.incrementalSync.mockResolvedValueOnce({
      continuations: [{ resourceType: 'github.repo', externalId: 'acme/app' }],
    });
    fakes.enqueueIntegrationSyncJob.mockImplementationOnce(() => {
      expect(lockHeld).toBe(false);
      return Promise.resolve();
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      reason: 'provider_pagination_continuation',
      continuationHandoffId: continuationHandoffId(1),
    });
  });

  it('schedules GitHub conversation continuations separately for each surface', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const issueRetryAt = new Date('2026-06-25T03:00:00.000Z');
    const reviewRetryAt = new Date('2026-06-25T03:02:00.000Z');
    const continuations = [
      {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
        retryAt: issueRetryAt,
      },
      {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'pr_review_comments',
        retryAt: reviewRetryAt,
      },
    ];
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'github.repo', externalId: 'acme/app' },
    ]);
    fakes.incrementalSync.mockImplementationOnce(
      async ({ ctx }: { ctx: TimelineShared.integrations.SyncContext }) => {
        await ctx.saveCursor('github.repo:acme/app:issue_comments', {
          issue_comments_continuation: { page: 2, phase: 'drain' },
        });
        return { continuations };
      },
    );

    try {
      await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.adminCommitIntegrationSyncCheckpoint).toHaveBeenCalledWith(expect.anything(), {
      integrationId: INTEGRATION_ID,
      cursors: [
        {
          resourceType: 'github.repo:acme/app:issue_comments',
          cursor: { issue_comments_continuation: { page: 2, phase: 'drain' } },
        },
      ],
      continuations,
    });
    expect(fakes.adminCommitIntegrationSyncCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.enqueueIntegrationSyncJob.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenNthCalledWith(
      1,
      {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
        reason: 'provider_pagination_continuation',
        continuationHandoffId: continuationHandoffId(1),
      },
      { delayMs: 60_000 },
    );
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenNthCalledWith(
      2,
      {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'pr_review_comments',
        reason: 'provider_pagination_continuation',
        continuationHandoffId: continuationHandoffId(2),
      },
      { delayMs: 180_000 },
    );
  });

  it('preserves integration failure state when a targeted surface continuation succeeds', async () => {
    const issueContinuation = {
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'issue_comments',
    };
    const reviewContinuation = {
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'pr_review_comments',
    };
    fakes.incrementalSync.mockResolvedValueOnce({
      partialFailures: [
        {
          resource: 'acme/app',
          surface: 'pr_review_comments',
          error: 'GitHub review comments temporarily overloaded',
        },
      ],
      continuations: [issueContinuation, reviewContinuation],
    });
    fakes.adminRecordTransientSyncFailure.mockResolvedValueOnce({
      count: 3,
      shouldCreateAttention: true,
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    fakes.adminMarkSynced.mockClear();
    fakes.adminResetTransientSyncFailures.mockClear();
    fakes.adminResolveConnectionAttention.mockClear();
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'github.repo', externalId: 'acme/app' },
    ]);
    fakes.incrementalSync.mockResolvedValueOnce(undefined);

    await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'issue_comments',
      reason: 'provider_pagination_continuation',
    });

    expect(fakes.adminMarkSynced).not.toHaveBeenCalled();
    expect(fakes.adminCommitIntegrationSyncCheckpoint).toHaveBeenCalledWith(expect.anything(), {
      integrationId: INTEGRATION_ID,
      cursors: [],
      continuations: [],
    });
    expect(fakes.adminResetTransientSyncFailures).not.toHaveBeenCalled();
    expect(fakes.adminResolveConnectionAttention).not.toHaveBeenCalled();
  });

  it('uses the later of the provider and carried deadlines for every rate-limited continuation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const retryAt = new Date('2026-06-25T03:00:00.000Z');
    const err = Object.assign(
      new Error(
        'github_rate_limited: GitHub API rate limit reached; retry after 2026-06-25T03:00:00.000Z',
      ),
      {
        code: 'github_rate_limited',
        retryAt,
        syncContinuations: [
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'issue_comments',
            retryAt: new Date('2026-06-25T02:59:30.000Z'),
          },
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'pr_review_comments',
            retryAt: new Date('2026-06-25T03:02:00.000Z'),
          },
        ],
      },
    );
    fakes.incrementalSync.mockRejectedValueOnce(err);

    try {
      await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenNthCalledWith(
      1,
      {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
        reason: 'provider_pagination_continuation',
        continuationHandoffId: continuationHandoffId(1),
      },
      { delayMs: 60_000 },
    );
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenNthCalledWith(
      2,
      {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'pr_review_comments',
        reason: 'provider_pagination_continuation',
        continuationHandoffId: continuationHandoffId(2),
      },
      { delayMs: 180_000 },
    );
  });

  it('propagates a rate-limited continuation handoff failure after releasing the lock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const retryAt = new Date('2026-06-25T03:00:00.000Z');
    const err = Object.assign(new Error('github_rate_limited'), {
      code: 'github_rate_limited',
      retryAt,
      syncContinuations: [
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'issue_comments',
        },
      ],
    });
    fakes.incrementalSync.mockRejectedValueOnce(err);
    fakes.enqueueIntegrationSyncJob.mockRejectedValueOnce(new Error('Redis unavailable'));

    try {
      await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
        'Redis unavailable',
      );
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.reserved.release).toHaveBeenCalledOnce();
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
        reason: 'provider_pagination_continuation',
        continuationHandoffId: continuationHandoffId(1),
      },
      { delayMs: 60_000 },
    );
  });

  it('releases only a rejected broad-sync rate-limit handoff for durable replay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const retryAt = new Date('2026-06-25T03:00:00.000Z');
    const err = Object.assign(new Error('github_rate_limited'), {
      code: 'github_rate_limited',
      retryAt,
      syncContinuations: [
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
    });
    fakes.incrementalSync.mockRejectedValueOnce(err);
    fakes.enqueueIntegrationSyncJob
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    const acceptedHandoff = {
      handoffId: '55555555-5555-4555-8555-555555555555',
      claimToken: '66666666-6666-4666-8666-666666666666',
      continuation: {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
        retryAt,
      },
    };
    const rejectedHandoff = {
      handoffId: '77777777-7777-4777-8777-777777777777',
      claimToken: '88888888-8888-4888-8888-888888888888',
      continuation: {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'pr_review_comments',
        retryAt,
      },
    };
    fakes.adminClaimPendingIntegrationSyncContinuations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([acceptedHandoff, rejectedHandoff])
      .mockResolvedValueOnce([rejectedHandoff]);
    fakes.adminAcknowledgePendingIntegrationSyncContinuation
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    try {
      await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
        'Redis unavailable',
      );

      expect(fakes.adminCommitIntegrationSyncCheckpoint).toHaveBeenCalledWith(expect.anything(), {
        integrationId: INTEGRATION_ID,
        cursors: [],
        continuations: [
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'issue_comments',
            retryAt,
          },
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'pr_review_comments',
            retryAt,
          },
        ],
      });
      expect(fakes.adminReleasePendingIntegrationSyncContinuation).toHaveBeenCalledWith(
        expect.anything(),
        rejectedHandoff.handoffId,
        rejectedHandoff.claimToken,
      );

      vi.setSystemTime(new Date('2026-06-25T03:01:00.000Z'));
      fakes.enqueueIntegrationSyncJob.mockResolvedValueOnce(undefined);

      await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.incrementalSync).toHaveBeenCalledTimes(1);
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledTimes(3);
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenLastCalledWith({
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'pr_review_comments',
      reason: 'provider_pagination_continuation',
      continuationHandoffId: rejectedHandoff.handoffId,
    });
  });

  it('durably stages carried cursors and continuations before a generic provider failure rethrows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const err = Object.assign(
      new Error('GitHub temporarily overloaded while syncing acme/repo-b'),
      {
        syncContinuations: [
          {
            resourceType: 'github.repo',
            externalId: 'acme/repo-a',
            surface: 'issue_comments',
            retryAt: new Date('2026-06-25T03:00:00.000Z'),
          },
        ],
      },
    );
    fakes.incrementalSync.mockImplementationOnce(
      async ({ ctx }: { ctx: TimelineShared.integrations.SyncContext }) => {
        await ctx.saveCursor('github.repo:acme/repo-a:issue_comments', {
          issue_comments_since: '2026-06-25T02:58:00.000Z',
          issue_comments_continuation: { page: 2, phase: 'drain' },
        });
        throw err;
      },
    );

    try {
      await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
        'GitHub temporarily overloaded while syncing acme/repo-b',
      );
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.adminMarkSynced).not.toHaveBeenCalled();
    expect(fakes.adminCommitIntegrationSyncCheckpoint).toHaveBeenCalledWith(expect.anything(), {
      integrationId: INTEGRATION_ID,
      cursors: [
        {
          resourceType: 'github.repo:acme/repo-a:issue_comments',
          cursor: {
            issue_comments_since: '2026-06-25T02:58:00.000Z',
            issue_comments_continuation: { page: 2, phase: 'drain' },
          },
        },
      ],
      continuations: [
        {
          resourceType: 'github.repo',
          externalId: 'acme/repo-a',
          surface: 'issue_comments',
          retryAt: new Date('2026-06-25T03:00:00.000Z'),
        },
      ],
    });
    expect(fakes.pendingContinuationHandoffs.map((handoff) => handoff.continuation)).toEqual([
      {
        resourceType: 'github.repo',
        externalId: 'acme/repo-a',
        surface: 'issue_comments',
        retryAt: new Date('2026-06-25T03:00:00.000Z'),
      },
    ]);
  });

  it('propagates an ordinary failure before any surface continuation is available', async () => {
    fakes.incrementalSync.mockRejectedValueOnce(
      new Error('GitHub unavailable before surface sync'),
    );

    await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
      'GitHub unavailable before surface sync',
    );

    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('replays a generic targeted failure from the durable continuation outbox', async () => {
    const target = {
      kind: 'targeted' as const,
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'issue_comments',
      reason: 'provider_pagination_continuation',
    };
    const err = Object.assign(new Error('GitHub temporarily overloaded'), {
      syncContinuations: [
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'pr_review_comments',
        },
      ],
    });
    fakes.adminListSelections.mockResolvedValue([{ kind: 'github.repo', externalId: 'acme/app' }]);
    fakes.incrementalSync.mockRejectedValue(err);

    await expect(
      runOneIntegration({} as never, INTEGRATION_ID, 'targeted', target),
    ).rejects.toThrow('GitHub temporarily overloaded');

    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
    expect(fakes.adminRecordTransientSyncFailure).toHaveBeenCalledTimes(1);

    await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', target);

    expect(fakes.incrementalSync).toHaveBeenCalledTimes(1);
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledTimes(2);
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
        reason: 'provider_pagination_continuation',
      }),
    );
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'pr_review_comments',
        reason: 'provider_pagination_continuation',
      }),
    );
  });

  it('requeues a blocked provider pagination continuation after a short bounded delay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T03:00:00.000Z'));
    fakes.reserved.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('pg_try_advisory_lock')) return Promise.resolve([{ locked: false }]);
      return Promise.resolve([]);
    });
    const continuation = {
      kind: 'targeted' as const,
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      reason: 'provider_pagination_continuation',
    };

    try {
      await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', continuation);
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.adminLoadIntegration).not.toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      {
        ...continuation,
        continuationAttempt: 1,
        continuationHandoffId: continuationHandoffId(1),
      },
      { delayMs: 5_000 },
    );
    expect(fakes.reserved.release).toHaveBeenCalledOnce();
  });

  it('propagates a failed lock-contention continuation handoff for BullMQ retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T03:00:00.000Z'));
    fakes.reserved.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('pg_try_advisory_lock')) return Promise.resolve([{ locked: false }]);
      return Promise.resolve([]);
    });
    fakes.enqueueIntegrationSyncJob.mockRejectedValueOnce(new Error('Redis unavailable'));
    const handoff = {
      handoffId: '99999999-9999-4999-8999-999999999999',
      claimToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      continuation: {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        retryAt: new Date('2026-06-25T03:00:05.000Z'),
        continuationAttempt: 1,
      },
    };
    fakes.adminClaimPendingIntegrationSyncContinuations.mockResolvedValueOnce([handoff]);

    try {
      await expect(
        runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
          kind: 'targeted',
          integrationId: INTEGRATION_ID,
          teamId: TEAM_ID,
          triggeredBy: 'reconcile',
          resourceType: 'github.repo',
          externalId: 'acme/app',
          reason: 'provider_pagination_continuation',
        }),
      ).rejects.toThrow('Redis unavailable');
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.adminRecordPendingIntegrationSyncContinuations).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      [
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          retryAt: new Date('2026-06-25T03:00:05.000Z'),
          continuationAttempt: 1,
        },
      ],
    );
    expect(fakes.adminAcknowledgePendingIntegrationSyncContinuation).not.toHaveBeenCalled();
    expect(fakes.adminReleasePendingIntegrationSyncContinuation).toHaveBeenCalledWith(
      expect.anything(),
      handoff.handoffId,
      handoff.claimToken,
    );
  });

  it('propagates a failed durable lock-contention continuation handoff for BullMQ retry', async () => {
    fakes.reserved.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('pg_try_advisory_lock')) return Promise.resolve([{ locked: false }]);
      return Promise.resolve([]);
    });
    fakes.enqueueIntegrationSyncJob.mockRejectedValueOnce(new Error('Redis unavailable'));
    fakes.adminClaimPendingIntegrationSyncContinuations.mockResolvedValueOnce([
      {
        handoffId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        claimToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        continuation: {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          retryAt: new Date('2026-06-25T03:01:00.000Z'),
          continuationAttempt: 3,
        },
      },
    ]);

    await expect(
      runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        reason: 'provider_pagination_continuation',
        continuationAttempt: 3,
      }),
    ).rejects.toThrow('Redis unavailable');
  });

  it('moves a lock-blocked continuation to a durable delayed retry after bounded short retries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T03:00:00.000Z'));
    fakes.reserved.mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('pg_try_advisory_lock')) return Promise.resolve([{ locked: false }]);
      return Promise.resolve([]);
    });

    try {
      await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        reason: 'provider_pagination_continuation',
        continuationAttempt: 3,
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      {
        kind: 'targeted',
        integrationId: INTEGRATION_ID,
        teamId: TEAM_ID,
        triggeredBy: 'reconcile',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        reason: 'provider_pagination_continuation',
        continuationAttempt: 3,
        continuationHandoffId: continuationHandoffId(1),
      },
      { delayMs: 60_000 },
    );
    expect(fakes.reserved.release).toHaveBeenCalledOnce();
  });

  it('keeps legacy Monday connections syncing while surfacing reconnect for missing scopes', async () => {
    fakes.adminLoadIntegration.mockResolvedValueOnce({
      ...integration,
      provider: 'monday',
      scopes: ['boards:read', 'users:read', 'updates:read', 'docs:read'],
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.incrementalSync).toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_degraded:missing_provider_scopes',
      {
        provider: 'monday',
        missingScopes: ['account:read', 'webhooks:read', 'webhooks:write'],
      },
      { integrationId: INTEGRATION_ID },
    );
    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'needs_reconnect',
      summary:
        'monday connection is missing required OAuth scopes (account:read, webhooks:read, webhooks:write); reconnect to enable webhook provisioning and account-scoped provider budgets.',
    });
    expect(fakes.adminResolveConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      categories: ['sync_error'],
    });
  });

  it('skips targeted syncs for resources outside the selected source set', async () => {
    fakes.adminListSelections.mockResolvedValueOnce([{ kind: 'github.org', externalId: 'acme' }]);

    await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', {
      kind: 'targeted',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'webhook',
      resourceType: 'github.repo',
      externalId: 'other/app',
      reason: 'github_repo_webhook',
    });

    expect(fakes.incrementalSync).not.toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_skipped:targeted',
      expect.objectContaining({
        provider: 'github',
        resourceType: 'github.repo',
        externalId: 'other/app',
        reason: 'resource_not_selected',
      }),
      { integrationId: INTEGRATION_ID },
    );
  });

  it('classifies provider auth and access failures as reconnect-needed attention', async () => {
    fakes.incrementalSync.mockRejectedValueOnce(
      new Error('GitHub GET /repos/acme/app: 403 forbidden'),
    );

    await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
      '403 forbidden',
    );

    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      expect.objectContaining({
        providerConnectionId: CONNECTION_ID,
        integrationId: INTEGRATION_ID,
        category: 'needs_reconnect',
      }),
    );
  });

  it('classifies GitHub pull-request permission partial syncs as reconnect-needed attention', async () => {
    const errorMessage =
      'acme/app:prs:open (Pull requests read permission required; update GitHub App repository permissions and reconnect)';
    fakes.incrementalSync.mockResolvedValueOnce({
      partialFailures: [
        {
          resource: 'acme/app',
          surface: 'prs',
          area: 'open',
          error:
            'Pull requests read permission required; update GitHub App repository permissions and reconnect',
        },
      ],
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminMarkSynced).not.toHaveBeenCalled();
    expect(fakes.adminRecordError).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      errorMessage,
    );
    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      expect.objectContaining({
        providerConnectionId: CONNECTION_ID,
        integrationId: INTEGRATION_ID,
        category: 'needs_reconnect',
        summary: errorMessage,
      }),
    );
    expect(fakes.adminRecordTransientSyncFailure).not.toHaveBeenCalled();
    expect(fakes.adminResolveConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminResetTransientSyncFailures).not.toHaveBeenCalled();
  });

  it('classifies mixed provider partial failures independently after preserving sync progress', async () => {
    const combinedSummary =
      'acme/app:prs:open (Pull requests read permission required; update GitHub App repository permissions and reconnect); acme/app:releases:page-2 (GitHub releases page temporarily overloaded)';
    const authSummary =
      'acme/app:prs:open (Pull requests read permission required; update GitHub App repository permissions and reconnect)';
    const transientSummary =
      'acme/app:releases:page-2 (GitHub releases page temporarily overloaded)';
    fakes.incrementalSync.mockResolvedValueOnce({
      partialFailures: [
        {
          resource: 'acme/app',
          surface: 'prs',
          area: 'open',
          error:
            'Pull requests read permission required; update GitHub App repository permissions and reconnect',
        },
        {
          resource: 'acme/app',
          surface: 'releases',
          area: 'page-2',
          error: 'GitHub releases page temporarily overloaded',
        },
      ],
    });
    fakes.adminRecordTransientSyncFailure.mockResolvedValueOnce({
      count: 3,
      shouldCreateAttention: true,
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminMarkSynced).not.toHaveBeenCalled();
    expect(fakes.adminRecordError).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      combinedSummary,
    );
    expect(fakes.adminRecordTransientSyncFailure).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      transientSummary,
    );
    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'needs_reconnect',
      summary: authSummary,
    });
    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      category: 'sync_error',
      summary: transientSummary,
    });
    expect(fakes.adminResetTransientSyncFailures).not.toHaveBeenCalled();
    expect(fakes.adminResolveConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_finished:incremental',
      { provider: 'github' },
      { integrationId: INTEGRATION_ID },
    );
  });

  it('keeps non-auth partial syncs visible without reconnect attention', async () => {
    const errorMessage = 'acme/app:prs:reviews:42 (GitHub temporarily overloaded)';
    fakes.incrementalSync.mockResolvedValueOnce({
      partialFailures: [
        {
          resource: 'acme/app',
          surface: 'prs',
          area: 'reviews:42',
          error: 'GitHub temporarily overloaded',
        },
      ],
    });
    fakes.adminRecordTransientSyncFailure.mockResolvedValueOnce({
      count: 1,
      shouldCreateAttention: false,
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminRecordError).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      errorMessage,
    );
    expect(fakes.adminRecordTransientSyncFailure).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      errorMessage,
    );
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminResolveConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminResetTransientSyncFailures).not.toHaveBeenCalled();
  });

  it('does not create sync_error attention for the first two transient provider failures', async () => {
    fakes.incrementalSync.mockRejectedValueOnce(new Error('GitHub temporarily overloaded'));
    fakes.adminRecordTransientSyncFailure.mockResolvedValueOnce({
      count: 2,
      shouldCreateAttention: false,
    });

    await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
      'temporarily overloaded',
    );

    expect(fakes.adminRecordTransientSyncFailure).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      'GitHub temporarily overloaded',
    );
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
  });

  it('does not classify unrelated required-field provider errors as reconnect-needed', async () => {
    fakes.incrementalSync.mockRejectedValueOnce(new Error('GitHub required field missing'));
    fakes.adminRecordTransientSyncFailure.mockResolvedValueOnce({
      count: 1,
      shouldCreateAttention: false,
    });

    await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
      'required field missing',
    );

    expect(fakes.adminRecordTransientSyncFailure).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      'GitHub required field missing',
    );
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
  });

  it('records GitHub rate limits as a paused sync without BullMQ retry pressure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:59:00.000Z'));
    const retryAt = new Date('2026-06-25T03:00:00.000Z');
    const err = Object.assign(
      new Error(
        'github_rate_limited: GitHub API rate limit reached; retry after 2026-06-25T03:00:00.000Z',
      ),
      {
        code: 'github_rate_limited',
        retryAt,
      },
    );
    fakes.incrementalSync.mockRejectedValueOnce(err);
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'github.repo', externalId: 'acme/app' },
    ]);
    const target = {
      kind: 'targeted' as const,
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'reconcile',
      resourceType: 'github.repo',
      externalId: 'acme/app',
      surface: 'issue_comments',
      reason: 'provider_pagination_continuation',
    };

    try {
      await runOneIntegration({} as never, INTEGRATION_ID, 'targeted', target);
    } finally {
      vi.useRealTimers();
    }

    expect(fakes.adminRecordError).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      err.message,
    );
    expect(fakes.adminRecordIntegrationSyncPause).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      {
        retryAt,
        reason: 'github_rate_limited',
        error: err.message,
      },
    );
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminRecordTransientSyncFailure).not.toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      { ...target, continuationHandoffId: continuationHandoffId(1) },
      { delayMs: 60_000 },
    );
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_paused:targeted',
      {
        provider: 'github',
        reason: 'github_rate_limited',
        retryAt: retryAt.toISOString(),
      },
      { integrationId: INTEGRATION_ID },
    );
  });

  it('records Slack Web API rate limits as provider budget pauses', async () => {
    fakes.adminLoadIntegration.mockResolvedValueOnce({
      ...integration,
      provider: 'slack',
      externalAccountId: 'T123',
    });
    const retryAt = new Date('2026-06-28T01:02:00.000Z');
    const err = Object.assign(
      new Error(
        'slack_rate_limited: Slack Web API conversations.history limited; retry after 2026-06-28T01:02:00.000Z',
      ),
      {
        code: 'provider_rate_limited',
        provider: 'slack',
        retryAt,
        retryAfterSeconds: 120,
        scope: 'web_api',
        reason: 'slack_rate_limited',
      },
    );
    fakes.incrementalSync.mockRejectedValueOnce(err);

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminRecordIntegrationSyncPause).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      expect.objectContaining({
        retryAt,
        reason: 'slack_rate_limited',
      }),
    );
    expect(fakes.adminRecordProviderBudgetPause).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'slack',
        externalAccountId: 'T123',
        scope: 'web_api',
      }),
      expect.objectContaining({
        pausedUntil: retryAt,
        reason: 'slack_rate_limited',
      }),
    );
    expect(fakes.adminRecordTransientSyncFailure).not.toHaveBeenCalled();
  });

  it('runs native Slack sync through the worker context and writes selected-channel events', async () => {
    fakes.adminLoadIntegration.mockResolvedValueOnce({
      ...integration,
      provider: 'slack',
      externalAccountId: 'T123',
    });
    fakes.adminDecryptIntegrationTokens.mockResolvedValueOnce({
      access_token: 'xoxb-token',
      team: { id: 'T123', name: 'Acme' },
    });
    fakes.adminListSelections.mockResolvedValueOnce([
      { kind: 'slack.channel', externalId: 'C123', label: '#leadership' },
    ]);
    fakes.adminLoadCursor.mockResolvedValueOnce({ latest_ts: '1781999999.000000' });
    fakes.getProvider.mockReturnValueOnce(integrations.slackProvider);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input, init) => {
        if (typeof input !== 'string') throw new Error('expected Slack URL string');
        if (!input.endsWith('/conversations.history')) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true, messages: [] }), {
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        const body = init?.body;
        if (typeof body !== 'string') throw new Error('expected Slack form body');
        const params = new URLSearchParams(body);
        expect(params.get('channel')).toBe('C123');
        expect(params.get('oldest')).toBe('1780790399.000000');
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              messages: [
                {
                  type: 'message',
                  user: 'U123',
                  username: 'Ada',
                  text: 'Slack-native worker sync captured the customer handoff',
                  ts: '1782000000.000100',
                },
              ],
              response_metadata: {},
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    const writeCall = fakes.writeIntegrationEvents.mock.calls[0] as
      | [TestWriteIntegrationEventsInput]
      | undefined;
    const writeInput = writeCall?.[0];
    expect(writeInput?.db).toBeDefined();
    expect(writeInput?.integration).toMatchObject({
      provider: 'slack',
      externalAccountId: 'T123',
    });
    expect(writeInput?.events).toHaveLength(1);
    const event = writeInput?.events[0];
    expect(event).toMatchObject({
      dedupKey: 'slack:message:T123:C123:1782000000.000100:',
      provider: 'slack',
      eventType: 'message.created',
      externalObjectId: 'C123:1782000000.000100',
      contentText: 'Slack-native worker sync captured the customer handoff',
    });
    expect(event?.extra).toMatchObject({
      slack_team_id: 'T123',
      slack_channel_id: 'C123',
      external_url: 'https://slack.com/archives/C123/p1782000000000100',
    });
    expect(fakes.adminSaveCursor).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      'slack.channel:C123',
      { latest_ts: '1782000000.000100' },
      undefined,
    );
    expect(fakes.adminCommitIntegrationSyncCheckpoint).toHaveBeenCalledWith(expect.anything(), {
      integrationId: INTEGRATION_ID,
      cursors: [
        {
          resourceType: 'slack.channel:C123',
          cursor: { latest_ts: '1782000000.000100' },
        },
      ],
      continuations: [],
      markSynced: {},
    });
    expect(fakes.adminResetTransientSyncFailures).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
    );
  });

  it('records GitHub installation rate limits against the installation budget owner', async () => {
    const retryAt = new Date('2026-06-25T03:00:00.000Z');
    const err = Object.assign(
      new Error(
        'github_rate_limited: GitHub API rate limit reached; retry after 2026-06-25T03:00:00.000Z',
      ),
      {
        code: 'github_rate_limited',
        retryAt,
        rateLimitKind: 'primary',
        externalAccountId: 'installation:123',
      },
    );
    fakes.incrementalSync.mockRejectedValueOnce(err);

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminRecordProviderBudgetPause).toHaveBeenCalledWith(
      expect.anything(),
      {
        provider: 'github',
        appKey: 'github',
        externalAccountId: 'installation:123',
        scope: 'primary',
      },
      {
        pausedUntil: retryAt,
        reason: 'github_rate_limited',
        resetAt: retryAt,
      },
    );
  });

  it('records provider-neutral rate limits as a paused sync without attention', async () => {
    const retryAt = new Date('2026-06-25T02:02:00.000Z');
    const err = Object.assign(new Error('monday_rate_limited: Monday API DAILY_LIMIT_EXCEEDED'), {
      provider: 'monday',
      retryAt,
      retryAfterSeconds: 120,
      scope: 'daily',
      reason: 'daily_limit_exceeded',
    });
    fakes.adminLoadIntegration.mockResolvedValueOnce({
      ...integration,
      provider: 'monday',
      externalAccountId: 'monday-account-1',
      scopes: [
        'boards:read',
        'users:read',
        'updates:read',
        'docs:read',
        'account:read',
        'webhooks:read',
        'webhooks:write',
      ],
    });
    fakes.incrementalSync.mockRejectedValueOnce(err);

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminRecordError).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      err.message,
    );
    expect(fakes.adminRecordIntegrationSyncPause).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
      {
        retryAt,
        reason: 'daily_limit_exceeded',
        error: err.message,
      },
    );
    expect(fakes.adminRecordProviderBudgetPause).toHaveBeenCalledWith(
      expect.anything(),
      {
        provider: 'monday',
        appKey: 'monday',
        externalAccountId: 'monday-account-1',
        scope: 'daily',
      },
      {
        pausedUntil: retryAt,
        reason: 'daily_limit_exceeded',
        resetAt: retryAt,
      },
    );
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminRecordTransientSyncFailure).not.toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_paused:incremental',
      {
        provider: 'monday',
        reason: 'daily_limit_exceeded',
        scope: 'daily',
        retryAt: retryAt.toISOString(),
      },
      { integrationId: INTEGRATION_ID },
    );
  });

  it('skips provider work while a recorded sync pause is active', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fakes.adminLoadIntegrationSyncPause.mockResolvedValueOnce({
      retryAt,
      reason: 'github_rate_limited',
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.incrementalSync).not.toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_skipped:incremental',
      {
        provider: 'github',
        reason: 'github_rate_limited',
        retryAt: retryAt.toISOString(),
      },
      { integrationId: INTEGRATION_ID },
    );
  });

  it('skips provider work while a provider account budget pause is active', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fakes.adminLoadIntegration.mockResolvedValueOnce({
      ...integration,
      provider: 'monday',
      externalAccountId: 'monday-account-1',
    });
    fakes.adminLoadProviderBudgetPause.mockResolvedValueOnce({
      retryAt,
      reason: 'daily_limit_exceeded',
      scope: 'daily',
    });

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.incrementalSync).not.toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_skipped:incremental',
      {
        provider: 'monday',
        reason: 'daily_limit_exceeded',
        scope: 'daily',
        retryAt: retryAt.toISOString(),
      },
      { integrationId: INTEGRATION_ID },
    );
  });

  it('skips GitHub provider work while an installation budget pause is active', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    fakes.adminLoadIntegration.mockResolvedValueOnce({
      ...integration,
      externalAccountId: 'github-user-42',
    });
    fakes.adminDecryptIntegrationTokens.mockResolvedValueOnce({
      access_token: 'ghu_user',
      github_app_installations: [{ id: '123', account_login: 'acme' }],
    });
    fakes.adminLoadProviderBudgetPause.mockImplementation(
      (_db: unknown, key: { externalAccountId?: string }) =>
        Promise.resolve(
          key.externalAccountId === 'installation:123'
            ? { retryAt, reason: 'github_rate_limited', scope: 'primary' }
            : null,
        ),
    );

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.incrementalSync).not.toHaveBeenCalled();
    expect(fakes.adminLoadProviderBudgetPause).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'github',
        externalAccountId: 'installation:123',
      }),
    );
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_skipped:incremental',
      {
        provider: 'github',
        reason: 'github_rate_limited',
        scope: 'primary',
        retryAt: retryAt.toISOString(),
      },
      { integrationId: INTEGRATION_ID },
    );
  });

  it('creates sync_error attention on the third consecutive transient provider failure', async () => {
    fakes.incrementalSync.mockRejectedValueOnce(new Error('GitHub temporarily overloaded'));
    fakes.adminRecordTransientSyncFailure.mockResolvedValueOnce({
      count: 3,
      shouldCreateAttention: true,
    });

    await expect(runOneIntegration({} as never, INTEGRATION_ID, 'incremental')).rejects.toThrow(
      'temporarily overloaded',
    );

    expect(fakes.adminRecordConnectionAttention).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      expect.objectContaining({
        providerConnectionId: CONNECTION_ID,
        integrationId: INTEGRATION_ID,
        category: 'sync_error',
      }),
    );
  });

  it('resets transient failure state and resolves reconnect/sync attention after a successful sync', async () => {
    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.adminResetTransientSyncFailures).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_ID,
    );
    expect(fakes.adminResolveConnectionAttention).toHaveBeenCalledWith(expect.anything(), TEAM_ID, {
      providerConnectionId: CONNECTION_ID,
      integrationId: INTEGRATION_ID,
      categories: ['needs_reconnect', 'sync_error'],
    });
  });

  it('mounts document harvest for monday integrations with an active connector owner', async () => {
    fakes.adminLoadIntegration.mockResolvedValueOnce({ ...integration, provider: 'monday' });
    fakes.incrementalSync.mockImplementationOnce(
      ({ ctx }: { ctx: { harvestDocument?: unknown } }) => {
        expect(ctx.harvestDocument).toEqual(expect.any(Function));
        return Promise.resolve();
      },
    );

    await runOneIntegration({} as never, INTEGRATION_ID, 'incremental');

    expect(fakes.incrementalSync).toHaveBeenCalled();
  });
});
