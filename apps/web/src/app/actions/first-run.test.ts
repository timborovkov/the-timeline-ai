import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  submitWorkStyle: vi.fn(),
  selectStarterPath: vi.fn(),
  attachCapture: vi.fn(),
  skipToEmptyHome: vi.fn(),
  markScanFailed: vi.fn(),
  setFirstRunPhase: vi.fn(),
  checkRateLimit: vi.fn(),
  isWebsiteScanEnabled: vi.fn(),
  enqueueWebsiteScanJob: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  revalidatePath: vi.fn(),
}));

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
  () => ({ getEnv: () => ({}) }),
  () => import('@timeline/shared/env'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/onboarding'),
  async () => ({
    ...(await import('@timeline/shared/onboarding')),
    isWebsiteScanEnabled: fakes.isWebsiteScanEnabled,
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
      onboarding: {
        submitWorkStyle: fakes.submitWorkStyle,
        selectStarterPath: fakes.selectStarterPath,
        attachCapture: fakes.attachCapture,
        skipToEmptyHome: fakes.skipToEmptyHome,
        markScanFailed: fakes.markScanFailed,
        setFirstRunPhase: fakes.setFirstRunPhase,
      },
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
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.checkRateLimit.mockResolvedValue({ ok: true });
  fakes.isWebsiteScanEnabled.mockReturnValue(false);
  fakes.submitWorkStyle.mockResolvedValue({});
  fakes.selectStarterPath.mockResolvedValue({});
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

  it('does not start a website scan when the flag is off', async () => {
    await expect(
      selectStarterPathAction({ path: 'website', websiteUrl: 'studio.example' }),
    ).resolves.toEqual({
      ok: false,
      error: 'Website scan is coming soon. Upload a document or forward an email.',
    });
    expect(fakes.selectStarterPath).not.toHaveBeenCalled();
    expect(fakes.enqueueWebsiteScanJob).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
  });

  it('enqueues a website scan when the flag is on', async () => {
    fakes.isWebsiteScanEnabled.mockReturnValue(true);
    await expect(
      selectStarterPathAction({ path: 'website', websiteUrl: 'studio.example' }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.selectStarterPath).toHaveBeenCalledWith('website', {
      websiteUrl: 'https://studio.example/',
      websiteHost: 'studio.example',
    });
    expect(fakes.enqueueWebsiteScanJob).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      userId: USER_ID,
    });
    expect(fakes.markScanFailed).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'onboarding_first_path_selected',
      { path: 'website' },
    );
  });

  it('refuses a second website scan for the same team', async () => {
    fakes.isWebsiteScanEnabled.mockReturnValue(true);
    fakes.checkRateLimit
      .mockResolvedValueOnce({ ok: true, remaining: 29 })
      .mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterMs: 86_400_000 });
    await expect(
      selectStarterPathAction({ path: 'website', websiteUrl: 'studio.example' }),
    ).resolves.toEqual({
      ok: false,
      error:
        'This team already used its signup website scan. Upload a document or forward an email instead.',
    });
    expect(fakes.enqueueWebsiteScanJob).not.toHaveBeenCalled();
  });
});
