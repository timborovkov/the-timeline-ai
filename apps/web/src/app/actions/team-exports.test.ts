import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  auditRecord: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
  dbSelect: vi.fn(),
  enqueueTeamExportJob: vi.fn(),
  requireRedisQueue: vi.fn(),
  getSignedGetObjectUrl: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  reportCaughtError: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({
  db: {
    insert: fakes.dbInsert,
    update: fakes.dbUpdate,
    select: fakes.dbSelect,
  },
}));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.requireRedisQueue }));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/sentry-action', () => ({
  runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    audit: { record: fakes.auditRecord },
  }),
}));
vi.mock('@timeline/shared/s3', () => ({
  getExportsBucket: () => 'exports',
  getS3PresignClient: () => ({ client: 's3' }),
  getSignedGetObjectUrl: fakes.getSignedGetObjectUrl,
}));

const { createTeamExportAction, downloadTeamExportAction } = await import('./team-exports.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const EXPORT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-07-02T12:00:00.000Z');

interface TeamExportInsert {
  teamId: string;
  requestedByUserId: string;
  status: string;
  manifest: Record<string, unknown>;
  omissions: Record<string, unknown>;
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function installDbMocks(
  input: {
    insertReturnIds?: string[];
    selectRows?: unknown[];
    inserts?: unknown[];
    updates?: unknown[];
  } = {},
): void {
  const insertReturnIds = [...(input.insertReturnIds ?? [EXPORT_ID])];
  const inserts = input.inserts ?? [];
  const updates = input.updates ?? [];
  fakes.dbInsert.mockReturnValue({
    values: vi.fn((value: unknown) => {
      inserts.push(value);
      const id = insertReturnIds.shift();
      return {
        returning: vi.fn().mockResolvedValue(id ? [{ id }] : []),
      };
    }),
  });
  fakes.dbUpdate.mockReturnValue({
    set: vi.fn((value: unknown) => {
      updates.push(value);
      return { where: vi.fn(() => Promise.resolve()) };
    }),
  });
  fakes.dbSelect.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(input.selectRows ?? [])),
      })),
    })),
  });
}

function teamExportInsert(value: unknown): TeamExportInsert {
  if (!value || typeof value !== 'object' || !('teamId' in value)) {
    throw new Error('expected team export insert payload');
  }
  return value as TeamExportInsert;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  fakes.auth.mockResolvedValue({
    user: { id: USER_ID, name: 'Ada', email: 'ada@example.test' },
  });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.requireRedisQueue.mockResolvedValue({ enqueueTeamExportJob: fakes.enqueueTeamExportJob });
  fakes.enqueueTeamExportJob.mockResolvedValue(undefined);
  fakes.getSignedGetObjectUrl.mockResolvedValue('https://signed.example.test/export.zip');
  installDbMocks();
});

