// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as jobRecovery from '@timeline/shared/job-recovery';

const fakes = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  refetchFinishedJobs: vi.fn(),
  routerRefresh: vi.fn(),
  useFinishedJobsInfiniteQuery: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: fakes.routerRefresh }),
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
    <JobRecoveryList
      items={items}
      olderCount={props.olderCount ?? 0}
      defaultFilter={props.defaultFilter}
    />,
  );
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

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/job-1/retry',
        method: 'POST',
      });
    });
    expect(screen.getByText('Retrying')).toBeTruthy();
    expect(screen.getByText('Retry queued.')).toBeTruthy();
    expect(fakes.refetchFinishedJobs).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(requests[1]).toMatchObject({
        url: '/api/team/job-recovery/job-1/dismiss',
        method: 'POST',
      });
    });
    expect(screen.queryByText('Transcribe customer call')).toBeNull();
    expect(screen.getByText('Nothing needs attention from the last 7 days.')).toBeTruthy();
    expect(fakes.routerRefresh).toHaveBeenCalledOnce();
  });

  it('keeps a failed retry error inside the closed technical disclosure', async () => {
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

    renderList([recoverableJob()]);
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Retry' }));

    const recoveryRow = screen.getAllByText('Transcribe customer call')[0]?.closest('li');
    expect(recoveryRow).not.toBeNull();
    await waitFor(() => {
      expect(
        within(recoveryRow as HTMLElement).getByText(
          'Retry failed. Review technical details, then retry the job or dismiss it.',
        ),
      ).toBeTruthy();
    });
    const rawErrorValue = within(recoveryRow as HTMLElement).getByText(rawError);
    expect(rawErrorValue.closest('details')?.open).toBe(false);
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
    expect(screen.getByText('Retried 1 failed jobs; 1 could not be queued.')).toBeTruthy();
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

    expect(screen.getByText(/older jobs are hidden/)).toBeTruthy();
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
    expect(fakes.routerRefresh).toHaveBeenCalledOnce();
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
    expect(within(archive).getByText('provider unavailable')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fakes.fetchNextPage).toHaveBeenCalledOnce();

    cleanup();
    installFinishedJobsQuery({ error: new Error('archive offline') });
    renderList([]);
    await userEvent.setup().click(screen.getByText('Advanced tools'));
    expect(screen.getByText('archive offline')).toBeTruthy();
  });
});
