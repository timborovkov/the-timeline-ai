// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import DigestsError from '@/app/app/digests/error';
import DigestsLoading from '@/app/app/digests/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Digests route states', () => {
  it('retains Work context and lets keyboard users retry a failed digest history load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<DigestsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Digests' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Digests' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load digests' })).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('announces a row-shaped loading state', () => {
    render(<DigestsLoading />);
    expect(screen.getByLabelText('Loading digests').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Digests' })).toHaveLength(1);
  });
});