describe('team export actions', () => {
  it('rejects create requests without auth, active team, or admin access', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    await expect(createTeamExportAction({}, new FormData())).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    await expect(createTeamExportAction({}, new FormData())).resolves.toEqual({
      error: 'No active team',
    });

    const err = new Error('member_only');
    fakes.requireMembership.mockRejectedValueOnce(err);
    await expect(createTeamExportAction({}, new FormData())).resolves.toEqual({
      error: 'Only owners and admins can export team data',
    });
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'create_team_export_auth',
    });
    expect(fakes.dbInsert).not.toHaveBeenCalled();
  });

  it('creates a queued export, audits it, enqueues worker work, tracks analytics, and revalidates', async () => {
    const inserts: unknown[] = [];
    installDbMocks({ inserts });

    await expect(createTeamExportAction({}, new FormData())).resolves.toEqual({ ok: true });

    expect(fakes.requireMembership).toHaveBeenCalledWith('admin');
    const exportInsert = teamExportInsert(inserts[0]);
    expect(exportInsert).toEqual({
      teamId: TEAM_ID,
      requestedByUserId: USER_ID,
      status: 'queued',
      manifest: {},
      omissions: {},
    });
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'team.export_create',
      targetType: 'team_export',
      targetId: EXPORT_ID,
      metadata: { mode: 'single', outcome: 'queued' },
    });
    expect(fakes.enqueueTeamExportJob).toHaveBeenCalledWith({
      teamExportId: EXPORT_ID,
      teamId: TEAM_ID,
      requestedByUserId: USER_ID,
    });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_export_requested',
      {},
    );
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team');
  });

  it('marks the export failed when the queue enqueue fails', async () => {
    const updates: unknown[] = [];
    const err = new Error('redis unavailable');
    installDbMocks({ updates });
    fakes.enqueueTeamExportJob.mockRejectedValueOnce(err);

    await expect(createTeamExportAction({}, new FormData())).resolves.toEqual({
      error: 'Export was created but could not be queued',
    });

    expect(fakes.reportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'create_team_export_enqueue',
    });
    expect(updates[0]).toMatchObject({
      status: 'failed',
      error: 'redis unavailable',
    });
    expect(updates[0]).toHaveProperty('completedAt');
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'team.export_create',
      targetType: 'team_export',
      targetId: EXPORT_ID,
      metadata: { mode: 'single', outcome: 'enqueue_failed' },
    });
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team');
  });

  it('redirects download attempts without auth, active team, valid input, or admin access', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    await expect(downloadTeamExportAction(form({ exportId: EXPORT_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in',
    );

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    await expect(downloadTeamExportAction(form({ exportId: EXPORT_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in',
    );

    await expect(downloadTeamExportAction(new FormData())).rejects.toThrow(
      'NEXT_REDIRECT:/app/team?section=exports&exportError=invalid',
    );

    const err = new Error('member_only');
    fakes.requireMembership.mockRejectedValueOnce(err);
    await expect(downloadTeamExportAction(form({ exportId: EXPORT_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/team?section=exports&exportError=forbidden',
    );
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'download_team_export_auth',
    });
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'team.export_download',
      targetType: 'team_export',
      targetId: EXPORT_ID,
      metadata: { mode: 'single', outcome: 'rejected', reason: 'forbidden' },
    });
  });

  it('redirects when the export is not ready and expires rows with near-zero TTL', async () => {
    installDbMocks({ selectRows: [{ id: EXPORT_ID, status: 'failed' }] });
    await expect(downloadTeamExportAction(form({ exportId: EXPORT_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/team?section=exports&exportError=unavailable',
    );
    expect(fakes.getSignedGetObjectUrl).not.toHaveBeenCalled();
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'team.export_download',
      targetType: 'team_export',
      targetId: EXPORT_ID,
      metadata: { mode: 'single', outcome: 'rejected', reason: 'not_ready_or_missing' },
    });

    const updates: unknown[] = [];
    installDbMocks({
      updates,
      selectRows: [
        {
          id: EXPORT_ID,
          status: 'ready',
          objectKey: 'exports/archive.zip',
          expiresAt: new Date(NOW.getTime() + 1_000),
        },
      ],
    });
    await expect(downloadTeamExportAction(form({ exportId: EXPORT_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/team?section=exports&exportError=unavailable',
    );
    expect(updates.at(-1)).toMatchObject({ status: 'expired' });
    expect(fakes.getSignedGetObjectUrl).not.toHaveBeenCalled();
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'team.export_download',
      targetType: 'team_export',
      targetId: EXPORT_ID,
      metadata: { mode: 'single', outcome: 'rejected', reason: 'expired' },
    });
  });

  it('signs ready exports, writes an audit row, and redirects to the signed URL', async () => {
    const inserts: unknown[] = [];
    const expiresAt = new Date(NOW.getTime() + 60 * 60 * 1000);
    installDbMocks({
      inserts,
      selectRows: [
        {
          id: EXPORT_ID,
          status: 'ready',
          objectKey: 'teams/acme/export.zip',
          expiresAt,
        },
      ],
    });

    await expect(downloadTeamExportAction(form({ exportId: EXPORT_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:https://signed.example.test/export.zip',
    );

    expect(fakes.getSignedGetObjectUrl).toHaveBeenCalledWith(
      { client: 's3' },
      'exports',
      'teams/acme/export.zip',
      3600,
    );
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'team.export_download',
      targetType: 'team_export',
      targetId: EXPORT_ID,
      metadata: {
        mode: 'single',
        outcome: 'signed',
        expires_at: expiresAt.toISOString(),
      },
    });
  });
});
