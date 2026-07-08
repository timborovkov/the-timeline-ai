import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  enqueueReconciliationJob: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@/lib/sentry-action', () => ({
  runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/queue', () => ({
  enqueueReconciliationJob: fakes.enqueueReconciliationJob,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));

const { queueReconciliationJobAction, queueReconciliationJobFormAction } =
  await import('./reconciliation.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.enqueueReconciliationJob.mockResolvedValue(undefined);
});

describe('queueReconciliationJobAction', () => {
  it('requires a signed-in admin on an active team', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    await expect(queueReconciliationJobAction({}, form({ mode: 'audit' }))).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    await expect(queueReconciliationJobAction({}, form({ mode: 'audit' }))).resolves.toEqual({
      error: 'No active team',
    });

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    await expect(queueReconciliationJobAction({}, form({ mode: 'audit' }))).resolves.toEqual({
      error: 'Could not queue reconciliation work',
    });
    expect(fakes.enqueueReconciliationJob).not.toHaveBeenCalled();
  });

  it('queues an all-source evidence audit with stable operator defaults', async () => {
    const result = await queueReconciliationJobAction({}, form({ mode: 'audit', source: '' }));

    expect(result).toMatchObject({ ok: true });
    expect(fakes.enqueueReconciliationJob).toHaveBeenCalledWith({
      kind: 'evidence_audit',
      teamId: TEAM_ID,
      limit: 5000,
      pageSize: 500,
      triggeredBy: USER_ID,
    });
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/reconciliation');
  });

  it('queues source-filtered missing-only dry-run backfills from form actions', async () => {
    await expect(
      queueReconciliationJobFormAction(
        form({ mode: 'backfill', source: 'integration', dryRun: 'true' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT:/app/team/reconciliation?');

    expect(fakes.enqueueReconciliationJob).toHaveBeenCalledWith({
      kind: 'evidence_backfill',
      teamId: TEAM_ID,
      source: 'integration',
      limit: 5000,
      pageSize: 500,
      triggeredBy: USER_ID,
      dryRun: true,
      missingOnly: true,
    });
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/reconciliation');
    expect(fakes.redirect).toHaveBeenCalledWith(
      expect.stringContaining('reconciliationNotice=queued'),
    );
    expect(fakes.redirect).toHaveBeenCalledWith(
      expect.stringContaining('Queued+missing-only+backfill+for+integration.'),
    );
  });

  it('queues manual scoped reconciliation from the admin dashboard', async () => {
    const targetId = '33333333-3333-4333-8333-333333333333';

    const result = await queueReconciliationJobAction(
      {},
      form({ mode: 'scope', scope: 'object', targetId }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(fakes.enqueueReconciliationJob).toHaveBeenCalledWith({
      kind: 'scope_reconcile',
      teamId: TEAM_ID,
      scope: 'object',
      targetId,
      triggeredBy: USER_ID,
      reason: 'admin_dashboard',
    });
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/reconciliation');
  });

  it('passes planner replay controls for manual team reconciliation', async () => {
    const result = await queueReconciliationJobAction(
      {},
      form({
        mode: 'scope',
        scope: 'team',
        plannerReplayLimit: '25',
        plannerReplayMode: 'all',
        plannerReplaySource: 'email',
        plannerReplayOccurredAfter: '2026-06-20T10:00:00.000Z',
        plannerReplayOccurredBefore: '2026-06-21T10:00:00.000Z',
      }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(fakes.enqueueReconciliationJob).toHaveBeenCalledWith({
      kind: 'scope_reconcile',
      teamId: TEAM_ID,
      scope: 'team',
      triggeredBy: USER_ID,
      reason: 'admin_dashboard',
      plannerReplayLimit: 25,
      plannerReplayMode: 'all',
      plannerReplaySource: 'email',
      plannerReplayOccurredAfter: '2026-06-20T10:00:00.000Z',
      plannerReplayOccurredBefore: '2026-06-21T10:00:00.000Z',
    });
  });

  it('rejects inverted planner replay time windows', async () => {
    await expect(
      queueReconciliationJobAction(
        {},
        form({
          mode: 'scope',
          scope: 'team',
          plannerReplayOccurredAfter: '2026-06-21T10:00:00.000Z',
          plannerReplayOccurredBefore: '2026-06-20T10:00:00.000Z',
        }),
      ),
    ).resolves.toEqual({ error: 'Invalid reconciliation job request' });

    expect(fakes.enqueueReconciliationJob).not.toHaveBeenCalled();
  });

  it('requires target ids for object and cluster scoped reconciliation', async () => {
    await expect(
      queueReconciliationJobAction({}, form({ mode: 'scope', scope: 'cluster' })),
    ).resolves.toEqual({
      error: 'Object and cluster reconciliation require a target id',
    });

    expect(fakes.enqueueReconciliationJob).not.toHaveBeenCalled();
  });

  it('redirects form submissions with visible validation errors', async () => {
    await expect(
      queueReconciliationJobFormAction(form({ mode: 'scope', scope: 'object' })),
    ).rejects.toThrow('NEXT_REDIRECT:/app/team/reconciliation?');

    expect(fakes.enqueueReconciliationJob).not.toHaveBeenCalled();
    expect(fakes.redirect).toHaveBeenCalledWith(
      expect.stringContaining('reconciliationNotice=error'),
    );
    expect(fakes.redirect).toHaveBeenCalledWith(
      expect.stringContaining('Object+and+cluster+reconciliation+require+a+target+id'),
    );
  });
});
