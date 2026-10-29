import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeDismissFailed: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeAuditRecord: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.fakeAuth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.fakeRequireMembership,
      jobRecovery: { dismissFailedRecoverableJobs: fakes.fakeDismissFailed },
      audit: { record: fakes.fakeAuditRecord },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

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
    expect(fakes.fakeAuditRecord).toHaveBeenCalledWith({
      action: 'job.dismiss',
      targetType: 'job_recovery_batch',
      metadata: {
        mode: 'bulk',
        outcome: 'succeeded',
        recovery_kind: 'embedding',
        target_ids: ['job-1', 'job-2', 'job-3'],
        target_count: 3,
      },
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
