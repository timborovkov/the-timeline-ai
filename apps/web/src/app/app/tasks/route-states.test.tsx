// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import TasksError from '@/app/app/tasks/error';
import TasksLoading from '@/app/app/tasks/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Tasks route states', () => {
  it('retains task context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<TasksError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Tasks' })).toHaveLength(1);
    expect(screen.getByText('Assigned work and follow-ups from your timeline.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load tasks' })).toBeTruthy();
    expect(
      screen.getByText('Tasks could not be loaded. Check your connection, then try again.'),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy fallback and retains the route heading', () => {
    render(<TasksLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading tasks');
    expect(screen.getByLabelText('Loading tasks').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Tasks' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('region', { name: 'Task board loading placeholder' })).toBeTruthy();
  });
});
