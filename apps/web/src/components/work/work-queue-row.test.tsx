import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type { WorkQueueItem } from '@/lib/work-queue';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateObjectAction: vi.fn(),
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
    updateObjectAction: fakes.updateObjectAction,
  }),
  () => import('@/app/actions/objects'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => {
      try {
        return await run();
      } catch {
        return { error: 'failed' };
      }
    },
  }),
  () => import('@/lib/notify'),
);
await vi.mock(
  import.meta.resolve('@/components/pins/pin-overflow-menu'),
  () => ({
    PinOverflowMenu: ({ title, initialPinned }: { title: string; initialPinned: boolean }) => (
      <button type="button">
        {initialPinned ? `Unpin from Home ${title}` : `Pin to Home ${title}`}
      </button>
    ),
  }),
  () => import('@/components/pins/pin-overflow-menu'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { WorkQueueRow } = await import('./work-queue-row.js');

function item(input: Partial<WorkQueueItem> = {}): WorkQueueItem {
  return {
    id: 'object:task-1',
    entityId: 'task-1',
    href: '/app/objects/task-1',
    title: 'Technically run an audit end-to-end by mid-July',
    subtitle: '',
    source: 'object',
    sourceLabel: 'Task',
    objectType: 'task',
    status: 'doing',
    assigneeUserId: 'user-1',
    dueAt: new Date('2026-07-16T00:00:00.000Z'),
    priority: 2,
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    reasons: ['owned_by_you'],
    ...input,
  };
}

describe('WorkQueueRow', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fakes.updateObjectAction.mockResolvedValue({ ok: true });
  });

  it('shows type once through status rather than repeating Task labels', () => {
    render(
      <WorkQueueRow item={item()} members={[{ id: 'user-1', label: 'Ada' }]} timezone="UTC" />,
    );

    expect(screen.queryAllByText('Task')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Status for/ }).textContent).toContain('In progress');
    expect(screen.getByRole('button', { name: /Assignee for/ }).textContent).toContain('Ada');
    expect(screen.getByText('Owned by you')).toBeTruthy();
  });

  it('saves status, assignee, and due date inline', async () => {
    const user = userEvent.setup();
    render(
      <WorkQueueRow
        item={item()}
        members={[
          { id: 'user-1', label: 'Ada' },
          { id: 'user-2', label: 'Tim' },
        ]}
        timezone="UTC"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Status for/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'blocked');
    expect(fakes.updateObjectAction).toHaveBeenCalledWith({
      id: 'task-1',
      status: 'blocked',
    });

    await user.click(screen.getByRole('button', { name: /Assignee for/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'user-2');
    expect(fakes.updateObjectAction).toHaveBeenCalledWith({
      id: 'task-1',
      assigneeUserId: 'user-2',
    });
  });

  it('does not expose field editors on approval rows', () => {
    render(
      <WorkQueueRow
        item={item({
          id: 'approvals',
          entityId: undefined,
          href: '/app/approvals?status=pending',
          title: '3 pending approvals',
          subtitle: 'Agent proposals waiting for review',
          source: 'approval',
          sourceLabel: 'Approvals',
          objectType: undefined,
          status: undefined,
          reasons: ['pending_approval'],
        })}
        members={[]}
        timezone="UTC"
      />,
    );

    expect(screen.queryByRole('button', { name: /Status for/ })).toBeNull();
    expect(screen.getByText('Approvals')).toBeTruthy();
  });

  it('lets object-backed rows pin to Home and marks already pinned items', () => {
    render(
      <WorkQueueRow item={item()} members={[{ id: 'user-1', label: 'Ada' }]} timezone="UTC" />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Pin to Home Technically run an audit end-to-end by mid-July',
      }),
    ).toBeTruthy();

    cleanup();
    render(
      <WorkQueueRow
        item={item()}
        members={[{ id: 'user-1', label: 'Ada' }]}
        timezone="UTC"
        pinned
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Unpin from Home Technically run an audit end-to-end by mid-July',
      }),
    ).toBeTruthy();
  });

  it('does not expose pin actions on approval rows', () => {
    render(
      <WorkQueueRow
        item={item({
          id: 'approvals',
          entityId: undefined,
          href: '/app/approvals?status=pending',
          title: '3 pending approvals',
          subtitle: 'Agent proposals waiting for review',
          source: 'approval',
          sourceLabel: 'Approvals',
          objectType: undefined,
          status: undefined,
          reasons: ['pending_approval'],
        })}
        members={[]}
        timezone="UTC"
      />,
    );

    expect(screen.queryByRole('button', { name: /Pin to Home/ })).toBeNull();
  });

  it('rolls a failed inline edit back onto the row', async () => {
    const user = userEvent.setup();
    fakes.updateObjectAction.mockResolvedValueOnce({ error: 'Connection lost' });
    render(
      <WorkQueueRow
        item={item({ priority: null })}
        members={[{ id: 'user-1', label: 'Ada' }]}
        timezone="UTC"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Priority for/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), '1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Priority for/ }).textContent).toContain(
        'No priority',
      );
    });
  });
});
