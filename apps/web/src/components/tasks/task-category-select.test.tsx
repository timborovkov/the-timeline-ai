// @vitest-environment happy-dom

/** Business intent: each pending task detail gets its own bounded freshness window. */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadTaskCategoryStatesAction: vi.fn(),
  setTaskCategoryAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
  resetTaskCategoryAction: vi.fn(),
  retryTaskCategoryAction: vi.fn(),
  setTaskCategoryAction: fakes.setTaskCategoryAction,
  undoTaskCategoryChangeAction: vi.fn(),
}));

const { TaskCategorySelect } = await import('./task-category-select.js');

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
