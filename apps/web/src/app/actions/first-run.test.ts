import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  startWebsiteScan: vi.fn(),
  addWebsite: vi.fn(),
  listWebsites: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  resolveActiveTeam: vi.fn(),
  submitWorkStyle: vi.fn(),
  selectStarterPath: vi.fn(),
  attachCapture: vi.fn(),
  skipToEmptyHome: vi.fn(),
  markScanFailed: vi.fn(),
  setFirstRunPhase: vi.fn(),
  checkRateLimit: vi.fn(),
  enqueueWebsiteScanJob: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  revalidatePath: vi.fn(),
  applyTeamRename: vi.fn(),
  createOwnedWorkspace: vi.fn(),
  dbTransaction: vi.fn(),
  dbSelect: vi.fn(),
  cookieSet: vi.fn(),
  sendMessage: vi.fn(),
  peekAuthContinuationForUser: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/websites'),
  () => ({ startWebsiteScan: fakes.startWebsiteScan }),
  () => import('@timeline/shared/websites'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({
    ACTIVE_TEAM_COOKIE: 'timeline_active_team',
    activeTeamCookieOptions: () => ({ httpOnly: true, path: '/' }),
    serializeActiveTeamCookie: (teamId: string) => `v2:${teamId}`,
    resolveActiveTeam: fakes.resolveActiveTeam,
  }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      transaction: fakes.dbTransaction,
      select: fakes.dbSelect,
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/agent-provisioning'),
  () => ({ createOwnedWorkspace: fakes.createOwnedWorkspace }),
  () => import('@timeline/shared/agent-provisioning'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  () => ({ sendMessage: fakes.sendMessage }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({
    cookies: vi.fn().mockResolvedValue({ set: fakes.cookieSet }),
  }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('@/lib/site-url'),
  () => ({ getSiteUrl: () => 'https://timeline.test' }),
  () => import('@/lib/site-url'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth-continuation'),
  () => ({ peekAuthContinuationForUser: fakes.peekAuthContinuationForUser }),
  () => import('@/lib/auth-continuation'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({ trackProductEventBestEffort: fakes.trackProductEventBestEffort }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  async () => ({
    ...(await import('@timeline/shared/env')),
    getEnv: () => ({ FIRECRAWL_API_KEY: 'fc-test' }),
    isFirecrawlConfigured: () => true,
  }),
  () => import('@timeline/shared/env'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/onboarding'),
  async () => ({
    ...(await import('@timeline/shared/onboarding')),
  }),
  () => import('@timeline/shared/onboarding'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/rate-limit'),
  () => ({
    RATE_LIMITS: {
      firstRun: { capacity: 30, refillPerSec: 0.5 },
      websiteScan: { capacity: 1, refillPerSec: 1 / 86_400 },
    },
    checkRateLimit: fakes.checkRateLimit,
    rateLimitKey: (...parts: string[]) => parts.join(':'),
  }),
  () => import('@timeline/shared/rate-limit'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      websites: { list: fakes.listWebsites, add: fakes.addWebsite },
      onboarding: {
        submitWorkStyle: fakes.submitWorkStyle,
        selectStarterPath: fakes.selectStarterPath,
        attachCapture: fakes.attachCapture,
        skipToEmptyHome: fakes.skipToEmptyHome,
        markScanFailed: fakes.markScanFailed,
        setFirstRunPhase: fakes.setFirstRunPhase,
      },
      billing: { reserve: fakes.reserve, release: fakes.release },
      requireMembership: vi.fn(),
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({
    requireRedisQueue: () =>
      Promise.resolve({ enqueueWebsiteScanJob: fakes.enqueueWebsiteScanJob }),
  }),
  () => import('@/lib/queue'),
);
await vi.mock(
  import.meta.resolve('next/cache'),
  () => ({ revalidatePath: fakes.revalidatePath }),
  () => import('next/cache'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-action'),
  () => ({
    runSentryServerAction: (_operation: string, callback: () => unknown) => callback(),
  }),
  () => import('@/lib/sentry-action'),
);
await vi.mock(
  import.meta.resolve('@/lib/team-rename'),
  async () => ({
    ...(await import('@/lib/team-rename')),
    applyTeamRename: fakes.applyTeamRename,
  }),
  () => import('@/lib/team-rename'),
);

const {
  recordAgentDeployedAction,
  selectStarterPathAction,
  skipFirstRunAction,
  submitWorkStyleAction,
} = await import('./first-run.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.startWebsiteScan.mockResolvedValue({ status: 'queued' });
  fakes.addWebsite.mockResolvedValue({ id: 'website-id' });
  fakes.listWebsites.mockResolvedValue([]);
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.checkRateLimit.mockResolvedValue({ ok: true });
  fakes.submitWorkStyle.mockResolvedValue({});
  fakes.selectStarterPath.mockImplementation((_path: string, extras: unknown) =>
    Promise.resolve(extras),
  );
  fakes.reserve.mockResolvedValue({ ok: true });
  fakes.release.mockResolvedValue({ ok: true });
  fakes.skipToEmptyHome.mockResolvedValue({});
  fakes.markScanFailed.mockResolvedValue({});
  fakes.enqueueWebsiteScanJob.mockResolvedValue(undefined);
  fakes.applyTeamRename.mockResolvedValue({ ok: true, changed: false });
  fakes.createOwnedWorkspace.mockResolvedValue({
    team: { id: TEAM_ID, name: 'Northstar Labs', slug: 'northstar-labs' },
    billing: { restricted: false },
  });
  const membershipSelect = (rows: unknown[]) => {
    const terminal = {
      orderBy: vi.fn().mockResolvedValue(rows),
      limit: vi.fn().mockResolvedValue(rows),
    };
    const where = vi.fn(() => terminal);
    const joinable = {
      where,
      innerJoin: vi.fn(() => joinable),
      leftJoin: vi.fn(() => joinable),
    };
    return {
      from: vi.fn(() => joinable),
    };
  };
  fakes.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(() => membershipSelect([])),
    }),
  );
  fakes.dbSelect.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([{ email: 'owner@example.test', name: 'Ada' }]),
      })),
    })),
  });
  fakes.sendMessage.mockResolvedValue({ ok: true });
  fakes.peekAuthContinuationForUser.mockResolvedValue(null);
});

