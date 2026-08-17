// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
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
  it('announces loading outside an inert, motion-safe placeholder while retaining route context', () => {
    const { container } = render(<JobsLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading background jobs');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading background jobs').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Background jobs' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/app/team');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Processing summary' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Finished jobs' })).toBeNull();

    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > section[aria-hidden="true"][inert]',
    );
    expect(visualPlaceholders).toHaveLength(1);
    const [placeholder] = visualPlaceholders;
    expect(placeholder?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    expect(placeholder?.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');

    const dashboard = placeholder?.querySelector('[aria-label="Loading job dashboard"]');
    if (!dashboard) throw new Error('Expected the visual job dashboard placeholder');
    expect(dashboard.tagName).toBe('UL');
    expect(dashboard.children).toHaveLength(6);
    expect(dashboard.firstElementChild?.className).toContain('rounded-sm');
    const recoveryControls = placeholder?.querySelector(
      '[aria-label="Job recovery controls loading placeholder"]',
    );
    if (!recoveryControls) throw new Error('Expected the visual job recovery controls placeholder');
    expect(recoveryControls.querySelectorAll('[data-loading-filter]')).toHaveLength(7);
    expect(recoveryControls.querySelector('[data-loading-action="retry"]')?.className).toContain(
      'h-8 w-28',
    );
    expect(recoveryControls.querySelector('[data-loading-action="dismiss"]')?.className).toContain(
      'h-8 w-32',
    );
    const finishedJobsTable = placeholder?.querySelector('table');
    if (!finishedJobsTable) throw new Error('Expected the visual finished jobs table placeholder');
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
