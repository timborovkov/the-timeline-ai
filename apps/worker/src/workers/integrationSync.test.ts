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
    adminVerifyTeamMember: vi.fn(),
    adminRecordError: vi.fn(),
    adminRecordConnectionAttention: vi.fn(),
    adminDecryptIntegrationTokens: vi.fn(),
    adminListSelections: vi.fn(),
    adminRecordAudit: vi.fn(),
    adminMarkSynced: vi.fn(),
    adminResetTransientSyncFailures: vi.fn(),
    adminResolveConnectionAttention: vi.fn(),
    adminRecordTransientSyncFailure: vi.fn(),
    getProvider: vi.fn(),
    incrementalSync: vi.fn(),
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
      adminVerifyTeamMember: fakes.adminVerifyTeamMember,
      adminRecordError: fakes.adminRecordError,
      adminRecordConnectionAttention: fakes.adminRecordConnectionAttention,
      adminDecryptIntegrationTokens: fakes.adminDecryptIntegrationTokens,
      adminListSelections: fakes.adminListSelections,
      adminRecordAudit: fakes.adminRecordAudit,
      adminMarkSynced: fakes.adminMarkSynced,
      adminResetTransientSyncFailures: fakes.adminResetTransientSyncFailures,
      adminResolveConnectionAttention: fakes.adminResolveConnectionAttention,
      adminRecordTransientSyncFailure: fakes.adminRecordTransientSyncFailure,
      getProvider: fakes.getProvider,
    },
  };
});

const { runOneIntegration } = await import('./integrationSync.js');

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
  fakes.adminVerifyTeamMember.mockResolvedValue(true);
  fakes.adminDecryptIntegrationTokens.mockResolvedValue({ access_token: 'token' });
  fakes.adminListSelections.mockResolvedValue([]);
  fakes.adminRecordAudit.mockResolvedValue(undefined);
  fakes.adminRecordError.mockResolvedValue(undefined);
  fakes.adminRecordConnectionAttention.mockResolvedValue(undefined);
  fakes.adminMarkSynced.mockResolvedValue(undefined);
  fakes.adminResetTransientSyncFailures.mockResolvedValue(undefined);
  fakes.adminResolveConnectionAttention.mockResolvedValue(undefined);
  fakes.adminRecordTransientSyncFailure.mockResolvedValue({
    count: 1,
    shouldCreateAttention: false,
  });
  fakes.incrementalSync.mockResolvedValue(undefined);
  fakes.getProvider.mockReturnValue({ incrementalSync: fakes.incrementalSync });
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
});
