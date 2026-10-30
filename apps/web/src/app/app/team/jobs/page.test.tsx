import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getRecoverableJobQueue: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  requireMembership: vi.fn(),
  resolveActiveTeam: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/use-paginated-queries'),
  () => ({
    useFinishedJobsInfiniteQuery: () => ({
      data: undefined,
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchingNextPage: false,
      isPending: true,
      refetch: vi.fn(),
    }),
    useJobDashboardQuery: () => ({
      data: undefined,
      error: null,
      isError: false,
      isFetching: false,
      isPending: true,
      refetch: vi.fn(),
    }),
  }),
  () => import('@/lib/use-paginated-queries'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.requireMembership,
      jobRecovery: { getRecoverableJobQueue: fakes.getRecoverableJobQueue },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
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

const { renderToStaticMarkup } = await import('react-dom/server');

const { default: JobRecoveryPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'AuditAI' },
  });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.getRecoverableJobQueue.mockResolvedValue({
    items: [
      {
        id: 'job-1',
        kind: 'embedding',
        artifactKind: 'calendar_event',
        artifactId: 'cal-1',
        label: 'Embedding · calendar event from Aug 16, 2026, 12:00 PM',
        status: 'failed',
        error: 'embed timeout',
        retryable: true,
        detectedAt: new Date('2026-08-16T15:00:00.000Z'),
      },
    ],
    olderCount: 8776,
  });
});

describe('Job recovery page', () => {
  it('shows the admin recovery queue and keeps older backlog out of the list', async () => {
    const html = renderToStaticMarkup(await JobRecoveryPage({ searchParams: Promise.resolve({}) }));

    expect(html).not.toContain('>access</dt>');
    expect(html).not.toContain('>team</dt>');
    expect(html).not.toContain('>last 7 days</dt>');
    expect(html).not.toContain('>older hidden</dt>');
    expect(html).toContain('Dismiss older jobs');
    expect(html).toContain('Embedding · calendar event from Aug 16, 2026, 12:00 PM');
    expect(html).not.toContain('need attention');
    expect(html).not.toContain('Processing summary');
  });

  it('tells members the queue is admins only without loading recovery jobs', async () => {
    fakes.requireMembership.mockRejectedValue(new Error('Requires admin role'));

    const html = renderToStaticMarkup(await JobRecoveryPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Admins only');
    expect(html).toContain('Ask an admin to retry or dismiss failed processing.');
    expect(html).toContain('Back to Home');
    expect(fakes.getRecoverableJobQueue).not.toHaveBeenCalled();
  });
});
