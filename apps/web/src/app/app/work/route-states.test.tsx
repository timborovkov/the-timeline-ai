// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  reportCaughtError: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('next/navigation', () => ({ useSearchParams: () => fakes.searchParams }));

import WorkError from '@/app/app/work/error';
import WorkLoading from '@/app/app/work/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fakes.searchParams = new URLSearchParams();
});

describe('Work route states', () => {
  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains work context and lets keyboard users retry a failed load with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<WorkError error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Work' })).toHaveLength(1);
      expect(
        screen.getByText('Prioritized work that needs a decision, owner, or next action.'),
      ).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(screen.getByRole('heading', { level: 2, name: 'Unable to load work' })).toBeTruthy();
      expect(
        screen.getByText(
          'Your saved work queue, pins, and board state are unchanged. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );

  it('retains the pinned work subnavigation state while recovering', () => {
    fakes.searchParams = new URLSearchParams('view=pinned');

    const { rerender } = render(<WorkLoading />);

    expect(screen.getByRole('link', { name: 'Pinned' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
    const pinnedSkeleton = document.querySelector('[data-work-loading-view="pinned"]');
    expect(pinnedSkeleton).toBeTruthy();
    expect(pinnedSkeleton?.querySelector('[data-loading-toolbar="collection"]')).toBeTruthy();
    expect(pinnedSkeleton?.firstElementChild?.className).toContain('border-b');
    expect(pinnedSkeleton?.innerHTML).not.toContain('overflow-hidden border border-border');
    expect(pinnedSkeleton?.innerHTML).not.toContain('border-x');

    rerender(<WorkError error={new Error('route failed')} reset={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Pinned' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
    expect(
      screen.getByText('Personal shortcuts to the work and context you return to.'),
    ).toBeTruthy();
  });

  it('announces route-shaped loading outside the busy fallback and hides visual skeletons', () => {
    const { container } = render(<WorkLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading work');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading work').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Work' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.queryByText('Work queue')).toBeNull();
    expect(screen.queryByText('Pinned and team boards')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"]',
    );
    expect(visualPlaceholders.length).toBeGreaterThan(0);
    for (const visualPlaceholder of visualPlaceholders) {
      expect(visualPlaceholder.querySelectorAll('a, button, input, select, textarea')).toHaveLength(
        0,
      );
    }
    const skeletons = [...visualPlaceholders].flatMap((placeholder) => [
      ...placeholder.querySelectorAll('.animate-pulse'),
    ]);
    expect(skeletons.length).toBeGreaterThan(0);
    for (const skeleton of skeletons) {
      expect(skeleton.className).toContain('motion-reduce:animate-none');
    }
  });
});
