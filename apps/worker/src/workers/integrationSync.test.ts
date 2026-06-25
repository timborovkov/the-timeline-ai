import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TimelineDb from '@timeline/db';
import type * as TimelineShared from '@timeline/shared';

// Integration sync workers are the first durable signal that a provider
// connection needs human action. These tests keep owner-left, reconnect, and
// transient-failure attention categories honest without depending on Redis.

const fakes = vi.hoisted(() => {
  const reserved = vi.fn(() => Promise.resolve([{ locked: true }])) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<{ locked: boolean }[]>;
    mockClear: () => void;
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
    adminMarkSynced: vi.fn(),
    adminResetTransientSyncFailures: vi.fn(),
    adminLoadIntegrationSyncPause: vi.fn(),
    adminRecordIntegrationSyncPause: vi.fn(),
    adminResolveConnectionAttention: vi.fn(),
    adminRecordTransientSyncFailure: vi.fn(),
    getProvider: vi.fn(),
    incrementalSync: vi.fn(),
    enqueueIntegrationSyncJob: vi.fn(),
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
      adminMarkSynced: fakes.adminMarkSynced,
      adminResetTransientSyncFailures: fakes.adminResetTransientSyncFailures,
      adminLoadIntegrationSyncPause: fakes.adminLoadIntegrationSyncPause,
      adminRecordIntegrationSyncPause: fakes.adminRecordIntegrationSyncPause,
      adminResolveConnectionAttention: fakes.adminResolveConnectionAttention,
      adminRecordTransientSyncFailure: fakes.adminRecordTransientSyncFailure,
      getProvider: fakes.getProvider,
    },
    queue: {
      ...actual.queue,
      enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
    },
  };
});

const { handleTick, runOneIntegration } = await import('./integrationSync.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

const integration = {
  id: INTEGRATION_ID,
  teamId: TEAM_ID,
  connectedByUserId: USER_ID,
  providerConnectionId: CONNECTION_ID,
  provider: 'github',
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.reserved.mockClear();
  fakes.reserved.release.mockClear();
  fakes.getDbClient.mockReturnValue({ reserve: vi.fn(() => Promise.resolve(fakes.reserved)) });
  fakes.adminLoadIntegration.mockResolvedValue(integration);
  fakes.adminListEnabledIntegrations.mockResolvedValue([]);
  fakes.adminVerifyTeamMember.mockResolvedValue(true);
  fakes.adminDecryptIntegrationTokens.mockResolvedValue({ access_token: 'token' });
  fakes.adminListSelections.mockResolvedValue([]);
  fakes.adminRecordAudit.mockResolvedValue(undefined);
  fakes.adminRecordError.mockResolvedValue(undefined);
  fakes.adminRecordConnectionAttention.mockResolvedValue(undefined);
  fakes.adminMarkSynced.mockResolvedValue(undefined);
  fakes.adminResetTransientSyncFailures.mockResolvedValue(undefined);
  fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);
  fakes.adminRecordIntegrationSyncPause.mockResolvedValue(undefined);
  fakes.adminResolveConnectionAttention.mockResolvedValue(undefined);
  fakes.adminRecordTransientSyncFailure.mockResolvedValue({
    count: 1,
    shouldCreateAttention: false,
  });
  fakes.incrementalSync.mockResolvedValue(undefined);
  fakes.getProvider.mockReturnValue({ incrementalSync: fakes.incrementalSync });
  fakes.enqueueIntegrationSyncJob.mockResolvedValue(undefined);
});

describe('handleTick GitHub background cadence', () => {
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

  it('throttles recently synced GitHub integrations while leaving other providers alone', async () => {
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([
      { ...integration, provider: 'github', lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000) },
      { ...integration, id: '55555555-5555-4555-8555-555555555555', provider: 'linear' },
    ]);
    fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);

    await handleTick({} as never);

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledTimes(1);
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: '55555555-5555-4555-8555-555555555555',
      teamId: TEAM_ID,
      triggeredBy: 'tick',
    });
  });

  it('enqueues GitHub again after the slower background interval elapses', async () => {
    fakes.adminListEnabledIntegrations.mockResolvedValueOnce([
      { ...integration, lastSyncedAt: new Date(Date.now() - 61 * 60 * 1000) },
    ]);
    fakes.adminLoadIntegrationSyncPause.mockResolvedValue(null);

    await handleTick({} as never);

    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
      triggeredBy: 'tick',
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

    expect(fakes.adminMarkSynced).toHaveBeenCalledWith(expect.anything(), INTEGRATION_ID);
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
    const retryAt = new Date('2026-06-25T03:00:00.000Z');
    const err = Object.assign(
      new Error(
        'github_rate_limited: GitHub API rate limit reached; retry after 2026-06-25T03:00:00.000Z',
      ),
      { code: 'github_rate_limited', retryAt },
    );
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
        reason: 'github_rate_limited',
        error: err.message,
      },
    );
    expect(fakes.adminRecordConnectionAttention).not.toHaveBeenCalled();
    expect(fakes.adminRecordTransientSyncFailure).not.toHaveBeenCalled();
    expect(fakes.adminRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      'sync_paused:incremental',
      {
        provider: 'github',
        reason: 'github_rate_limited',
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
