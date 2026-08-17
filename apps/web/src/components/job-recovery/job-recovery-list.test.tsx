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
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
}));

const { JobRecoveryList } = await import('./job-recovery-list.js');

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type FinishedJobArchiveItem = jobRecovery.FinishedJobArchiveItem;

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
    render(
      <JobRecoveryList
        items={[
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
        ]}
      />,
    );

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

    render(<JobRecoveryList items={[recoverableJob()]} />);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/job-1/retry',
        method: 'POST',
      });
    });
    expect(screen.getByText('retrying')).toBeTruthy();
    expect(screen.getByText('Retry queued. Watching finished jobs below.')).toBeTruthy();
    expect(fakes.refetchFinishedJobs).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(requests[1]).toMatchObject({
        url: '/api/team/job-recovery/job-1/dismiss',
        method: 'POST',
      });
    });
    expect(screen.queryByText('Transcribe customer call')).toBeNull();
    expect(screen.getByText('No jobs need attention in this view.')).toBeTruthy();
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

    render(<JobRecoveryList items={[recoverableJob()]} />);
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

    render(
      <JobRecoveryList
        items={[
          recoverableJob(),
          recoverableJob({
            id: 'job-2',
            artifactId: 'raw-event-2',
            label: 'Transcribe board update',
            detectedAt: new Date('2026-07-02T11:00:00.000Z'),
          }),
        ]}
      />,
    );

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
    expect(screen.queryByText('Retried 1 failed jobs; 1 could not be queued.')).toBeNull();
    expect(screen.getByText('Retry queued. Watching finished jobs below.')).toBeTruthy();
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

    render(
      <JobRecoveryList
        defaultFilter="integration_sync"
        items={[
          recoverableJob(),
          recoverableJob({
            id: 'job-2',
            kind: 'integration_sync',
            artifactKind: 'integration',
            artifactId: 'integration-1',
            label: 'Sync Sentry issues',
            detectedAt: new Date('2026-07-02T11:00:00.000Z'),
          }),
        ]}
      />,
    );

    expect(screen.queryByText('Transcribe customer call')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss failed (1)' }));
    expect(screen.getByText('Dismiss 1 failed integration sync?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss failed' }));

    await waitFor(() => {
      expect(requests[0]).toMatchObject({
        url: '/api/team/job-recovery/dismiss-failed',
        method: 'POST',
      });
    });
    expect(requests[0]?.body).toMatchObject({
      kind: 'integration_sync',
      expectedCount: 1,
      items: [{ id: 'job-2', detectedAt: '2026-07-02T11:00:00.000Z' }],
    });
    expect(screen.queryByText('Sync Sentry issues')).toBeNull();
    expect(screen.getByText('No jobs need attention in this view.')).toBeTruthy();
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

    render(<JobRecoveryList items={[]} />);

    const archive = screen.getByRole('table');
    expect(within(archive).getByText('Transcribe customer call')).toBeTruthy();
    expect(within(archive).getByText('Sync Sentry issues')).toBeTruthy();
    expect(within(archive).getByText('provider unavailable')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fakes.fetchNextPage).toHaveBeenCalledOnce();

    cleanup();
    installFinishedJobsQuery({ error: new Error('archive offline') });
    render(<JobRecoveryList items={[]} />);
    expect(screen.getByText('archive offline')).toBeTruthy();
  });
});
