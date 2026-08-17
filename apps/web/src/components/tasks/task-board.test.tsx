// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render as testingRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';
import type { PropsWithChildren, ReactElement } from 'react';

const fakes = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    refresh,
    router: { refresh },
    updateObjectAction: vi.fn(),
    loadTaskRowsAction: vi.fn(),
    loadTaskPrimaryProjectsAction: vi.fn(),
    loadTaskCategoryStatesAction: vi.fn(),
    setTaskCategoryAction: vi.fn(),
    resetTaskCategoryAction: vi.fn(),
    pinObjectAction: vi.fn(),
    unpinObjectAction: vi.fn(),
    searchObjectsAction: vi.fn(),
    setTaskProjectAction: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => fakes.router }));
vi.mock('@/app/actions/objects', () => ({
  updateObjectAction: fakes.updateObjectAction,
  loadTaskRowsAction: fakes.loadTaskRowsAction,
  loadTaskPrimaryProjectsAction: fakes.loadTaskPrimaryProjectsAction,
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
  setTaskCategoryAction: fakes.setTaskCategoryAction,
  resetTaskCategoryAction: fakes.resetTaskCategoryAction,
  pinObjectAction: fakes.pinObjectAction,
  unpinObjectAction: fakes.unpinObjectAction,
  searchObjectsAction: fakes.searchObjectsAction,
  setTaskProjectAction: fakes.setTaskProjectAction,
}));
vi.mock('@/app/actions/pins', () => ({
  pinTargetAction: fakes.pinObjectAction,
  unpinTargetAction: fakes.unpinObjectAction,
}));
vi.mock('@/lib/task-board-config', () => ({
  TASK_BOARD_COLUMN_RENDER_LIMIT: 3,
  TASK_BOARD_LIST_RENDER_LIMIT: 5,
  TASK_BOARD_PAGE_SIZE: 500,
  TASK_BOARD_TOTAL_LIMIT: 50_000,
  TASK_OPEN_STATUSES_EXCLUDED: ['done', 'cancelled'],
}));

const { TaskBoard } = await import('./task-board.js');

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY, retry: 1, retryDelay: 0 } },
  });
  return testingRender(ui, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

async function chooseTaskProject(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /^Task project:/ }));
  await userEvent.click(screen.getByRole('button', { name }));
}

