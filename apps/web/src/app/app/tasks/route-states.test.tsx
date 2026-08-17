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

import TasksError from '@/app/app/tasks/error';
import TasksLoading from '@/app/app/tasks/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fakes.searchParams = new URLSearchParams();
});

describe('Tasks route states', () => {
  it.each([
    { name: 'Enter', keys: '{Enter}' },
    { name: 'Space', keys: ' ' },
  ])(
    'retains task context and lets keyboard users retry a failed load with $name',
    async ({ keys }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<TasksError error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1, name: 'Tasks' })).toHaveLength(1);
      expect(screen.getByText('Assigned work and follow-ups from your timeline.')).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
      expect(screen.getByRole('heading', { level: 2, name: 'Unable to load tasks' })).toBeTruthy();
      expect(
        screen.getByText(
          'Your saved tasks and task-board state are unchanged. Check your connection, then try again.',
        ),
      ).toBeTruthy();

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard(keys);

      expect(reset).toHaveBeenCalledOnce();
    },
  );

  it('announces an inert, responsive loading fallback outside the busy state', () => {
    const { container } = render(<TasksLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading tasks');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading tasks').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByLabelText('Loading tasks').getAttribute('data-app-layout')).toBe(
      'full-bleed',
    );
    expect(screen.getAllByRole('heading', { level: 1, name: 'Tasks' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const visualPlaceholders = container.querySelectorAll(
      '[aria-busy="true"] > [aria-hidden="true"][inert]',
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
    expect(container.querySelector('[data-tasks-loading-view="list"]')).toBeTruthy();
    expect(container.querySelector('[data-tasks-loading-view="kanban"]')).toBeNull();
  });

  it('uses a kanban-shaped loading fallback only when that view is requested', () => {
    fakes.searchParams = new URLSearchParams('view=kanban');
    const { container } = render(<TasksLoading />);

    const view = container.querySelector('[data-tasks-loading-view="kanban"]');
    expect(view).toBeTruthy();
    expect(container.querySelector('[data-tasks-loading-view="list"]')).toBeNull();
    const columns = [...(view?.querySelectorAll('div') ?? [])].filter((element) =>
      element.className.includes('min(260px'),
    );
    expect(columns).toHaveLength(5);
  });
});
