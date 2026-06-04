import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeListFinishedJobs: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    jobRecovery: { listFinishedJobs: fakes.fakeListFinishedJobs },
  }),
}));

const { GET } = await import('./route.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.fakeRequireMembership.mockResolvedValue('admin');
  fakes.fakeListFinishedJobs.mockResolvedValue({ items: [], nextOffset: null });
});

describe('finished job recovery route', () => {
  it('requires an admin role', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('Requires admin role'));

    const res = await GET(new Request('http://test/api/team/job-recovery/finished'));

    expect(res.status).toBe(403);
    expect(fakes.fakeListFinishedJobs).not.toHaveBeenCalled();
  });

  it('falls back for malformed pagination params', async () => {
    const res = await GET(
      new Request('http://test/api/team/job-recovery/finished?offset=wat&limit=nope'),
    );

    expect(res.status).toBe(200);
    expect(fakes.fakeRequireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.fakeListFinishedJobs).toHaveBeenCalledWith({ offset: 0, limit: 20 });
  });

  it('serializes finished job dates', async () => {
    fakes.fakeListFinishedJobs.mockResolvedValue({
      items: [
        {
          id: 'transcribe:job-1',
          queue: 'transcribe',
          name: 'transcribe',
          kind: 'transcription',
          artifactKind: 'raw_event',
          artifactId: 'raw-1',
          label: 'Transcription',
          status: 'completed',
          attemptsMade: 1,
          processedAt: null,
          finishedAt: new Date('2026-06-04T10:00:00.000Z'),
          error: null,
        },
      ],
      nextOffset: null,
    });

    const res = await GET(
      new Request('http://test/api/team/job-recovery/finished?offset=2&limit=5'),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      items: [{ processedAt: null, finishedAt: '2026-06-04T10:00:00.000Z' }],
      nextOffset: null,
    });
    expect(fakes.fakeListFinishedJobs).toHaveBeenCalledWith({ offset: 2, limit: 5 });
  });
});
