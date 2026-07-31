// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ back: vi.fn(), reportCaughtError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: fakes.back }) }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import JobsError from '@/app/app/team/jobs/error';
import JobsLoading from '@/app/app/team/jobs/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Background jobs route states', () => {
  it('announces a route-shaped loading state outside the busy operator view', () => {
    render(<JobsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading background jobs');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading background jobs').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Background jobs' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/app/team');
    expect(
      screen.getByRole('region', { name: 'Background jobs loading placeholder' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Processing summary' })).toBeTruthy();
    expect(screen.getByText('Processing activity')).toBeTruthy();
    const dashboard = screen.getByLabelText('Loading job dashboard');
    expect(dashboard.tagName).toBe('UL');
    expect(dashboard.children).toHaveLength(6);
    expect(dashboard.firstElementChild?.className).toContain('rounded-lg');
    expect(screen.getByRole('region', { name: 'Conversation suggestions' })).toBeTruthy();
    const recoveryControls = screen.getByRole('region', {
      name: 'Job recovery controls loading placeholder',
    });
    expect(recoveryControls.querySelectorAll('[data-loading-filter]')).toHaveLength(7);
    expect(recoveryControls.querySelector('[data-loading-action="retry"]')?.className).toContain(
      'h-8 w-28',
    );
    expect(recoveryControls.querySelector('[data-loading-action="dismiss"]')?.className).toContain(
      'h-8 w-32',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Finished jobs' })).toBeTruthy();
    const finishedJobs = screen.getByRole('region', { name: 'Finished jobs' });
    const finishedJobsTable = within(finishedJobs).getByRole('table');
    expect(finishedJobsTable.className).toContain('min-w-[760px]');
    expect(finishedJobsTable.querySelectorAll('th')).toHaveLength(6);
    expect(finishedJobsTable.parentElement?.className).toContain('overflow-x-auto');
  });

  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])('retains operator context and retries safely with $name', async ({ keys }) => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<JobsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Background jobs' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/app/team');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load background jobs' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'No background work has been retried, dismissed, or changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard(keys);

    expect(reset).toHaveBeenCalledOnce();
  });
});
