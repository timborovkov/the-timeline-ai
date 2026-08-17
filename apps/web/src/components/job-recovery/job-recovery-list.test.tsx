// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

const fakes = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  refetchFinishedJobs: vi.fn(),
  routerRefresh: vi.fn(),
  toastError: vi.fn(),
  toastLoading: vi.fn(() => 'toast-1'),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  useFinishedJobsInfiniteQuery: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: fakes.routerRefresh }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: fakes.toastError,
    loading: fakes.toastLoading,
    success: fakes.toastSuccess,
    warning: fakes.toastWarning,
  },
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useFinishedJobsInfiniteQuery: fakes.useFinishedJobsInfiniteQuery,
  useJobDashboardQuery: () => ({
    data: undefined,
    error: null,
    isError: false,
    isFetching: false,
    isPending: true,
    refetch: vi.fn(),
  }),
}));

const { JobRecoveryList } = await import('./job-recovery-list.js');

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type JobRecoveryKind = jobRecovery.JobRecoveryKind;
type FinishedJobArchiveItem = jobRecovery.FinishedJobArchiveItem;

function renderList(
  items: JobRecoveryItem[],
  props: Partial<{ defaultFilter: JobRecoveryKind; olderCount: number }> = {},
) {
  return render(
    <WorkspaceTimezoneProvider timezone="UTC">
      <JobRecoveryList
        teamName="AuditAI"
        items={items}
        olderCount={props.olderCount ?? 0}
        defaultFilter={props.defaultFilter}
      />
    </WorkspaceTimezoneProvider>,
  );
}

async function chooseRowAction(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  action: 'Retry' | 'Dismiss',
) {
  await user.click(screen.getByRole('button', { name: `Actions for ${label}` }));
  await user.click(screen.getByRole('menuitem', { name: action }));
}

function recoverableJob(overrides: Partial<JobRecoveryItem> = {}): JobRecoveryItem {
  return {
    id: 'job-1',
    kind: 'transcription',
    artifactKind: 'raw_event',
    artifactId: 'raw-event-1',
    label: 'Transcribe customer call',
    status: 'failed',
    error: 'Audio service timed out',
    retryable: true,
    detectedAt: new Date('2026-07-02T10:00:00.000Z'),
    ...overrides,
  };
}

function finishedJob(overrides: Partial<FinishedJobArchiveItem> = {}): FinishedJobArchiveItem {
  return {
    id: 'finished-1',
    queue: 'transcribe',
    name: 'transcribe',
    kind: 'transcription',
    artifactKind: 'raw_event',
    artifactId: 'raw-event-1',
    label: 'Transcribe customer call',
    status: 'completed',
    attemptsMade: 2,
    processedAt: new Date('2026-07-02T10:05:00.000Z'),
    finishedAt: new Date('2026-07-02T10:06:00.000Z'),
    error: null,
    ...overrides,
  };
}

function installFinishedJobsQuery(
  input: {
    error?: Error;
    hasNextPage?: boolean;
    isFetchingNextPage?: boolean;
    isPending?: boolean;
    items?: FinishedJobArchiveItem[];
  } = {},
) {
  fakes.useFinishedJobsInfiniteQuery.mockReturnValue({
    data: input.items ? { pages: [{ items: input.items, nextOffset: null }] } : undefined,
    error: input.error ?? null,
    fetchNextPage: fakes.fetchNextPage,
    hasNextPage: input.hasNextPage ?? false,
    isError: Boolean(input.error),
    isFetchingNextPage: input.isFetchingNextPage ?? false,
    isPending: input.isPending ?? false,
    refetch: fakes.refetchFinishedJobs,
  });
}

