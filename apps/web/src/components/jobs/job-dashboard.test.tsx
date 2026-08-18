// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refetch: vi.fn(),
  useJobDashboardQuery: vi.fn(),
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useJobDashboardQuery: fakes.useJobDashboardQuery,
}));

const { JobDashboard } = await import('./job-dashboard.js');

const dashboardData = {
  updatedAt: '2026-07-30T12:00:00.000Z',
  summaries: [
    { kind: 'transcription', label: 'Transcription', needsAttention: 2 },
    { kind: 'extraction', label: 'Extraction', needsAttention: 1 },
  ],
};

function installJobDashboardQuery(
  input: {
    data?: typeof dashboardData;
    error?: Error;
    isFetching?: boolean;
    isPending?: boolean;
  } = {},
) {
  fakes.useJobDashboardQuery.mockReturnValue({
    data: input.data,
    error: input.error ?? null,
    isError: Boolean(input.error),
    isFetching: input.isFetching ?? false,
    isPending: input.isPending ?? false,
    refetch: fakes.refetch,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.refetch.mockResolvedValue(undefined);
  installJobDashboardQuery({ data: dashboardData });
});

afterEach(() => {
  cleanup();
});

describe('JobDashboard', () => {
  it('renders a structure-matching busy state while the dashboard loads', () => {
    installJobDashboardQuery({ isFetching: true, isPending: true });

    render(<JobDashboard />);

    expect(screen.getByLabelText('Loading job dashboard').getAttribute('aria-busy')).toBe('true');
  });

  it('renders the current unprocessed backlog counts', () => {
    render(<JobDashboard />);

    const transcription = screen.getByText('Transcription').closest('li');
    expect(transcription).not.toBeNull();
    expect(within(transcription as HTMLElement).getByText('2')).toBeTruthy();

    const extraction = screen.getByText('Extraction').closest('li');
    expect(extraction).not.toBeNull();
    expect(within(extraction as HTMLElement).getByText('1')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Updated');
    expect(document.querySelector('time')?.dateTime).toBe(dashboardData.updatedAt);
  });

  it('explains a dashboard load failure, retains refresh, and keeps raw details closed', () => {
    const rawError = 'Request failed (500): worker Redis connection timed out';
    installJobDashboardQuery({ error: new Error(rawError) });

    render(<JobDashboard />);

    expect(screen.getByRole('alert').textContent).toContain('Unable to load the jobs dashboard');
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry dashboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh job dashboard' })).toBeTruthy();

    const details = screen.getByText('Technical details').closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText(rawError)).toBeTruthy();
  });

  it('keeps the last processing summary available when a background refresh fails', () => {
    installJobDashboardQuery({
      data: dashboardData,
      error: new Error('Request failed (503): dashboard cache unavailable'),
    });

    render(<JobDashboard />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Transcription')).toBeTruthy();
    expect(screen.getByText('Extraction')).toBeTruthy();
  });

  it('retries from the recovery state and refreshes from the dashboard toolbar', async () => {
    const user = userEvent.setup();
    installJobDashboardQuery({ error: new Error('Network timeout') });

    render(<JobDashboard />);

    await user.click(screen.getByRole('button', { name: 'Retry dashboard' }));
    expect(fakes.refetch).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Refresh job dashboard' }));
    expect(fakes.refetch).toHaveBeenCalledTimes(2);
  });
});
