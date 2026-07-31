// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import WorkError from '@/app/app/work/error';
import WorkLoading from '@/app/app/work/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Work route states', () => {
  it('retains neutral work context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<WorkError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Work' })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load work' })).toBeTruthy();
    expect(
      screen.getByText('Work could not be loaded. Check your connection, then try again.'),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces a neutral loading state outside the busy fallback', () => {
    render(<WorkLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading work');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading work').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Work' })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    expect(screen.queryByText('Work queue')).toBeNull();
    expect(screen.getByRole('region', { name: 'Work loading placeholder' })).toBeTruthy();
  });
});