function task(input: Partial<objects.ObjectRow> = {}): objects.ObjectRow {
  return {
    id: 'task-1',
    type: 'task',
    canonicalName: 'Send proposal',
    status: 'todo',
    stage: null,
    priority: 2,
    ownerUserId: null,
    assigneeUserId: 'user-1',
    dueAt: new Date('2099-07-04T00:00:00.000Z'),
    agentSuggested: false,
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

function connectedWork(): objects.ObjectDetail['connectedWork'] {
  return {
    openTasks: [],
    recentTasks: [],
    calendarEvents: [],
    timelineEvents: [
      {
        id: 'event-1',
        source: 'telegram',
        contentText: 'Pilot doc and screenshot are here',
        occurredAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
    objects: [],
    boards: [],
    pendingApprovals: [],
    documents: [
      {
        id: 'document-1',
        name: 'Pilot brief.pdf',
        fileKind: 'document',
        updatedAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
    links: [
      {
        id: 'link-1',
        canonicalName: 'example.com/pilot',
        canonicalUrl: 'https://example.com/pilot',
        displayUrl: 'example.com/pilot',
        domain: 'example.com',
        provider: null,
        updatedAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
    capturedFiles: [
      {
        id: 'file-1',
        name: 'screenshot.png',
        contentType: 'image/png',
        sourceRawEventId: 'event-1',
        updatedAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
  };
}

function renderBoard(
  selectedTaskId: string | null = null,
  rows: objects.ObjectRow[] = [task()],
  view: 'kanban' | 'list' = 'kanban',
  filterParams: Record<string, string> = {},
  selectedTaskContext?: objects.ObjectDetail['connectedWork'] | null,
) {
  return render(
    <TaskBoard
      rows={rows}
      columns={['backlog', 'open', 'doing', 'blocked', 'done', 'cancelled']}
      selectedTaskId={selectedTaskId}
      selectedTaskContext={selectedTaskContext}
      view={view}
      members={[
        { id: 'user-1', label: 'Ada Lovelace' },
        { id: 'user-2', label: 'Grace Hopper' },
      ]}
      totalCount={rows.length}
      nextCursor={null}
      filterParams={filterParams}
    />,
  );
}

describe('TaskBoard', () => {
  beforeEach(() => {
    cleanup();
    delete document.body.dataset.taskCategoriesEnabled;
    fakes.refresh.mockReset();
    fakes.updateObjectAction.mockReset();
    fakes.loadTaskRowsAction.mockReset();
    fakes.loadTaskPrimaryProjectsAction.mockReset();
    fakes.loadTaskCategoryStatesAction.mockReset();
    fakes.setTaskCategoryAction.mockReset();
    fakes.resetTaskCategoryAction.mockReset();
    fakes.searchObjectsAction.mockReset();
    fakes.setTaskProjectAction.mockReset();
    fakes.updateObjectAction.mockResolvedValue({ ok: true });
    fakes.loadTaskRowsAction.mockResolvedValue({ rows: [], nextCursor: null });
    fakes.loadTaskPrimaryProjectsAction.mockResolvedValue({ rows: [] });
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({ rows: [] });
    fakes.setTaskCategoryAction.mockResolvedValue({ ok: true });
    fakes.resetTaskCategoryAction.mockResolvedValue({ ok: true });
    fakes.searchObjectsAction.mockResolvedValue({ results: [] });
    fakes.setTaskProjectAction.mockResolvedValue({ ok: true });
  });

  it('opens a task side panel route from the card instead of object detail', () => {
    renderBoard();

    const link = screen.getByRole('link', { name: 'Send proposal' });

    expect(link.getAttribute('href')).toBe('/app/tasks?task=task-1');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Due Jul 4, 2099')).toBeTruthy();
    expect(screen.getByText('P2')).toBeTruthy();
  });

  it('starts a fresh category polling window when the pending task set changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T10:00:00.000Z'));
    try {
      const first = task({ id: 'task-1', taskCategoryStatus: 'pending' });
      const view = renderBoard(null, [first]);
      act(() => {
        vi.advanceTimersByTime(62_500);
      });
      fakes.loadTaskCategoryStatesAction.mockClear();

      const second = task({
        id: 'task-2',
        canonicalName: 'Newly pending task',
        taskCategoryStatus: 'pending',
      });
      view.rerender(
        <TaskBoard
          rows={[first, second]}
          columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
          selectedTaskId={null}
          view="kanban"
          members={[
            { id: 'user-1', label: 'Ada Lovelace' },
            { id: 'user-2', label: 'Grace Hopper' },
          ]}
          totalCount={2}
          nextCursor={null}
          filterParams={{}}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(2_500);
      });

      expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledWith({
        ids: ['task-1', 'task-2'],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues polling pending cards after the fast freshness window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T10:00:00.000Z'));
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [{ id: 'task-1', taskCategoryStatus: 'pending' }],
    });
    try {
      renderBoard(null, [task({ taskCategoryStatus: 'pending' })]);

      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      fakes.loadTaskCategoryStatesAction.mockClear();
      await act(async () => vi.advanceTimersByTimeAsync(14_999));
      expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledWith({ ids: ['task-1'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling a category that remains pending beyond the bounded window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T10:00:00.000Z'));
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [{ id: 'task-1', taskCategoryStatus: 'pending' }],
    });
    try {
      renderBoard(null, [task({ taskCategoryStatus: 'pending' })]);

      await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
      fakes.loadTaskCategoryStatesAction.mockClear();
      await act(async () => vi.advanceTimersByTimeAsync(60_000));

      expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls every pending task in bounded chunks', async () => {
    const rows = Array.from({ length: 201 }, (_, index) =>
      task({
        id: `task-${index + 1}`,
        canonicalName: `Pending task ${index + 1}`,
        taskCategoryStatus: 'pending',
      }),
    );
    fakes.loadTaskCategoryStatesAction.mockImplementation(({ ids }: { ids: string[] }) => ({
      rows: ids.map((id) => ({ id, taskCategoryStatus: 'pending' })),
    }));

    renderBoard(null, rows);

    await waitFor(() => {
      expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledTimes(2);
    });
    expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledWith({
      ids: rows.slice(0, 200).map((row) => row.id),
    });
    expect(fakes.loadTaskCategoryStatesAction).toHaveBeenCalledWith({ ids: ['task-201'] });
  });

  it('applies polled category state to a previously loaded older task', async () => {
    const user = userEvent.setup();
    fakes.loadTaskRowsAction.mockResolvedValue({
      rows: [
        task({
          id: 'task-2',
          canonicalName: 'Older pending task',
          taskCategoryStatus: 'pending',
        }),
      ],
      nextCursor: null,
    });
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [
        {
          id: 'task-2',
          taskCategory: 'design',
          taskCategoryMode: 'automatic',
          taskCategorySource: 'llm',
          taskCategoryStatus: 'ready',
          taskCategoryUpdatedAt: new Date('2026-07-13T10:00:00.000Z'),
        },
      ],
    });
    render(
      <TaskBoard
        rows={[task()]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="older-cursor"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    expect(screen.getByRole('link', { name: 'Older pending task' })).toBeTruthy();

    await waitFor(
      () => {
        expect(screen.getByText('Design')).toBeTruthy();
        expect(screen.queryByText('Categorizing…')).toBeNull();
      },
      { timeout: 4_000 },
    );
  }, 7_000);

  it('does not poll pending categories while the category UI is disabled', () => {
    vi.useFakeTimers();
    document.body.dataset.taskCategoriesEnabled = 'false';
    try {
      renderBoard(null, [task({ taskCategoryStatus: 'pending' })]);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(fakes.loadTaskCategoryStatesAction).not.toHaveBeenCalled();
    } finally {
      delete document.body.dataset.taskCategoriesEnabled;
      vi.useRealTimers();
    }
  });

  it('does not expose the category column or bulk editing while the category UI is disabled', () => {
    render(
      <TaskBoard
        rows={[task()]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[]}
        totalCount={1}
        nextCursor={null}
        taskCategoriesEnabled={false}
      />,
    );

    expect(screen.queryByRole('option', { name: 'Category' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Bulk category' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull();
    expect(screen.queryByText('Needs category')).toBeNull();
  });

  it('does not render the category field in the selected-task panel while disabled', () => {
    render(
      <TaskBoard
        rows={[task()]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId="task-1"
        view="kanban"
        members={[]}
        totalCount={1}
        nextCursor={null}
        taskCategoriesEnabled={false}
      />,
    );

    expect(screen.queryByText('Category')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Task category' })).toBeNull();
  });

  it('removes an asynchronously-hydrated project from the task card after clearing it', async () => {
    fakes.loadTaskPrimaryProjectsAction.mockResolvedValue({
      rows: [
        {
          taskId: 'task-1',
          projectId: 'project-1',
          projectName: 'Faba redesign',
          archivedAt: null,
        },
      ],
    });
    renderBoard('task-1');
    await screen.findAllByText(/Faba redesign/);

    await chooseTaskProject('No project');

    await waitFor(() => {
      expect(fakes.setTaskProjectAction).toHaveBeenCalledWith({ id: 'task-1', projectId: null });
      expect(screen.queryByText('Faba redesign')).toBeNull();
    });
  });

  it('reconciles an optimistic project assignment with refreshed server project data', async () => {
    const rows = [task()];
    const renderProps = {
      rows,
      columns: ['todo', 'doing', 'done', 'blocked', 'cancelled'],
      selectedTaskId: 'task-1',
      view: 'kanban' as const,
      members: [],
      totalCount: 1,
      nextCursor: null,
      initialProjectsHydrated: true,
    };
    const view = render(
      <TaskBoard
        {...renderProps}
        projects={[
          { id: 'project-old', label: 'Old project' },
          { id: 'project-new', label: 'Faba redesign' },
        ]}
        primaryProjects={[
          {
            taskId: 'task-1',
            projectId: 'project-old',
            projectName: 'Old project',
            archivedAt: null,
          },
        ]}
      />,
    );

    await chooseTaskProject('Faba redesign');
    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalled();
    });

    view.rerender(
      <TaskBoard
        {...renderProps}
        projects={[
          { id: 'project-old', label: 'Old project' },
          { id: 'project-new', label: 'Faba website redesign' },
        ]}
        primaryProjects={[
          {
            taskId: 'task-1',
            projectId: 'project-new',
            projectName: 'Faba website redesign',
            archivedAt: null,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Faba website redesign').length).toBeGreaterThan(0);
      expect(screen.queryByText('Faba redesign')).toBeNull();
    });
  });

  it('does not refetch initial tasks whose no-project state was hydrated by the server', async () => {
    render(
      <TaskBoard
        rows={[task()]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[]}
        primaryProjects={[]}
        initialProjectsHydrated
        totalCount={1}
        nextCursor={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Send proposal')).toBeTruthy();
    });
    expect(fakes.loadTaskPrimaryProjectsAction).not.toHaveBeenCalled();
  });

  it('retries project hydration after a transient action failure', async () => {
    fakes.loadTaskPrimaryProjectsAction
      .mockResolvedValueOnce({ error: 'Temporary project lookup failure' })
      .mockResolvedValueOnce({
        rows: [
          {
            taskId: 'task-1',
            projectId: 'project-1',
            projectName: 'Recovered project',
            archivedAt: null,
          },
        ],
      });

    renderBoard();

    expect(await screen.findByText('Recovered project')).toBeTruthy();
    expect(fakes.loadTaskPrimaryProjectsAction).toHaveBeenCalledTimes(2);
  });

  it('finds and assigns a remote project from the task project selector', async () => {
    fakes.searchObjectsAction.mockResolvedValue({
      results: [
        {
          id: 'project-remote',
          type: 'project',
          canonicalName: 'Faba website redesign',
        },
      ],
    });
    renderBoard('task-1');

    const projectTrigger = screen.getByRole('button', { name: /^Task project:/ });
    projectTrigger.focus();
    await userEvent.keyboard('{Enter}');
    const projectSearch = screen.getByRole('searchbox', { name: 'Search task projects' });
    await waitFor(() => {
      expect(document.activeElement).toBe(projectSearch);
    });
    await userEvent.type(projectSearch, 'Faba');
    await screen.findByRole('button', { name: 'Faba website redesign' }, { timeout: 1_000 });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(fakes.setTaskProjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        projectId: 'project-remote',
      });
    });
  });

  it('does not label an active hydrated project as archived when it was not preloaded', async () => {
    render(
      <TaskBoard
        rows={[task()]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId="task-1"
        view="kanban"
        members={[]}
        projects={[]}
        primaryProjects={[
          {
            taskId: 'task-1',
            projectId: 'project-outside-window',
            projectName: 'Long-running active project',
            archivedAt: null,
          },
        ]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    const trigger = screen.getByRole('button', { name: /^Task project:/ });
    expect(trigger.textContent).toContain('Long-running active project');
    expect(trigger.textContent).not.toContain('Archived');
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Long-running active project' })).toBeTruthy();
  });

  it('does not render legacy agentSuggested badges on task rows', () => {
    renderBoard(null, [task({ status: 'suggested', agentSuggested: true })]);

    expect(screen.getByRole('link', { name: 'Send proposal' })).toBeTruthy();
    expect(screen.queryByText('Suggested')).toBeNull();
  });

  it('groups legacy task statuses into the simplified workflow', () => {
    renderBoard(null, [
      task({ id: 'suggested', canonicalName: 'Suggested task', status: 'suggested' }),
      task({ id: 'proposed', canonicalName: 'Proposed task', status: 'proposed' }),
      task({ id: 'open', canonicalName: 'Open task', status: 'open' }),
      task({ id: 'todo', canonicalName: 'Todo task', status: 'todo' }),
    ]);

    expect(screen.getByRole('heading', { name: 'Backlog' }).nextElementSibling?.textContent).toBe(
      '2',
    );
    expect(screen.getByRole('heading', { name: 'Open' }).nextElementSibling?.textContent).toBe('2');
    expect(screen.queryByRole('heading', { name: 'suggested' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'proposed' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'todo' })).toBeNull();
  });

  it('prefers source-tracked integration display titles over provider identity canonical names', () => {
    render(
      <TaskBoard
        rows={[
          task({
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            metadata: {
              integration_provider: 'github',
              integration_external_id: 'timborovkov/the-timeline-ai#202',
              display_title: 'the-timeline-ai: Add cursor pagination',
              display_title_canonical_name:
                'timborovkov/the-timeline-ai#202: Add cursor pagination',
            },
          }),
        ]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId="task-1"
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    expect(screen.getAllByText('the-timeline-ai: Add cursor pagination')).toHaveLength(2);
    expect(screen.queryByText(/timborovkov\/the-timeline-ai#202/)).toBeNull();
  });

  it('surfaces selected task origin and related context in the side panel', () => {
    render(
      <TaskBoard
        rows={[task()]}
        columns={['backlog', 'open', 'doing', 'blocked', 'done', 'cancelled']}
        selectedTaskId="task-1"
        selectedTaskContext={connectedWork()}
        selectedTaskProvenance={{
          whyThisExists: [
            {
              id: 'origin-1',
              title: 'Fix M-14 effectOnTotalAssets sign',
              reason:
                'Cursor Bugbot flagged a Medium-severity defect: M-14’s effectOnTotalAssets is +2_100 but should be -2_100.',
              operation: 'create',
              targetKind: 'task',
              createdAt: new Date('2026-08-10T10:00:00.000Z'),
              evidence: [
                {
                  rawEventId: 'event-origin',
                  source: 'github',
                  contentText: 'Bugbot comment',
                  quote: null,
                  occurredAt: new Date('2026-08-10T09:00:00.000Z'),
                },
              ],
            },
          ],
          whatChangedIt: [],
          relatedEvidence: [],
        }}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    expect(screen.getByText(/Cursor Bugbot flagged a Medium-severity defect/)).toBeTruthy();
    expect(screen.getByText('Related context')).toBeTruthy();
    expect(screen.getByRole('link', { name: /example.com\/pilot/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pilot brief.pdf' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /screenshot.png/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Pilot doc and screenshot are here/ })).toBeTruthy();
  });

  it('uses provider identity canonical names when display metadata is absent', () => {
    render(
      <TaskBoard
        rows={[
          task({
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            metadata: {
              integration_provider: 'github',
              integration_external_id: 'timborovkov/the-timeline-ai#202',
            },
          }),
        ]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    expect(
      screen.getByRole('link', {
        name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('the-timeline-ai: Add cursor pagination')).toBeNull();
  });

  it('wraps long task titles on cards and in the selected panel', () => {
    const longTitle =
      'timborovkov/the-timeline-ai#202: Add cursor pagination to the visible tasks board so the title can be read';
    renderBoard('task-1', [task({ canonicalName: longTitle })]);

    const cardTitle = screen.getByRole('link', { name: longTitle });
    const panelTitle = screen.getByRole('heading', { name: longTitle });

    expect(cardTitle.className).toContain('break-words');
    expect(cardTitle.className).not.toContain('truncate');
    expect(panelTitle.className).toContain('break-words');
    expect(panelTitle.className).not.toContain('truncate');
  });

  it('renders the selected task panel with an object link that can return to the panel', () => {
    renderBoard('task-1');

    expect(screen.getByRole('complementary', { name: 'Task detail' }).className).toContain(
      'bg-surface',
    );
    expect(screen.getByRole('complementary', { name: 'Task detail' }).className).toContain(
      'border-border',
    );
    expect(screen.getByRole('link', { name: 'Close' }).getAttribute('href')).toBe('/app/tasks');
    expect(screen.getByRole('link', { name: 'Open object' }).getAttribute('href')).toBe(
      '/app/objects/task-1?returnTo=%2Fapp%2Ftasks%3Ftask%3Dtask-1',
    );
  });

  it('edits task assignee, due date, priority, and status from the panel', async () => {
    const user = userEvent.setup();
    renderBoard('task-1');

    await user.click(screen.getByRole('button', { name: 'Task assignee' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Task assignee' }), 'user-2');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        assigneeUserId: 'user-2',
      });
    });

    await user.click(screen.getByRole('button', { name: 'Task priority' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Task priority' }), '3');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        priority: 3,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Task due date' }));
    await user.clear(screen.getByLabelText('Due date'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        dueAt: null,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Task status' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'doing');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'doing',
      });
    });
  });

  it('switches to list view and preserves list mode when opening a task', () => {
    renderBoard(null, [task()], 'list');

    expect(screen.getByRole('link', { name: 'Send proposal' }).getAttribute('href')).toBe(
      '/app/tasks?view=list&task=task-1',
    );
    expect(screen.getByRole('checkbox', { name: 'Select Send proposal' })).toBeTruthy();
  });

  it('preserves server filter params in task navigation links', () => {
    renderBoard('task-1', [task()], 'list', {
      assignee: 'user-1',
      due: 'next7',
      q: 'proposal',
    });

    expect(screen.getByRole('link', { name: 'Send proposal' }).getAttribute('href')).toBe(
      '/app/tasks?assignee=user-1&due=next7&q=proposal&view=list&task=task-1',
    );
    expect(screen.getByRole('link', { name: 'Close' }).getAttribute('href')).toBe(
      '/app/tasks?assignee=user-1&due=next7&q=proposal&view=list',
    );
    expect(screen.getByRole('link', { name: 'Open object' }).getAttribute('href')).toBe(
      '/app/objects/task-1?returnTo=%2Fapp%2Ftasks%3Fassignee%3Duser-1%26due%3Dnext7%26q%3Dproposal%26view%3Dlist%26task%3Dtask-1',
    );
  });

  it('loads older tasks from the cursor action without duplicating loaded rows', async () => {
    const user = userEvent.setup();
    fakes.loadTaskRowsAction.mockResolvedValue({
      rows: [
        task({ id: 'task-1', canonicalName: 'Send proposal duplicate' }),
        task({ id: 'task-2', canonicalName: 'Older task' }),
      ],
      nextCursor: null,
    });
    render(
      <TaskBoard
        rows={[task({ id: 'task-1', canonicalName: 'Send proposal' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="older-cursor"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));

    await waitFor(() => {
      expect(fakes.loadTaskRowsAction).toHaveBeenCalledWith({ cursor: 'older-cursor' });
      expect(screen.getByRole('link', { name: 'Older task' })).toBeTruthy();
    });
    expect(screen.queryByText('Send proposal duplicate')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load older tasks' })).toBeNull();
    expect(screen.getByText('2 loaded of 2')).toBeTruthy();
  });

  it('keeps loaded older tasks when refreshed first-page props arrive', async () => {
    const user = userEvent.setup();
    fakes.loadTaskRowsAction.mockResolvedValue({
      rows: [task({ id: 'task-2', canonicalName: 'Older task' })],
      nextCursor: null,
    });
    const { rerender } = render(
      <TaskBoard
        rows={[task({ id: 'task-1', canonicalName: 'Send proposal' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="older-cursor"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    await screen.findByRole('link', { name: 'Older task' });

    rerender(
      <TaskBoard
        rows={[task({ id: 'task-1', canonicalName: 'Send proposal refreshed' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="older-cursor"
      />,
    );

    expect(screen.getByRole('link', { name: 'Send proposal refreshed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Older task' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older tasks' })).toBeNull();
  });

  it('drops loaded pages and uses the refreshed cursor when category membership changes', async () => {
    const user = userEvent.setup();
    fakes.loadTaskRowsAction
      .mockResolvedValueOnce({
        rows: [task({ id: 'task-2', canonicalName: 'Stale category match' })],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        rows: [task({ id: 'task-4', canonicalName: 'New older category match' })],
        nextCursor: null,
      });
    const { rerender } = render(
      <TaskBoard
        rows={[task({ id: 'task-1', canonicalName: 'Current category match' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="older-cursor"
        filterParams={{ category: 'design' }}
        categoryFilterRefreshToken="category-version-1"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    await screen.findByRole('link', { name: 'Stale category match' });

    rerender(
      <TaskBoard
        rows={[task({ id: 'task-3', canonicalName: 'Refreshed category match' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="refreshed-cursor"
        filterParams={{ category: 'design' }}
        categoryFilterRefreshToken="category-version-2"
      />,
    );

    expect(screen.queryByRole('link', { name: 'Stale category match' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Refreshed category match' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    await screen.findByRole('link', { name: 'New older category match' });
    expect(fakes.loadTaskRowsAction).toHaveBeenNthCalledWith(1, {
      cursor: 'older-cursor',
      filters: { category: 'design' },
    });
    expect(fakes.loadTaskRowsAction).toHaveBeenNthCalledWith(2, {
      cursor: 'refreshed-cursor',
      filters: { category: 'design' },
    });
  });

  it('drops loaded project-filter pages after a task project changes', async () => {
    const user = userEvent.setup();
    fakes.loadTaskRowsAction
      .mockResolvedValueOnce({
        rows: [task({ id: 'task-2', canonicalName: 'Stale project match' })],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        rows: [task({ id: 'task-4', canonicalName: 'New older project match' })],
        nextCursor: null,
      });
    fakes.loadTaskPrimaryProjectsAction.mockResolvedValue({
      rows: [
        {
          taskId: 'task-2',
          projectId: 'project-a',
          projectName: 'Project A',
          archivedAt: null,
        },
      ],
    });
    const props = {
      columns: ['todo', 'doing', 'done', 'blocked', 'cancelled'],
      selectedTaskId: 'task-2',
      view: 'kanban' as const,
      members: [{ id: 'user-1', label: 'Ada Lovelace' }],
      projects: [
        { id: 'project-a', label: 'Project A' },
        { id: 'project-b', label: 'Project B' },
      ],
      totalCount: 2,
      filterParams: { project: 'project-a' },
    };
    const view = render(
      <TaskBoard
        {...props}
        rows={[task({ id: 'task-1', canonicalName: 'Current project match' })]}
        nextCursor="older-cursor"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    await screen.findByRole('link', { name: 'Stale project match' });
    await user.click(screen.getByRole('button', { name: /^Task project:/ }));
    await user.click(screen.getByRole('button', { name: 'Project B' }));

    await waitFor(() => {
      expect(fakes.setTaskProjectAction).toHaveBeenCalledWith({
        id: 'task-2',
        projectId: 'project-b',
      });
      expect(screen.queryByRole('link', { name: 'Stale project match' })).toBeNull();
    });

    view.rerender(
      <TaskBoard
        {...props}
        rows={[task({ id: 'task-3', canonicalName: 'Refreshed project match' })]}
        nextCursor="refreshed-cursor"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    await screen.findByRole('link', { name: 'New older project match' });
    expect(fakes.loadTaskRowsAction).toHaveBeenNthCalledWith(2, {
      cursor: 'refreshed-cursor',
      filters: { project: 'project-a' },
    });
  });

  it('drops previously loaded tasks when server filters change', () => {
    const { rerender } = render(
      <TaskBoard
        rows={[
          task({ id: 'task-1', canonicalName: 'Assigned to Ada', assigneeUserId: 'user-1' }),
          task({ id: 'task-2', canonicalName: 'Unassigned task', assigneeUserId: null }),
        ]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor={null}
      />,
    );

    rerender(
      <TaskBoard
        rows={[task({ id: 'task-1', canonicalName: 'Assigned to Ada', assigneeUserId: 'user-1' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
        filterParams={{ assignee: 'user-1' }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Assigned to Ada' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Unassigned task' })).toBeNull();
    expect(screen.getByText('1 loaded of 1')).toBeTruthy();
  });

  it('ignores an older page that resolves after server filters change', async () => {
    const user = userEvent.setup();
    let resolvePage:
      | ((page: { rows: objects.ObjectRow[]; nextCursor: string | null }) => void)
      | undefined;
    fakes.loadTaskRowsAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    );
    const { rerender } = render(
      <TaskBoard
        rows={[task({ id: 'task-1', canonicalName: 'Newest unfiltered task' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={2}
        nextCursor="older-cursor"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older tasks' }));
    await waitFor(() => {
      expect(fakes.loadTaskRowsAction).toHaveBeenCalledWith({ cursor: 'older-cursor' });
    });

    rerender(
      <TaskBoard
        rows={[task({ id: 'task-3', canonicalName: 'Assigned to Ada' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="kanban"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
        filterParams={{ assignee: 'user-1' }}
      />,
    );

    await act(async () => {
      resolvePage?.({
        rows: [task({ id: 'task-2', canonicalName: 'Stale unfiltered task' })],
        nextCursor: null,
      });
      await Promise.resolve();
    });

    expect(screen.queryByRole('link', { name: 'Stale unfiltered task' })).toBeNull();
    expect(screen.getByText('1 loaded of 1')).toBeTruthy();
  });

  it('bounds rendered kanban cards while reporting loaded tasks outside the window', () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      task({ id: `task-${index}`, canonicalName: `Task ${index}`, status: 'done' }),
    );

    renderBoard(null, rows);

    expect(screen.getByRole('link', { name: 'Task 2' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Task 3' })).toBeNull();
    expect(screen.getByText('4 loaded tasks hidden. Narrow filter.')).toBeTruthy();
  });

  it('names the kanban rail and each status column for navigation', () => {
    renderBoard();

    const rail = screen.getByRole('region', { name: 'Task status columns' });
    expect(rail).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Backlog' })).toBeTruthy();
  });

  it('bounds rendered list rows while reporting loaded tasks outside the window', () => {
    const rows = Array.from({ length: 22 }, (_, index) =>
      task({ id: `task-${index}`, canonicalName: `Task ${index}` }),
    );

    const { container } = renderBoard(null, rows, 'list');

    expect(screen.getByRole('link', { name: 'Task 4' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Task 5' })).toBeNull();
    expect(
      screen.getByText('17 loaded tasks hidden. Narrow the filter to inspect them.'),
    ).toBeTruthy();
    const list = container.querySelector('[data-task-list]');
    expect(list).toBeTruthy();
    expect(list?.className.split(/\s+/)).not.toContain('px-4');
    expect(list?.className.split(/\s+/)).not.toContain('md:px-8');
  });

  it('shows project once per list row as the editable control', () => {
    renderBoard(null, [task()], 'list');

    expect(screen.getAllByText('No project')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Project for Send proposal' })).toBeTruthy();
  });

  it('keeps kanban cards compact without a redundant Task type label', () => {
    renderBoard();

    expect(screen.queryByText('Task', { exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Project for Send proposal' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send proposal' }).className).toContain('line-clamp-2');
  });

  it('bulk assigns selected tasks from list view', async () => {
    const user = userEvent.setup();
    renderBoard(
      null,
      [
        task({ id: 'task-1', canonicalName: 'Send proposal' }),
        task({ id: 'task-2', canonicalName: 'Draft kickoff', assigneeUserId: null }),
      ],
      'list',
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Send proposal' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Draft kickoff' }));
    await user.selectOptions(screen.getByLabelText('Bulk assignee'), 'user-2');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        assigneeUserId: 'user-2',
      });
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-2',
        assigneeUserId: 'user-2',
      });
    });
  });

  it('bounds concurrent bulk category updates', async () => {
    const user = userEvent.setup();
    let active = 0;
    let maxActive = 0;
    let releaseImmediately = false;
    const releases: (() => void)[] = [];
    fakes.setTaskCategoryAction.mockImplementation(() => {
      if (releaseImmediately) return Promise.resolve({ ok: true });
      return new Promise((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        releases.push(() => {
          active -= 1;
          resolve({ ok: true });
        });
      });
    });
    const rows = Array.from({ length: 5 }, (_, index) =>
      task({ id: `task-${index + 1}`, canonicalName: `Task ${index + 1}` }),
    );
    renderBoard(null, rows, 'list');

    await user.click(screen.getByRole('checkbox', { name: 'Select all Open tasks' }));
    await user.selectOptions(screen.getByLabelText('Bulk field'), 'category');
    await user.selectOptions(screen.getByLabelText('Bulk category'), 'engineering');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    try {
      await waitFor(() => {
        expect(fakes.setTaskCategoryAction).toHaveBeenCalledTimes(4);
      });
      expect(maxActive).toBe(4);

      await act(async () => {
        releases.shift()?.();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(fakes.setTaskCategoryAction).toHaveBeenCalledTimes(5);
      });
    } finally {
      releaseImmediately = true;
      await act(async () => {
        for (const release of releases.splice(0)) release();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(screen.getByText('Updated 5 tasks.')).toBeTruthy();
      });
    }
  });

  it('keeps saved status patches visible until refreshed rows catch up', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TaskBoard
        rows={[task({ status: 'todo' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Status for Send proposal' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'doing');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'doing',
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Status for Send proposal' }).textContent,
      ).toContain('In progress');
    });

    rerender(
      <TaskBoard
        rows={[task({ status: 'doing' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Status for Send proposal' }).textContent,
      ).toContain('In progress');
    });

    rerender(
      <TaskBoard
        rows={[task({ status: 'done' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    expect(screen.getByRole('button', { name: 'Status for Send proposal' }).textContent).toContain(
      'Done',
    );
  });

  it('keeps the latest repeated status edit visible before refreshed rows arrive', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TaskBoard
        rows={[task({ status: 'todo' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Status for Send proposal' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'doing');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Status for Send proposal' }).textContent,
      ).toContain('In progress');
    });

    await user.click(screen.getByRole('button', { name: 'Status for Send proposal' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'done');
    await waitFor(() => {
      expect(fakes.updateObjectAction).toHaveBeenCalledWith({
        id: 'task-1',
        status: 'done',
      });
    });

    rerender(
      <TaskBoard
        rows={[task({ status: 'doing' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Status for Send proposal' }).textContent).toContain(
      'Done',
    );

    rerender(
      <TaskBoard
        rows={[task({ status: 'done' })]}
        columns={['todo', 'doing', 'done', 'blocked', 'cancelled']}
        selectedTaskId={null}
        view="list"
        members={[{ id: 'user-1', label: 'Ada Lovelace' }]}
        totalCount={1}
        nextCursor={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Status for Send proposal' }).textContent).toContain(
      'Done',
    );
  });
});
