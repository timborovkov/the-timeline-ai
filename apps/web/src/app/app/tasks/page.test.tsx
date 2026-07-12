import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listObjects: vi.fn(),
  countObjects: vi.fn(),
  getObject: vi.fn(),
  listPrimaryProjectsForTasks: vi.fn(),
  listPendingSuggestions: vi.fn(),
  listMembers: vi.fn(),
  filterProjects: [] as { label: string }[],
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: {
      listObjects: fakes.listObjects,
      countObjects: fakes.countObjects,
      getObject: fakes.getObject,
      listPrimaryProjectsForTasks: fakes.listPrimaryProjectsForTasks,
    },
    suggestions: { listPendingSuggestions: fakes.listPendingSuggestions },
    timeline: { listMembers: fakes.listMembers },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/approvals/approvals-client', () => ({
  ApprovalsClient: ({
    suggestions,
    folded,
  }: {
    suggestions: { title: string }[];
    folded?: { title: string; summary: { singular: string; plural: string } };
  }) => (
    <div data-testid="approvals">
      {folded ? `${folded.title}: 1 ${folded.summary.singular}. ` : null}
      {suggestions.map((suggestion) => suggestion.title).join(', ')}
    </div>
  ),
}));
vi.mock('@/components/tasks/task-board', () => ({
  TaskBoard: ({
    rows,
    columns,
    selectedTaskId,
    view,
    members,
    totalCount,
    nextCursor,
  }: {
    rows: { canonicalName: string }[];
    columns: string[];
    selectedTaskId: string | null;
    view: 'kanban' | 'list';
    members: { label: string }[];
    totalCount: number;
    nextCursor: string | null;
  }) => (
    <div data-testid="task-board">
      columns {columns.join(', ')} · {rows.map((row) => row.canonicalName).join(', ')} · selected{' '}
      {selectedTaskId ?? 'none'} · view {view} · members{' '}
      {members.map((member) => member.label).join(', ')} · total {totalCount} · cursor{' '}
      {nextCursor ?? 'none'}
    </div>
  ),
}));
vi.mock('@/components/work-filter-bar', () => ({
  WorkFilterBar: ({
    resultCount,
    totalCount,
    projects = [],
  }: {
    resultCount: number;
    totalCount: number;
    projects?: { label: string }[];
  }) => {
    fakes.filterProjects = projects;
    return (
      <div data-testid="work-filter-bar">
        {resultCount}/{totalCount}
      </div>
    );
  },
}));

const { default: TasksPage } = await import('./page.js');

const NEWER_TASK_ID = '00000000-0000-4000-8000-000000000001';
const SELECTED_TASK_ID = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.listObjects.mockResolvedValue([]);
  fakes.countObjects.mockResolvedValue(0);
  fakes.getObject.mockResolvedValue(null);
  fakes.listPrimaryProjectsForTasks.mockResolvedValue([]);
  fakes.listPendingSuggestions.mockResolvedValue([]);
  fakes.listMembers.mockResolvedValue([]);
  fakes.filterProjects = [];
});

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    type: 'task',
    canonicalName: 'Send proposal',
    status: 'todo',
    stage: null,
    priority: 2,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
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
    ...overrides,
  };
}

