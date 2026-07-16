// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkFilterState } from '@/lib/work-filters';
import type { PropsWithChildren } from 'react';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadTaskCategoryFilterStateAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryFilterStateAction: fakes.loadTaskCategoryFilterStateAction,
}));

const { TaskCategoryFilterRefresh } = await import('./task-category-filter-refresh.js');

const FILTERS: WorkFilterState = {
  q: '',
  type: '',
  status: '',
  category: 'design',
  project: '',
  stage: '',
  owner: '',
  assignee: '',
  responsible: '',
  lane: '',
  priority: '',
  due: '',
  dueFrom: '',
  dueTo: '',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
};

function renderRefresh(surface: 'tasks' | 'objects' | 'board' = 'tasks') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskCategoryFilterRefresh
        surface={surface}
        {...(surface === 'board' ? { boardId: '11111111-1111-4111-8111-111111111111' } : {})}
        filters={FILTERS}
        baselineToken="design:7"
      />
    </QueryClientProvider>,
    {
      wrapper: ({ children }: PropsWithChildren) => children,
    },
  );
}

describe('TaskCategoryFilterRefresh', () => {
  beforeEach(() => {
    fakes.refresh.mockReset();
    fakes.loadTaskCategoryFilterStateAction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('refreshes when a relevant task category changed after the server render', async () => {
    fakes.loadTaskCategoryFilterStateAction.mockResolvedValue({
      state: { token: 'design:8', changed: true, pending: false },
    });

    renderRefresh('objects');

    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledOnce();
    });
    expect(fakes.loadTaskCategoryFilterStateAction).toHaveBeenCalledWith({
      surface: 'objects',
      filters: FILTERS,
      baselineToken: 'design:7',
    });
  });

  it('stops after one request when no relevant categories are pending', async () => {
    fakes.loadTaskCategoryFilterStateAction.mockResolvedValue({
      state: { token: 'design:7', changed: false, pending: false },
    });

    renderRefresh('board');

    await waitFor(() => {
      expect(fakes.loadTaskCategoryFilterStateAction).toHaveBeenCalledOnce();
    });
    expect(fakes.refresh).not.toHaveBeenCalled();
  });
});
