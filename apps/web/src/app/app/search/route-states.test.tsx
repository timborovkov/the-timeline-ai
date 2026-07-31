// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import SearchError from '@/app/app/search/error';
import SearchLoading from '@/app/app/search/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Search route states', () => {
  it('retains search context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<SearchError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Search' })).toHaveLength(1);
    expect(
      screen.getByText(
        'Search pages, workspace objects, tasks, boards, calendar, timeline events, and documents.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load search' })).toBeTruthy();
    expect(
      screen.getByText(
        'Your query and filters have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy, search-shaped fallback and retains one route heading', () => {
    render(<SearchLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading search');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading search').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Search' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Search loading placeholder' })).toBeTruthy();
  });
});
