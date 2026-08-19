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

import BoardError from '@/app/app/boards/[id]/error';
import BoardDetailLoading from '@/app/app/boards/[id]/loading';
import BoardsError from '@/app/app/boards/error';
import BoardsLoading from '@/app/app/boards/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fakes.searchParams = new URLSearchParams();
});

describe('Boards route states', () => {
  it('announces route-shaped responsive loading states outside inert busy visuals', () => {
    const { rerender } = render(<BoardsLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading boards');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading boards').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Boards' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe('page');
    const listSkeleton = document.querySelector('[aria-label="Boards list loading placeholder"]');
    expect(listSkeleton).toBeTruthy();
    expect(listSkeleton?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    expect(
      document.querySelector('[aria-label="Boards list loading placeholder"]')?.firstElementChild
        ?.className,
    ).toContain('border-t border-border');

    rerender(<BoardDetailLoading />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Loading board');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading board').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Board' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('navigation', { name: 'Work' }).closest('[aria-busy="true"]'),
    ).toBeNull();
    const detailSkeletons = document.querySelectorAll('[aria-hidden="true"][inert]');
    expect(detailSkeletons).toHaveLength(2);
    for (const detailSkeleton of detailSkeletons) {
      expect(detailSkeleton.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
    }
    expect(document.querySelector('[data-app-layout="full-bleed"]')).toBeTruthy();
    expect(document.querySelector('[data-loading-toolbar="collection"]')).toBeTruthy();
    expect(document.querySelector('[data-board-loading-view="kanban"]')).toBeTruthy();
    expect(
      document.querySelector('[data-board-loading-view="kanban"] .overflow-x-auto'),
    ).toBeTruthy();
    expect(document.querySelectorAll('.motion-reduce\\:animate-none')).not.toHaveLength(0);
  });

  it('uses a list-shaped board loading fallback for list and legacy table bookmarks', () => {
    fakes.searchParams = new URLSearchParams('view=table');
    const { container, unmount } = render(<BoardDetailLoading />);
    expect(container.querySelector('[data-board-loading-view="list"]')).toBeTruthy();
    expect(container.querySelector('[data-board-loading-view="kanban"]')).toBeNull();
    expect(container.querySelector('[data-board-loading-view="table"]')).toBeNull();
    expect(container.querySelector('[data-loading-toolbar="collection"]')).toBeTruthy();
    unmount();

    fakes.searchParams = new URLSearchParams('view=list');
    const list = render(<BoardDetailLoading />);
    expect(list.container.querySelector('[data-board-loading-view="list"]')).toBeTruthy();
    expect(list.container.querySelector('[data-board-loading-view="table"]')).toBeNull();
  });

  it.each([
    {
      name: 'boards',
      heading: 'Boards',
      errorHeading: 'Unable to load boards',
      subtitle: 'Curated work surfaces for the way your team operates.',
      description:
        'Boards could not be loaded. Your saved board data is unchanged. Check your connection, then try again.',
      Component: BoardsError,
    },
    {
      name: 'board',
      heading: 'Board',
      errorHeading: 'Unable to load board',
      subtitle: 'Review the work your team is tracking on this board.',
      description:
        'Board details could not be loaded. Your saved board data is unchanged. Check your connection, then try again.',
      Component: BoardError,
    },
  ])(
    'retains Work context and lets keyboard users retry a failed $name load',
    async ({ heading, errorHeading, subtitle, description, Component }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<Component error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: heading })).toHaveLength(1);
      if (subtitle) expect(screen.getByText(subtitle)).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(screen.getByRole('heading', { level: 2, name: errorHeading })).toBeTruthy();
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.getAllByRole('button')).toHaveLength(1);

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard('{Enter}');

      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
