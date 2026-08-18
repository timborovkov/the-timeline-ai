import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeDismissMatching: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeAuditRecord: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    jobRecovery: { dismissMatchingRecoverableJobs: fakes.fakeDismissMatching },
    audit: { record: fakes.fakeAuditRecord },
  }),
}));

const { POST } = await import('./route.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.fakeRequireMembership.mockResolvedValue('admin');
  fakes.fakeDismissMatching.mockResolvedValue({ dismissed: 12, remaining: 0 });
});

describe('job recovery dismiss matching route', () => {
  it('requires an admin role', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('Requires admin role'));

    const res = await POST(new Request('http://test', { method: 'POST' }));

    expect(res.status).toBe(403);
    expect(fakes.fakeDismissMatching).not.toHaveBeenCalled();
    expect(fakes.fakeAuditRecord).toHaveBeenCalledWith({
      action: 'job.dismiss',
      targetType: 'job_recovery_batch',
      metadata: {
        mode: 'bulk',
        outcome: 'rejected',
        recovery_kind: 'mixed',
        target_ids: [],
        target_count: 0,
        reason: 'forbidden',
      },
    });
  });

  it('dismisses older jobs through the team-scoped recovery scope', async () => {
    const res = await POST(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({ window: 'older', kind: 'extraction' }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, dismissed: 12, remaining: 0 });
    expect(fakes.fakeRequireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.fakeDismissMatching).toHaveBeenCalledWith({
      window: 'older',
      kind: 'extraction',
      reason: 'dismiss older jobs',
    });
    expect(fakes.fakeAuditRecord).toHaveBeenCalledWith({
      action: 'job.dismiss',
      targetType: 'job_recovery_batch',
      metadata: {
        mode: 'bulk',
        outcome: 'succeeded',
        recovery_kind: 'extraction',
        target_ids: [],
        target_count: 0,
        reason: 'dismiss older jobs',
      },
    });
  });

  it('rejects malformed or empty JSON instead of dismissing everything', async () => {
    const res = await POST(new Request('http://test', { method: 'POST' }));

    expect(res.status).toBe(400);
    expect(fakes.fakeDismissMatching).not.toHaveBeenCalled();
  });
});
