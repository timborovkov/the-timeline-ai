import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { WorkFilterState } from '@/lib/work-filters';
import type { PropsWithChildren } from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadTaskCategoryFilterStateAction: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: fakes.refresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/objects'),
  () => ({
    // Bun links all named exports, including actions this suite must never invoke.
    searchObjectsAction: vi.fn(() => {
      throw new Error('Unexpected searchObjectsAction call in this test');
    }),
    searchAddableObjectsAction: vi.fn(() => {
      throw new Error('Unexpected searchAddableObjectsAction call in this test');
    }),
    loadTaskRowsAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskRowsAction call in this test');
    }),
    loadObjectRowsAction: vi.fn(() => {
      throw new Error('Unexpected loadObjectRowsAction call in this test');
    }),
    createObjectAction: vi.fn(() => {
      throw new Error('Unexpected createObjectAction call in this test');
    }),
    updateObjectAction: vi.fn(() => {
      throw new Error('Unexpected updateObjectAction call in this test');
    }),
    setTaskCategoryAction: vi.fn(() => {
      throw new Error('Unexpected setTaskCategoryAction call in this test');
    }),
    undoTaskCategoryChangeAction: vi.fn(() => {
      throw new Error('Unexpected undoTaskCategoryChangeAction call in this test');
    }),
    resetTaskCategoryAction: vi.fn(() => {
      throw new Error('Unexpected resetTaskCategoryAction call in this test');
    }),
    retryTaskCategoryAction: vi.fn(() => {
      throw new Error('Unexpected retryTaskCategoryAction call in this test');
    }),
    setTaskProjectAction: vi.fn(() => {
      throw new Error('Unexpected setTaskProjectAction call in this test');
    }),
    updateObjectMetadataAction: vi.fn(() => {
      throw new Error('Unexpected updateObjectMetadataAction call in this test');
    }),
    createIdentityFacetAction: vi.fn(() => {
      throw new Error('Unexpected createIdentityFacetAction call in this test');
    }),
    archiveIdentityFacetAction: vi.fn(() => {
      throw new Error('Unexpected archiveIdentityFacetAction call in this test');
    }),
    setPersonCompanyAction: vi.fn(() => {
      throw new Error('Unexpected setPersonCompanyAction call in this test');
    }),
    structureContactFromBoardNotesAction: vi.fn(() => {
      throw new Error('Unexpected structureContactFromBoardNotesAction call in this test');
    }),
    loadTaskPrimaryProjectsAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskPrimaryProjectsAction call in this test');
    }),
    unarchiveObjectAction: vi.fn(() => {
      throw new Error('Unexpected unarchiveObjectAction call in this test');
    }),
    archiveObjectAction: vi.fn(() => {
      throw new Error('Unexpected archiveObjectAction call in this test');
    }),
    pinObjectAction: vi.fn(() => {
      throw new Error('Unexpected pinObjectAction call in this test');
    }),
    unpinObjectAction: vi.fn(() => {
      throw new Error('Unexpected unpinObjectAction call in this test');
    }),
    bulkArchiveObjectsAction: vi.fn(() => {
      throw new Error('Unexpected bulkArchiveObjectsAction call in this test');
    }),
    mergeObjectsAction: vi.fn(() => {
      throw new Error('Unexpected mergeObjectsAction call in this test');
    }),
    findObjectCleanupSuggestionsAction: vi.fn(() => {
      throw new Error('Unexpected findObjectCleanupSuggestionsAction call in this test');
    }),
    repairObjectMemoryAction: vi.fn(() => {
      throw new Error('Unexpected repairObjectMemoryAction call in this test');
    }),
    addRelationshipAction: vi.fn(() => {
      throw new Error('Unexpected addRelationshipAction call in this test');
    }),
    removeRelationshipAction: vi.fn(() => {
      throw new Error('Unexpected removeRelationshipAction call in this test');
    }),
    createNoteAction: vi.fn(() => {
      throw new Error('Unexpected createNoteAction call in this test');
    }),
    updateNoteAction: vi.fn(() => {
      throw new Error('Unexpected updateNoteAction call in this test');
    }),
    deleteNoteAction: vi.fn(() => {
      throw new Error('Unexpected deleteNoteAction call in this test');
    }),
    generateObjectSummaryAction: vi.fn(() => {
      throw new Error('Unexpected generateObjectSummaryAction call in this test');
    }),
    markNotificationReadAction: vi.fn(() => {
      throw new Error('Unexpected markNotificationReadAction call in this test');
    }),
    markAllNotificationsReadAction: vi.fn(() => {
      throw new Error('Unexpected markAllNotificationsReadAction call in this test');
    }),
    acceptObjectChangeAction: vi.fn(() => {
      throw new Error('Unexpected acceptObjectChangeAction call in this test');
    }),
    rejectObjectChangeAction: vi.fn(() => {
      throw new Error('Unexpected rejectObjectChangeAction call in this test');
    }),
    loadTaskCategoryStatesAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskCategoryStatesAction call in this test');
    }),
    loadTaskCategoryFilterStateAction: fakes.loadTaskCategoryFilterStateAction,
  }),
  () => import('@/app/actions/objects'),
);

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { cleanup, render, waitFor } = await import('@testing-library/react');

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