function fetchJsonBody(init?: RequestInit): unknown {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

beforeEach(() => {
  vi.clearAllMocks();
  installFinishedJobsQuery({ items: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('JobRecoveryList', () => {
  it('renders product recovery language, filters by kind, and avoids queue internals', async () => {
    const user = userEvent.setup();
    renderList([
      recoverableJob(),
      recoverableJob({
        id: 'job-2',
        kind: 'integration_sync',
        artifactKind: 'integration',
        artifactId: 'integration-1',
        label: 'Sync Sentry issues',
        error: 'Provider budget paused',
        syncKind: 'incremental',
      }),
    ]);

    expect(screen.getByText('Transcription')).toBeTruthy();
    expect(screen.getByText('Integrations')).toBeTruthy();
    expect(screen.getByText('Transcribe customer call')).toBeTruthy();
    expect(screen.getByText('Sync Sentry issues')).toBeTruthy();
    expect(screen.queryByText('BullMQ')).toBeNull();
    expect(screen.queryByText('jobId')).toBeNull();
    expect(screen.queryByText('Technical details')).toBeNull();
    expect(screen.queryByText('Job ID')).toBeNull();
    expect(screen.queryByText('Artifact ID')).toBeNull();
    expect(screen.queryByText('Provider budget paused')).toBeNull();
    expect(screen.queryByText('Audio service timed out')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Actions for Transcribe customer call' }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Integrations' }));

    expect(screen.queryByText('Transcribe customer call')).toBeNull();
    expect(screen.getByText('Sync Sentry issues')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry failed (1)' })).toBeTruthy();
  });

  it('hides kind filters when every listed job is the same kind', () => {
    renderList([recoverableJob()]);
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transcription' })).toBeNull();
    expect(screen.getByText('Failed and stuck jobs from the last 7 days.')).toBeTruthy();
  });

  it('shows relative time and keeps job ids in the row hover title', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T17:00:00.000Z'));
    renderList([recoverableJob()]);

    expect(screen.getAllByText('7 hours ago').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const hints = screen.getAllByTitle(/Job ID: job-1 \| Artifact UUID: raw-event-1/);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]?.getAttribute('title')).toContain('Audio service timed out');
    expect(screen.queryByText('Job ID: job-1')).toBeNull();
    expect(screen.queryByText('Audio service timed out')).toBeNull();
  });

  it('keeps conversation suggestion backfill inside Advanced tools', async () => {
    const user = userEvent.setup();
    renderList([]);

    const advanced = screen.getByText('Advanced tools').closest('details');
    expect(advanced).not.toBeNull();
    expect(advanced?.hasAttribute('open')).toBe(false);
    await user.click(screen.getByText('Advanced tools'));
    expect(advanced?.hasAttribute('open')).toBe(true);
    expect(
      within(advanced as HTMLElement).getByRole('button', { name: 'Queue suggestions' }),
    ).toBeTruthy();
    expect(
      within(advanced as HTMLElement).getByText(
        'Re-queue reviews if suggestions did not appear. Leave this unless support asks.',
      ),
    ).toBeTruthy();
  });

  it('queues individual retry and dismiss actions with visible optimistic state', async () => {
    const user = userEvent.setup();
    const requests: { body: unknown; method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: fetchUrl(input),
          method: init?.method ?? 'GET',
          body: fetchJsonBody(init),
        });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }),
    );

    renderList([recoverableJob()]);

    await chooseRowAction(user, 'Transcribe customer call', 'Retry');

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/job-1/retry',
        method: 'POST',
      });
    });
    expect(screen.getByText('Retry queued.')).toBeTruthy();
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Retry queued.', { id: 'toast-1' });
    expect(fakes.refetchFinishedJobs).toHaveBeenCalledOnce();

    await chooseRowAction(user, 'Transcribe customer call', 'Dismiss');

    await waitFor(() => {
      expect(requests[1]).toMatchObject({
        url: '/api/team/job-recovery/job-1/dismiss',
        method: 'POST',
      });
    });
    expect(screen.queryByText('Transcribe customer call')).toBeNull();
    expect(screen.getByText('Nothing needs attention from the last 7 days.')).toBeTruthy();
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Dismissed.', { id: 'toast-1' });
    expect(fakes.routerRefresh).toHaveBeenCalledOnce();
  });

  it('shows a failed retry without dumping raw provider errors', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-02T10:00:00.000Z'));
    const rawError =
      'Provider payload ref 018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f could not be processed';
    installFinishedJobsQuery({
      items: [
        finishedJob({
          status: 'failed',
          finishedAt: new Date('2026-07-02T10:01:00.000Z'),
          error: rawError,
        }),
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))),
    );

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderList([recoverableJob()]);
    await user.click(screen.getByRole('button', { name: 'Actions for Transcribe customer call' }));
    await user.click(screen.getByRole('menuitem', { name: 'Retry' }));

    const recoveryRow = screen.getAllByText('Transcribe customer call')[0]?.closest('li');
    expect(recoveryRow).not.toBeNull();
    await waitFor(() => {
      expect(within(recoveryRow as HTMLElement).getByText('Retry failed')).toBeTruthy();
    });
    expect(within(recoveryRow as HTMLElement).queryByText(rawError)).toBeNull();
    expect(within(recoveryRow as HTMLElement).queryByText('Technical details')).toBeNull();
  });

  it('bulk retries visible failed jobs and reports partial queue failures', async () => {
    const user = userEvent.setup();
    const requests: { body: unknown; method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: fetchUrl(input),
          method: init?.method ?? 'GET',
          body: fetchJsonBody(init),
        });
        return Promise.resolve(
          new Response(JSON.stringify({ retried: 1, failed: 1, failedIds: ['job-2'] }), {
            status: 200,
          }),
        );
      }),
    );

    renderList([
      recoverableJob(),
      recoverableJob({
        id: 'job-2',
        artifactId: 'raw-event-2',
        label: 'Transcribe board update',
        detectedAt: new Date('2026-07-02T11:00:00.000Z'),
      }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Retry failed (2)' }));

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/retry-failed',
        method: 'POST',
      });
    });
    expect(requests[0]?.body).toMatchObject({
      expectedCount: 2,
      items: [
        { id: 'job-1', detectedAt: '2026-07-02T10:00:00.000Z' },
        { id: 'job-2', detectedAt: '2026-07-02T11:00:00.000Z' },
      ],
    });
    expect(fakes.toastWarning).toHaveBeenCalledWith(
      'Retried 1 failed jobs; 1 could not be queued.',
      { id: 'toast-1' },
    );
    expect(screen.getByText('Retry queued.')).toBeTruthy();
    expect(fakes.refetchFinishedJobs).toHaveBeenCalledOnce();
    expect(fakes.routerRefresh).toHaveBeenCalledOnce();
  });

  it('confirms bulk dismiss and only removes the filtered failed snapshot', async () => {
    const user = userEvent.setup();
    const requests: { body: unknown; method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: fetchUrl(input),
          method: init?.method ?? 'GET',
          body: fetchJsonBody(init),
        });
        return Promise.resolve(new Response(JSON.stringify({ dismissed: 1 }), { status: 200 }));
      }),
    );

    renderList(
      [
        recoverableJob(),
        recoverableJob({
          id: 'job-2',
          kind: 'integration_sync',
          artifactKind: 'integration',
          artifactId: 'integration-1',
          label: 'Sync Sentry issues',
          detectedAt: new Date('2026-07-02T11:00:00.000Z'),
        }),
      ],
      { defaultFilter: 'integration_sync' },
    );

    expect(screen.queryByText('Transcribe customer call')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss all (1)' }));
    expect(
      screen.getByText(
        'Dismiss 1 integration sync job from the last 7 days? They leave this list. Timeline can still retry them in the background.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss all' }));

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/dismiss-matching',
        method: 'POST',
      });
    });
    expect(requests[0]?.body).toMatchObject({
      kind: 'integration_sync',
      window: 'recent',
    });
    expect(screen.queryByText('Sync Sentry issues')).toBeNull();
    expect(screen.getByText('Nothing needs attention from the last 7 days.')).toBeTruthy();
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Dismissed 1 job.', { id: 'toast-1' });
    expect(fakes.routerRefresh).toHaveBeenCalledOnce();
  });

  it('offers to dismiss jobs older than the attention window', async () => {
    const user = userEvent.setup();
    const requests: { body: unknown; method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: fetchUrl(input),
          method: init?.method ?? 'GET',
          body: fetchJsonBody(init),
        });
        return Promise.resolve(
          new Response(JSON.stringify({ dismissed: 12, remaining: 0 }), { status: 200 }),
        );
      }),
    );

    renderList([], { olderCount: 12 });

    expect(screen.getByRole('button', { name: 'Dismiss older jobs' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss older jobs' }));
    expect(
      screen.getByText(
        'Dismiss 12 jobs older than 7 days? Timeline will stop asking you to recover them. Background workers may still retry a few times, then give up.',
      ),
    ).toBeTruthy();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss older jobs' }),
    );

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/dismiss-matching',
        method: 'POST',
      });
    });
    expect(requests[0]?.body).toEqual({ window: 'older' });
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Dismissed 12 older jobs.', { id: 'toast-1' });
    expect(screen.queryByRole('button', { name: 'Dismiss older jobs' })).toBeNull();
    expect(fakes.routerRefresh).toHaveBeenCalledOnce();
  });

  it('keeps dismissing older jobs until the server reports none remaining', async () => {
    const user = userEvent.setup();
    const requests: { body: unknown; method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: fetchUrl(input),
          method: init?.method ?? 'GET',
          body: fetchJsonBody(init),
        });
        const dismissed = requests.length === 1 ? 500 : 12;
        const remaining = requests.length === 1 ? 12 : 0;
        return Promise.resolve(
          new Response(JSON.stringify({ dismissed, remaining }), { status: 200 }),
        );
      }),
    );

    renderList([], { olderCount: 512 });
    await user.click(screen.getByRole('button', { name: 'Dismiss older jobs' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss older jobs' }),
    );

    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(fakes.toastLoading).toHaveBeenCalledWith('Dismissed 500 of 512 older jobs…', {
      id: 'toast-1',
    });
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Dismissed 512 older jobs.', { id: 'toast-1' });
    expect(screen.queryByRole('button', { name: 'Dismiss older jobs' })).toBeNull();
  });

  it('windows a large snapshot with Load more without changing Dismiss all', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 51 }, (_, index) =>
      recoverableJob({
        id: `job-${String(index + 1)}`,
        artifactId: `raw-event-${String(index + 1)}`,
        label: `Transcribe job ${String(index + 1)}`,
        detectedAt: new Date(Date.UTC(2026, 6, 2, 10, index)),
      }),
    );
    renderList(items);

    expect(screen.getByText('Transcribe job 1')).toBeTruthy();
    expect(screen.queryByText('Transcribe job 51')).toBeNull();
    expect(screen.getByText('Showing 50 of 51')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss all (51)' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(screen.getByText('Transcribe job 51')).toBeTruthy();
    expect(screen.queryByText('Showing 50 of 51')).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss all (51)' })).toBeTruthy();
  });

  it('renders finished archive states and paginates retained jobs', async () => {
    const user = userEvent.setup();
    installFinishedJobsQuery({
      hasNextPage: true,
      items: [
        finishedJob(),
        finishedJob({
          id: 'finished-2',
          artifactId: 'integration-1',
          kind: 'integration_sync',
          artifactKind: 'integration',
          label: 'Sync Sentry issues',
          queue: 'integration-sync',
          status: 'failed',
          attemptsMade: 3,
          error: 'provider unavailable',
          syncKind: 'incremental',
        }),
      ],
    });

    renderList([]);

    await user.click(screen.getByText('Advanced tools'));
    const archive = screen.getByRole('table');
    expect(within(archive).getByText('Transcribe customer call')).toBeTruthy();
    expect(within(archive).getByText('Sync Sentry issues')).toBeTruthy();
    expect(within(archive).queryByText('provider unavailable')).toBeNull();
    expect(within(archive).queryByText('Technical details')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fakes.fetchNextPage).toHaveBeenCalledOnce();

    cleanup();
    installFinishedJobsQuery({ error: new Error('archive offline') });
    renderList([]);
    await userEvent.setup().click(screen.getByText('Advanced tools'));
    expect(screen.getByText('archive offline')).toBeTruthy();
  });
});
