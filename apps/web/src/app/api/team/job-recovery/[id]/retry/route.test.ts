import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRetry: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeAuditRecord: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    jobRecovery: { retryRecoverableJob: fakes.fakeRetry },
    audit: { record: fakes.fakeAuditRecord },
  }),
}));

const { POST } = await import('./route.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.fakeRequireMembership.mockResolvedValue('admin');
  fakes.fakeRetry.mockResolvedValue(undefined);
});

describe('job recovery retry route', () => {
  it('requires a signed-in user', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const res = await POST(new Request('http://test'), {
      params: Promise.resolve({ id: 'abc' }),
    });

    expect(res.status).toBe(401);
    expect(fakes.fakeRetry).not.toHaveBeenCalled();
  });

  it('requires an admin role', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('Requires admin role'));

    const res = await POST(new Request('http://test'), {
      params: Promise.resolve({ id: 'abc' }),
    });

    expect(res.status).toBe(403);
    expect(fakes.fakeRetry).not.toHaveBeenCalled();
    expect(fakes.fakeAuditRecord).toHaveBeenCalledWith({
      action: 'job.retry',
      targetType: 'job_recovery',
      targetId: 'abc',
      metadata: {
        mode: 'single',
        outcome: 'rejected',
        recovery_kind: 'unknown',
        reason: 'forbidden',
      },
    });
  });

  it('dispatches the retry through the team-scoped recovery scope', async () => {
    const res = await POST(new Request('http://test'), {
      params: Promise.resolve({ id: 'abc' }),
    });

    expect(res.status).toBe(200);
    expect(fakes.fakeRequireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.fakeRetry).toHaveBeenCalledWith('abc');
    expect(fakes.fakeAuditRecord).toHaveBeenCalledWith({
      action: 'job.retry',
      targetType: 'job_recovery',
      targetId: 'abc',
      metadata: { mode: 'single', outcome: 'succeeded', recovery_kind: 'unknown' },
    });
  });
});
