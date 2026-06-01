import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeDismissFailed: vi.fn(),
  fakeRequireMembership: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    jobRecovery: { dismissFailedRecoverableJobs: fakes.fakeDismissFailed },
  }),
}));

const { POST } = await import('./route.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.fakeRequireMembership.mockResolvedValue('admin');
  fakes.fakeDismissFailed.mockResolvedValue({ dismissed: 3 });
});

describe('job recovery dismiss failed route', () => {
  it('requires an admin role', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('Requires admin role'));

    const res = await POST(new Request('http://test', { method: 'POST' }));

    expect(res.status).toBe(403);
    expect(fakes.fakeDismissFailed).not.toHaveBeenCalled();
  });

  it('bulk dismisses failed jobs through the team-scoped recovery scope', async () => {
    const res = await POST(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'embedding',
          items: [
            { id: 'job-1', detectedAt: '2026-05-27T10:00:00.000Z' },
            { id: 'job-2', detectedAt: '2026-05-27T10:01:00.000Z' },
            { id: 'job-3', detectedAt: '2026-05-27T10:02:00.000Z' },
          ],
          expectedCount: 3,
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, dismissed: 3 });
    expect(fakes.fakeRequireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.fakeDismissFailed).toHaveBeenCalledWith({
      kind: 'embedding',
      items: [
        { id: 'job-1', detectedAt: new Date('2026-05-27T10:00:00.000Z') },
        { id: 'job-2', detectedAt: new Date('2026-05-27T10:01:00.000Z') },
        { id: 'job-3', detectedAt: new Date('2026-05-27T10:02:00.000Z') },
      ],
      expectedCount: 3,
      reason: 'bulk dismiss failed jobs',
    });
  });

  it('rejects malformed or empty JSON instead of dismissing everything', async () => {
    const res = await POST(new Request('http://test', { method: 'POST' }));

    expect(res.status).toBe(400);
    expect(fakes.fakeDismissFailed).not.toHaveBeenCalled();
  });

  it('rejects invalid job kinds', async () => {
    const res = await POST(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'dead_lettered',
          items: [{ id: 'job-1', detectedAt: '2026-05-27T10:00:00.000Z' }],
          expectedCount: 1,
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(fakes.fakeDismissFailed).not.toHaveBeenCalled();
  });
});
