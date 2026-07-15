// @vitest-environment happy-dom

/** Business intent: each pending task detail gets its own bounded freshness window. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render as testingRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PropsWithChildren, ReactElement } from 'react';

const fakes = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    refresh,
    router: { refresh },
    loadTaskCategoryStatesAction: vi.fn(),
    setTaskCategoryAction: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => fakes.router }));
vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
  resetTaskCategoryAction: vi.fn(),
  retryTaskCategoryAction: vi.fn(),
  setTaskCategoryAction: fakes.setTaskCategoryAction,
  undoTaskCategoryChangeAction: vi.fn(),
}));

const [{ TaskCategoryBadge }, { TaskCategorySelect }] = await Promise.all([
  import('./task-category-badge.js'),
  import('./task-category-select.js'),
]);

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY, retry: false } },
  });
  return testingRender(ui, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('TaskCategorySelect', () => {
  beforeEach(() => {
    fakes.refresh.mockReset();
    fakes.loadTaskCategoryStatesAction.mockReset();
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({ rows: [] });
    fakes.setTaskCategoryAction.mockReset();
  });

  afterEach(() => {
    cleanup();
    delete document.body.dataset.taskCategoriesEnabled;
    vi.useRealTimers();
  });

  it('starts a fresh polling window when a pending detail switches tasks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T10:00:00.000Z'));
    const view = render(
      <TaskCategorySelect taskId="task-1" category={null} mode="automatic" status="pending" />,
    );
    act(() => {
      vi.advanceTimersByTime(63_000);
    });
    fakes.loadTaskCategoryStatesAction.mockClear();

    view.rerender(
      <TaskCategorySelect taskId="task-2" category={null} mode="automatic" status="pending" />,
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledWith({ ids: ['task-2'] });
  });

  it('continues polling at a slower cadence after the fast freshness window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T10:00:00.000Z'));
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [{ taskCategoryStatus: 'pending' }],
    });
    render(
      <TaskCategorySelect taskId="task-1" category={null} mode="automatic" status="pending" />,
    );

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    fakes.loadTaskCategoryStatesAction.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledWith({ ids: ['task-1'] });
  });

  it('does not poll while the category UI is disabled', () => {
    vi.useFakeTimers();
    document.body.dataset.taskCategoriesEnabled = 'false';
    render(
      <TaskCategorySelect taskId="task-1" category={null} mode="automatic" status="pending" />,
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
  });

  it('does not poll when the task is not pending', async () => {
    vi.useFakeTimers();
    render(
      <TaskCategorySelect taskId="task-1" category="design" mode="automatic" status="ready" />,
    );

    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
  });

  it('stops polling after the category reaches a terminal state', async () => {
    vi.useFakeTimers();
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [{ id: 'task-1', taskCategoryStatus: 'ready' }],
    });
    render(
      <TaskCategorySelect taskId="task-1" category={null} mode="automatic" status="pending" />,
    );

    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledOnce();
    fakes.loadTaskCategoryStatesAction.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
  });

  it('keeps the selector pending until the category mutation settles', async () => {
    let resolveMutation: (value: { undoChangeId: string }) => void = () => undefined;
    fakes.setTaskCategoryAction.mockReturnValue(
      new Promise<{ undoChangeId: string }>((resolve) => {
        resolveMutation = resolve;
      }),
    );
    render(<TaskCategorySelect taskId="task-1" category={null} mode="automatic" status="ready" />);

    const selector = screen.getByRole('combobox', { name: 'Task category' });
    await userEvent.selectOptions(selector, 'design');

    expect((selector as HTMLSelectElement).disabled).toBe(true);
    expect(fakes.setTaskCategoryAction).toHaveBeenCalledWith({
      id: 'task-1',
      category: 'design',
    });

    act(() => {
      resolveMutation({ undoChangeId: 'change-1' });
    });
    await waitFor(() => {
      expect((selector as HTMLSelectElement).disabled).toBe(false);
    });
    expect(fakes.refresh).toHaveBeenCalledOnce();
  });
});

describe('TaskCategoryBadge', () => {
  it('shows pending and failed state while retaining the last category', () => {
    const view = render(<TaskCategoryBadge category="engineering" status="pending" />);
    expect(screen.getByText('Engineering · Categorizing…')).toBeTruthy();

    view.rerender(<TaskCategoryBadge category="engineering" status="failed" />);
    expect(screen.getByText('Engineering · Retry')).toBeTruthy();

    view.rerender(<TaskCategoryBadge category={null} status="failed" />);
    expect(screen.getByText('Category failed · Retry')).toBeTruthy();
  });
});