describe('first-run analytics', () => {
  it('records work style, path, skip, and go-live channel events', async () => {
    await expect(submitWorkStyleAction({ workStyle: 'email' })).resolves.toEqual({ ok: true });
    expect(fakes.applyTeamRename).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'onboarding_work_style_submitted',
      { workStyle: 'email' },
    );

    await expect(submitWorkStyleAction({ workStyle: null })).resolves.toEqual({ ok: true });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'onboarding_work_style_submitted',
      { workStyle: 'skipped' },
    );

    await expect(selectStarterPathAction({ path: 'email' })).resolves.toEqual({ ok: true });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'onboarding_first_path_selected',
      { path: 'email' },
    );

    await expect(skipFirstRunAction()).resolves.toEqual({ ok: true });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'onboarding_first_path_selected',
      { path: 'skip' },
    );

    await expect(recordAgentDeployedAction('email')).resolves.toEqual({ ok: true });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'agent_deployed_on_channel',
      { channel: 'email' },
    );
  });

  it('requires permission confirmation before starting a website scan', async () => {
    await expect(
      selectStarterPathAction({ path: 'website', websiteUrl: 'studio.example' }),
    ).resolves.toEqual({
      ok: false,
      error: 'Confirm that you may submit this website for scanning.',
    });
    expect(fakes.selectStarterPath).not.toHaveBeenCalled();
    expect(fakes.enqueueWebsiteScanJob).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
  });

  it('creates a persistent website source and starts its shared onboarding scan', async () => {
    await expect(
      selectStarterPathAction({
        path: 'website',
        websiteUrl: 'studio.example',
        websitePermissionConfirmed: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.selectStarterPath).toHaveBeenCalledWith('website', {
      websiteUrl: 'https://studio.example/',
      websiteHost: 'studio.example',
      websiteSubject: 'own_team',
      websiteScanId: expect.any(String) as string,
    });
    expect(fakes.addWebsite).toHaveBeenCalledWith({
      url: 'https://studio.example/',
      subject: 'own_team',
      permissionConfirmed: true,
    });
    expect(fakes.enqueueWebsiteScanJob).not.toHaveBeenCalled();
    expect(fakes.reserve).not.toHaveBeenCalled();
    expect(fakes.startWebsiteScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        websiteId: 'website-id',
        scanId: expect.any(String) as string,
        trigger: 'onboarding',
        permissionConfirmed: true,
      }),
    );
    expect(fakes.markScanFailed).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'onboarding_first_path_selected',
      { path: 'website' },
    );
  });

  it('reuses the same persistent source when onboarding selects an existing website', async () => {
    fakes.listWebsites.mockResolvedValue([
      { id: 'existing-website', url: 'https://studio.example/' },
    ]);
    await expect(
      selectStarterPathAction({
        path: 'website',
        websiteUrl: 'https://studio.example:443/#about',
        websitePermissionConfirmed: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.addWebsite).not.toHaveBeenCalled();
    expect(fakes.startWebsiteScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        websiteId: 'existing-website',
        trigger: 'onboarding',
        permissionConfirmed: true,
      }),
    );
  });

  it('marks onboarding failed when shared scan admission is blocked', async () => {
    fakes.startWebsiteScan.mockResolvedValue({ status: 'blocked' });
    const result = await selectStarterPathAction({
      path: 'website',
      websiteUrl: 'studio.example',
      websitePermissionConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(fakes.markScanFailed).toHaveBeenCalled();
    expect(fakes.enqueueWebsiteScanJob).not.toHaveBeenCalled();
  });

  it('reports a shared scan failure', async () => {
    fakes.startWebsiteScan.mockRejectedValue(new Error('Redis failed'));
    const result = await selectStarterPathAction({
      path: 'website',
      websiteUrl: 'studio.example',
      websitePermissionConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(fakes.markScanFailed).toHaveBeenCalledWith('unreachable', expect.any(String));
  });

  it('reports shared cooldown rejection without bypassing admission', async () => {
    fakes.startWebsiteScan.mockRejectedValue(new Error('Wait one hour between website scans'));
    const result = await selectStarterPathAction({
      path: 'website',
      websiteUrl: 'studio.example',
      websitePermissionConfirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(fakes.markScanFailed).toHaveBeenCalled();
  });
});

describe('submitWorkStyleAction team name', () => {
  it('creates the owned workspace on Welcome when the user has no team yet', async () => {
    fakes.resolveActiveTeam.mockResolvedValue({ active: null });
    await expect(
      submitWorkStyleAction({ workStyle: 'email', teamName: 'Northstar Labs' }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.createOwnedWorkspace).toHaveBeenCalledWith(expect.anything(), {
      ownerId: USER_ID,
      name: 'Northstar Labs',
      timezone: 'Europe/Helsinki',
    });
    expect(fakes.applyTeamRename).not.toHaveBeenCalled();
    expect(fakes.cookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      `v2:${TEAM_ID}`,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'team_created',
      { source: 'signup' },
    );
    expect(fakes.sendMessage).toHaveBeenCalledWith(
      'welcome',
      expect.objectContaining({
        to: 'owner@example.test',
        teamName: 'Northstar Labs',
      }),
      expect.objectContaining({ teamId: TEAM_ID, userId: USER_ID }),
    );
    expect(fakes.submitWorkStyle).toHaveBeenCalledWith('email');
  });

  it('reuses an existing membership instead of creating a second owned workspace', async () => {
    const existingTeamId = '11111111-1111-4111-8111-111111111111';
    fakes.resolveActiveTeam.mockResolvedValue({ active: null });
    const membershipSelect = (rows: unknown[]) => {
      const terminal = {
        orderBy: vi.fn().mockResolvedValue(rows),
        limit: vi.fn().mockResolvedValue(rows),
      };
      const where = vi.fn(() => terminal);
      const joinable = {
        where,
        innerJoin: vi.fn(() => joinable),
        leftJoin: vi.fn(() => joinable),
      };
      return { from: vi.fn(() => joinable) };
    };
    fakes.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn(() =>
          membershipSelect([
            {
              teamId: existingTeamId,
              disabledAt: null,
              deletionStartedAt: null,
              securityState: 'active',
            },
          ]),
        ),
      }),
    );
    await expect(
      submitWorkStyleAction({ workStyle: 'email', teamName: 'Northstar Labs' }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.createOwnedWorkspace).not.toHaveBeenCalled();
    expect(fakes.cookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      `v2:${existingTeamId}`,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalledWith(
      expect.anything(),
      'team_created',
      expect.anything(),
    );
    expect(fakes.sendMessage).not.toHaveBeenCalled();
    expect(fakes.submitWorkStyle).toHaveBeenCalledWith('email');
  });

  it('creates a replacement workspace when the only membership is inactive', async () => {
    fakes.resolveActiveTeam.mockResolvedValue({ active: null });
    const membershipSelect = (rows: unknown[]) => {
      const terminal = {
        orderBy: vi.fn().mockResolvedValue(rows),
        limit: vi.fn().mockResolvedValue(rows),
      };
      const where = vi.fn(() => terminal);
      const joinable = {
        where,
        innerJoin: vi.fn(() => joinable),
        leftJoin: vi.fn(() => joinable),
      };
      return { from: vi.fn(() => joinable) };
    };
    fakes.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn(() =>
          membershipSelect([
            {
              teamId: '55555555-5555-4555-8555-555555555555',
              disabledAt: new Date('2026-01-01T00:00:00.000Z'),
              deletionStartedAt: null,
              securityState: 'active',
            },
          ]),
        ),
      }),
    );
    await expect(
      submitWorkStyleAction({ workStyle: 'email', teamName: 'Fresh Start' }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.createOwnedWorkspace).toHaveBeenCalledWith(expect.anything(), {
      ownerId: USER_ID,
      name: 'Fresh Start',
      timezone: 'Europe/Helsinki',
    });
  });

  it('renames through the shared team-rename path before saving work style', async () => {
    fakes.applyTeamRename.mockResolvedValue({ ok: true, changed: true });
    await expect(
      submitWorkStyleAction({
        workStyle: 'email',
        teamName: '  Northstar Labs  ',
        teamId: TEAM_ID,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.applyTeamRename).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      userId: USER_ID,
      name: 'Northstar Labs',
    });
    expect(fakes.createOwnedWorkspace).not.toHaveBeenCalled();
    expect(fakes.submitWorkStyle).toHaveBeenCalledWith('email');
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'team_management_action_completed',
      { action: 'settings_update' },
    );
  });

  it('rejects Welcome rename when the active workspace no longer matches the displayed one', async () => {
    fakes.resolveActiveTeam.mockResolvedValue({
      active: { teamId: '33333333-3333-4333-8333-333333333333' },
    });
    await expect(
      submitWorkStyleAction({
        workStyle: 'email',
        teamName: 'Northstar Labs',
        teamId: TEAM_ID,
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'This workspace changed. Refresh and try again.',
    });
    expect(fakes.applyTeamRename).not.toHaveBeenCalled();
    expect(fakes.submitWorkStyle).not.toHaveBeenCalled();
  });

  it('rejects blank or overlong team names with the shared validation message', async () => {
    await expect(submitWorkStyleAction({ workStyle: null, teamName: '   ' })).resolves.toEqual({
      ok: false,
      error: 'Invalid team name',
    });
    await expect(
      submitWorkStyleAction({ workStyle: null, teamName: 'x'.repeat(81) }),
    ).resolves.toEqual({
      ok: false,
      error: 'Invalid team name',
    });
    expect(fakes.applyTeamRename).not.toHaveBeenCalled();
    expect(fakes.createOwnedWorkspace).not.toHaveBeenCalled();
    expect(fakes.submitWorkStyle).not.toHaveBeenCalled();
  });

  it('surfaces rename failures and skips the work-style write', async () => {
    fakes.applyTeamRename.mockResolvedValue({ error: 'Only admins can rename a team' });
    await expect(
      submitWorkStyleAction({ workStyle: 'email', teamName: 'Denied Co', teamId: TEAM_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'Only admins can rename a team',
    });
    expect(fakes.submitWorkStyle).not.toHaveBeenCalled();
  });

  it('rejects rename when Welcome omits the displayed workspace id', async () => {
    await expect(
      submitWorkStyleAction({ workStyle: 'email', teamName: 'Orphan Rename' }),
    ).resolves.toEqual({
      ok: false,
      error: 'This workspace changed. Refresh and try again.',
    });
    expect(fakes.applyTeamRename).not.toHaveBeenCalled();
  });
});
