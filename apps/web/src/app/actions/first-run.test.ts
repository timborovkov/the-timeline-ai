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
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({ trackProductEventBestEffort: fakes.trackProductEventBestEffort }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  () => ({ getEnv: () => ({ FIRECRAWL_API_KEY: 'fc-test' }) }),
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
});

describe('first-run analytics', () => {
  it('records work style, path, skip, and go-live channel events', async () => {
    await expect(submitWorkStyleAction({ workStyle: 'email' })).resolves.toEqual({ ok: true });
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
