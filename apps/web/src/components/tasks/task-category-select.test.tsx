// @vitest-environment happy-dom

/** Business intent: each pending task detail gets its own bounded freshness window. */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadTaskCategoryStatesAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
  resetTaskCategoryAction: vi.fn(),
  retryTaskCategoryAction: vi.fn(),
  setTaskCategoryAction: vi.fn(),
  undoTaskCategoryChangeAction: vi.fn(),
}));

const { TaskCategorySelect } = await import('./task-category-select.js');

describe('TaskCategorySelect', () => {
  beforeEach(() => {
    fakes.refresh.mockReset();
    fakes.loadTaskCategoryStatesAction.mockReset();
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    cleanup();
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
});