describe('TasksPage', () => {
  it('hydrates a selected project outside the preloaded filter window', async () => {
    const projectId = '00000000-0000-4000-8000-000000000099';
    fakes.listObjects.mockImplementation((filter: { id?: string[]; type?: string }) => {
      if (filter.id?.includes(projectId)) {
        return Promise.resolve([
          taskRow({ id: projectId, type: 'project', canonicalName: 'Overflow project' }),
        ]);
      }
      return Promise.resolve([]);
    });

    renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({ project: projectId }) }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      id: [projectId],
      type: 'project',
      limit: 1,
    });
    expect(fakes.filterProjects).toEqual([expect.objectContaining({ label: 'Overflow project' })]);
  });

  it('renders pending task approvals even when the kanban has no task rows', async () => {
    fakes.listPendingSuggestions.mockResolvedValue([
      {
        id: 'bundle-1',
        source: 'background',
        status: 'pending',
        title: 'Commitment: Send proposal',
        summary: null,
        reason: null,
        confidence: 'medium',
        visibility: 'team',
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        evidence: [],
        items: [
          {
            id: 'item-1',
            status: 'pending',
            operation: 'create',
            targetKind: 'task',
            targetId: null,
            resultId: null,
            title: 'Send proposal',
            description: null,
            proposedPayload: { canonicalName: 'Send proposal' },
            failureReason: null,
          },
          {
            id: 'item-2',
            status: 'pending',
            operation: 'create',
            targetKind: 'calendar_event',
            targetId: null,
            resultId: null,
            title: 'Send proposal',
            description: null,
            proposedPayload: { title: 'Send proposal' },
            failureReason: null,
          },
        ],
      },
    ]);

    const html = renderToStaticMarkup(await TasksPage());

    expect(html).toContain('Task approvals');
    expect(html).toContain('1 pending task proposal');
    expect(html).toContain('Commitment: Send proposal');
    expect(html).toContain('approvals');
    expect(html).toContain('1 pending approval');
    expect(html).toContain('No active tasks');
  });

  it('does not render approvals when only resolved task suggestion items remain', async () => {
    fakes.listPendingSuggestions.mockResolvedValue([
      {
        id: 'bundle-1',
        source: 'background',
        status: 'pending',
        title: 'Commitment: Send proposal',
        summary: null,
        reason: null,
        confidence: 'medium',
        visibility: 'team',
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        evidence: [],
        items: [
          {
            id: 'item-1',
            status: 'accepted',
            operation: 'create',
            targetKind: 'task',
            targetId: null,
            resultId: 'task-1',
            title: 'Send proposal',
            description: null,
            proposedPayload: { canonicalName: 'Send proposal' },
            failureReason: null,
          },
        ],
      },
    ]);

    const html = renderToStaticMarkup(await TasksPage());

    expect(html).not.toContain('Pending task proposals');
    expect(html).not.toContain('Commitment: Send proposal');
    expect(html).not.toContain('pending approval');
    expect(html).toContain('No active tasks');
  });

  it('renders the empty state when there are no tasks or task suggestions', async () => {
    const html = renderToStaticMarkup(await TasksPage());

    expect(html).toContain('No active tasks');
    expect(html).not.toContain('Pending task proposals');
  });

  it('fetches one bounded task batch and exposes a cursor for older tasks', async () => {
    const firstPage = Array.from({ length: 501 }, (_, index) =>
      taskRow({ id: `task-${index}`, canonicalName: `Task ${index}`, status: 'done' }),
    );
    fakes.listObjects.mockResolvedValue(firstPage);
    fakes.countObjects.mockImplementation((filter: Record<string, unknown>) =>
      filter.statusNot ? 490 : 501,
    );

    const html = renderToStaticMarkup(await TasksPage());

    expect(html).toContain('Task 499');
    expect(html).not.toContain('Task 500');
    expect(html).toContain('total 501');
    expect(html).not.toContain('cursor none');
    expect(fakes.listObjects).toHaveBeenCalledWith({
      type: 'task',
      archived: false,
      limit: 501,
      cursor: null,
    });
    expect(fakes.listObjects).toHaveBeenCalledTimes(2);
    expect(fakes.countObjects).toHaveBeenCalledWith({
      type: 'task',
      archived: false,
    });
  });

  it('adds a selected older task to the initial board window', async () => {
    fakes.getObject.mockResolvedValue(taskRow({ id: SELECTED_TASK_ID }));
    fakes.listObjects.mockImplementation((filter: Record<string, unknown>) =>
      filter.id === SELECTED_TASK_ID
        ? Promise.resolve([taskRow({ id: SELECTED_TASK_ID, canonicalName: 'Selected older task' })])
        : Promise.resolve([taskRow({ id: NEWER_TASK_ID, canonicalName: 'Newer' })]),
    );

    const html = renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({ task: SELECTED_TASK_ID }) }),
    );

    expect(html).toContain('Selected older task');
    expect(html).toContain('Newer');
    expect(fakes.listObjects).toHaveBeenCalledWith({
      type: 'task',
      archived: false,
      id: SELECTED_TASK_ID,
      limit: 1,
    });
    expect(fakes.getObject).toHaveBeenCalledWith(SELECTED_TASK_ID);
  });

  it('does not prepend a selected task that no longer matches active filters', async () => {
    fakes.countObjects.mockResolvedValue(0);
    fakes.getObject.mockResolvedValue(
      taskRow({
        id: SELECTED_TASK_ID,
        canonicalName: 'Selected done task',
        status: 'done',
      }),
    );

    const html = renderToStaticMarkup(
      await TasksPage({
        searchParams: Promise.resolve({ task: SELECTED_TASK_ID, status: 'todo' }),
      }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      type: 'task',
      archived: false,
      status: ['todo'],
      id: SELECTED_TASK_ID,
      limit: 1,
    });
    expect(html).toContain('No tasks match this filter');
    expect(html).toContain('0/0');
    expect(html).not.toContain('Selected done task');
    expect(html).not.toContain('selected selected-task');
    expect(fakes.getObject).not.toHaveBeenCalled();
  });

  it('does not use the client text matcher for selected task search filters', async () => {
    fakes.countObjects.mockResolvedValue(0);
    fakes.getObject.mockResolvedValue(
      taskRow({
        id: SELECTED_TASK_ID,
        canonicalName: 'Priority task',
        priority: 2,
      }),
    );

    const html = renderToStaticMarkup(
      await TasksPage({
        searchParams: Promise.resolve({ task: SELECTED_TASK_ID, q: '2' }),
      }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      type: 'task',
      archived: false,
      query: '2',
      id: SELECTED_TASK_ID,
      limit: 1,
    });
    expect(html).toContain('No tasks match this filter');
    expect(html).not.toContain('Priority task');
    expect(fakes.getObject).not.toHaveBeenCalled();
  });

  it('passes the selected task query into the task board', async () => {
    fakes.listObjects.mockResolvedValue([
      {
        id: 'task-1',
        type: 'task',
        canonicalName: 'Send proposal',
        status: 'todo',
        stage: null,
        priority: 2,
        ownerUserId: null,
        assigneeUserId: null,
        dueAt: null,
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
      },
    ]);

    const html = renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({ task: 'task-1' }) }),
    );

    expect(html).toContain('Send proposal');
    expect(html).toContain('selected task-1');
  });

  it('passes list view into the task board', async () => {
    fakes.listObjects.mockResolvedValue([
      {
        id: 'task-1',
        type: 'task',
        canonicalName: 'Send proposal',
        status: 'todo',
        stage: null,
        priority: 2,
        ownerUserId: null,
        assigneeUserId: null,
        dueAt: null,
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
      },
    ]);

    const html = renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({ view: 'list' }) }),
    );

    expect(html).toContain('view list');
  });

  it('passes workflow columns in active-to-terminal order', async () => {
    fakes.listObjects.mockResolvedValue([
      {
        id: 'task-1',
        type: 'task',
        canonicalName: 'Send proposal',
        status: 'open',
        stage: null,
        priority: 2,
        ownerUserId: null,
        assigneeUserId: null,
        dueAt: null,
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
      },
    ]);

    const html = renderToStaticMarkup(await TasksPage());

    expect(html).toContain(
      'columns suggested, proposed, open, todo, doing, blocked, done, cancelled',
    );
  });
});
