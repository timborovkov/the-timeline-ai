import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as objects from '@timeline/shared/objects/types';
import type { ReactNode } from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  confirm: vi.fn(),
  bulkArchiveObjectsAction: vi.fn(),
  updateObjectAction: vi.fn(),
  notifyAction: vi.fn(),
  notifyError: vi.fn(),
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
  import.meta.resolve('@/components/ui/app-dialog'),
  () => ({
    useAppDialog: () => ({ confirm: fakes.confirm }),
  }),
  () => import('@/components/ui/app-dialog'),
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
    createObjectAction: vi.fn(() => {
      throw new Error('Unexpected createObjectAction call in this test');
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
    loadTaskCategoryFilterStateAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskCategoryFilterStateAction call in this test');
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
    bulkArchiveObjectsAction: fakes.bulkArchiveObjectsAction,
    updateObjectAction: fakes.updateObjectAction,
    loadObjectRowsAction: vi.fn(),
  }),
  () => import('@/app/actions/objects'),
);
await vi.mock(
  import.meta.resolve('@/components/collections/virtual-list'),
  () => ({
    VirtualList: ({
      items,
      renderItem,
      getItemKey,
    }: {
      items: { id: string }[];
      renderItem: (item: { id: string }, index: number) => ReactNode;
      getItemKey: (item: { id: string }, index: number) => string;
    }) =>
      createElement(
        'div',
        null,
        items.map((item, index) =>
          createElement('div', { key: getItemKey(item, index) }, renderItem(item, index)),
        ),
      ),
  }),
  () => import('@/components/collections/virtual-list'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async (options: { run: () => Promise<{ error?: string }> }) => {
      fakes.notifyAction(options);
      return options.run();
    },
    notifyError: (id: string, message: string) => {
      fakes.notifyError(id, message);
    },
  }),
  () => import('@/lib/notify'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { createElement } = await import('react');

const { ObjectCleanupList } = await import('./object-cleanup-list.js');

function object(input: Partial<objects.ObjectRow> = {}): objects.ObjectRow {
  return {
    id: 'object-1',
    type: 'task',
    canonicalName: 'Legacy suggested cleanup row',
    status: 'suggested',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: true,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    archivedAt: null,
    aliases: [],
    metadata: {},
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    ...input,
  };
}

describe('ObjectCleanupList', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fakes.confirm.mockResolvedValue(false);
    fakes.bulkArchiveObjectsAction.mockResolvedValue({ ok: true });
    fakes.updateObjectAction.mockResolvedValue({ ok: true });
  });

  it('does not render legacy agentSuggested badges on object rows', () => {
    render(<ObjectCleanupList rows={[object()]} typeLabels={{ task: 'Task' }} />);

    expect(screen.getByRole('link', { name: 'Legacy suggested cleanup row' })).toBeTruthy();
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.queryByText('Suggested', { selector: '.text-signal' })).toBeNull();
  });

  it('shows missing due state only for schedulable objects', () => {
    render(
      <ObjectCleanupList
        rows={[
          object({ id: 'task-1', canonicalName: 'Task without date' }),
          object({ id: 'person-1', type: 'person', canonicalName: 'Person record' }),
        ]}
        typeLabels={{ task: 'Task', person: 'People' }}
      />,
    );

    expect(screen.getAllByText('No due date')).toHaveLength(1);
  });

  it('does not expose a disabled merge action as a keyboard-activatable link', async () => {
    const user = userEvent.setup();
    render(
      <ObjectCleanupList
        rows={[
          object({ id: 'object-1', canonicalName: 'First object' }),
          object({ id: 'object-2', canonicalName: 'Second object' }),
        ]}
        typeLabels={{ task: 'Task' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(screen.queryByRole('link', { name: 'Merge' })).toBeNull();
    expect(screen.queryByText('Merge')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Select First object' }));
    expect(screen.getByRole('status', { name: '1 object selected' }).textContent).toBe(
      '1 object selected',
    );
    expect(screen.getByText('Merge').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Merge' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Select Second object' }));
    expect(screen.getByRole('status', { name: '2 objects selected' }).textContent).toBe(
      '2 objects selected',
    );
    expect(screen.getByRole('link', { name: 'Merge' }).getAttribute('href')).toContain(
      '/app/objects/merge?ids=object-1%2Cobject-2',
    );
  });

  it('edits displayed metadata optimistically from quiet row triggers', async () => {
    const user = userEvent.setup();
    render(<ObjectCleanupList rows={[object()]} typeLabels={{ task: 'Task' }} />);

    await user.click(
      screen.getByRole('button', { name: 'Status for Legacy suggested cleanup row' }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'doing');

    expect(fakes.updateObjectAction).toHaveBeenCalledWith({
      id: 'object-1',
      status: 'doing',
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Status for Legacy suggested cleanup row' }).textContent,
      ).toContain('In progress');
    });
  });

  it('rolls failed metadata edits back and reports the row error', async () => {
    const user = userEvent.setup();
    fakes.updateObjectAction.mockResolvedValueOnce({ error: 'Connection lost' });
    render(<ObjectCleanupList rows={[object()]} typeLabels={{ task: 'Task' }} />);

    await user.click(
      screen.getByRole('button', { name: 'Priority for Legacy suggested cleanup row' }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), '1');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Priority for Legacy suggested cleanup row' })
          .textContent,
      ).toContain('No priority');
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Couldn’t update priority',
        }),
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
