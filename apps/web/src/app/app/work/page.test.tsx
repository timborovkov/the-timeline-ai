import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = 'user-1';
const TEAM_ID = 'team-1';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getApprovalItemCounts: vi.fn(),
  countObjects: vi.fn(),
  listWorkQueueItems: vi.fn(),
  listObjects: vi.fn(),
  listPinnedBoards: vi.fn(),
  listBoards: vi.fn(),
  listEventsPage: vi.fn(),
  getCalendarSettings: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect, usePathname: () => '/app/work' }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    boards: {
      listWorkQueueItems: fakes.listWorkQueueItems,
      listPinnedBoards: fakes.listPinnedBoards,
      listBoards: fakes.listBoards,
    },
    objects: { countObjects: fakes.countObjects, listObjects: fakes.listObjects },
    suggestions: { getApprovalItemCounts: fakes.getApprovalItemCounts },
    timeline: { listEventsPage: fakes.listEventsPage },
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));

const { default: WorkPage } = await import('./page.js');
const { getNavWorkAttention } = await import('@/lib/hub-status');

function objectRow(overrides: Record<string, unknown>) {
  return {
    id: 'object-1',
    type: 'task',
    canonicalName: 'Follow up with Revigo',
    status: 'todo',
    stage: null,
    priority: null,
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
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    ...overrides,
  };
}

function boardQueueRow(overrides: Record<string, unknown>) {
  return {
    id: 'board-item-1',
    boardId: 'board-1',
    boardName: 'Pilot pipeline',
    laneId: 'lane-1',
    laneName: 'Scoping',
    laneKind: 'active',
    entityId: 'object-1',
    responsibleUserId: null,
    dueAt: null,
    priority: null,
    nextStep: null,
    updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    object: objectRow({ type: 'deal', canonicalName: 'Revigo pilot' }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'AuditAI' },
  });
  fakes.getApprovalItemCounts.mockResolvedValue({ failed: 0, pending: 0 });
  fakes.countObjects.mockResolvedValue(0);
  fakes.listWorkQueueItems.mockResolvedValue([]);
  fakes.listObjects.mockResolvedValue([]);
  fakes.listPinnedBoards.mockResolvedValue([]);
  fakes.listBoards.mockResolvedValue([]);
  fakes.listEventsPage.mockResolvedValue({ items: [], nextCursor: null });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'America/Los_Angeles' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkPage', () => {
  it('renders pending approvals as one queue item', async () => {
    fakes.getApprovalItemCounts.mockResolvedValue({ failed: 4, pending: 3 });
    fakes.countObjects.mockResolvedValue(2);

    const html = renderToStaticMarkup(await WorkPage());
    const navWorkAttention = await getNavWorkAttention({
      objects: { countObjects: fakes.countObjects },
      suggestions: { getApprovalItemCounts: fakes.getApprovalItemCounts },
    } as never);

    expect(html).toContain('Work queue');
    expect(html).toContain('3 pending approvals');
    expect(html).toContain('Pending approval');
    expect(html).toContain('/app/approvals?status=pending');
    expect(html).toContain('>Attention</dt>');
    expect(html).toContain('>5</dd>');
    expect(navWorkAttention).toBe(5);
  });

  it('renders responsible board items and unowned team due board items', async () => {
    fakes.listWorkQueueItems.mockResolvedValue([
      boardQueueRow({
        id: 'responsible-item',
        entityId: 'responsible-entity',
        responsibleUserId: USER_ID,
        object: objectRow({
          id: 'responsible-entity',
          type: 'deal',
          canonicalName: 'Responsible deal',
        }),
      }),
      boardQueueRow({
        id: 'team-due-item',
        entityId: 'team-due-entity',
        dueAt: new Date('2026-06-16T00:00:00.000Z'),
        object: objectRow({
          id: 'team-due-entity',
          type: 'project',
          canonicalName: 'Team due project',
        }),
      }),
    ]);

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Responsible deal');
    expect(html).toContain('Responsible to you');
    expect(html).toContain('Team due project');
    expect(html).toContain('Team due');
    expect(html).toContain('/app/boards/board-1?item=team-due-item');
  });

  it('renders owned, assigned, and due object rows while excluding completed work', async () => {
    fakes.listObjects.mockResolvedValue([
      objectRow({
        id: 'owned-task',
        canonicalName: 'Owned task',
        ownerUserId: USER_ID,
      }),
      objectRow({
        id: 'assigned-follow-up',
        type: 'follow_up',
        canonicalName: 'Assigned follow-up',
        assigneeUserId: USER_ID,
      }),
      objectRow({
        id: 'team-due-deal',
        type: 'deal',
        canonicalName: 'Unassigned due deal',
        dueAt: new Date('2026-06-13T00:00:00.000Z'),
      }),
      objectRow({
        id: 'done-task',
        canonicalName: 'Completed task',
        status: 'done',
        ownerUserId: USER_ID,
      }),
    ]);

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Owned task');
    expect(html).toContain('Owned by you');
    expect(html).toContain('Assigned follow-up');
    expect(html).toContain('Assigned to you');
    expect(html).toContain('Unassigned due deal');
    expect(html).toContain('Team due');
    expect(html).not.toContain('Completed task');
  });

  it('never renders a UUID-only object name in the work queue', async () => {
    const internalId = '11111111-1111-4111-8111-111111111111';
    fakes.listObjects.mockResolvedValue([
      objectRow({
        id: 'owned-task',
        canonicalName: internalId,
        ownerUserId: USER_ID,
      }),
    ]);

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Untitled object');
    expect(html).not.toContain(internalId);
  });

  it('includes unassigned objects due exactly at the due-soon boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
    const dueSoonBoundary = new Date('2026-06-29T00:00:00.000Z');

    fakes.listObjects.mockImplementation((filter: Record<string, unknown>) => {
      if (filter.ownerUserId !== null || filter.assigneeUserId !== null || filter.order !== 'due') {
        return [];
      }
      expect(filter.dueBefore).toEqual(new Date(dueSoonBoundary.getTime() + 1));
      return [
        objectRow({
          id: 'boundary-due-deal',
          type: 'deal',
          canonicalName: 'Boundary due deal',
          dueAt: dueSoonBoundary,
        }),
      ];
    });

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Boundary due deal');
    expect(html).toContain('Team due');
  });

  it('fetches priority object buckets before bounded recent candidates', async () => {
    const filler = Array.from({ length: 5_000 }, (_, index) =>
      objectRow({
        id: `recent-task-${index}`,
        canonicalName: `Recent task ${index}`,
        ownerUserId: USER_ID,
      }),
    );
    fakes.listObjects.mockImplementation((filter: Record<string, unknown>) => {
      expect(filter.statusNot).toEqual(['done', 'cancelled', 'canceled', 'shipped']);
      if (filter.ownerUserId === USER_ID && filter.order === 'due') {
        expect(filter.limit).toBe(20);
        return [
          objectRow({
            id: 'stale-overdue-owned-task',
            canonicalName: 'Stale overdue owned task',
            ownerUserId: USER_ID,
            dueAt: new Date('2025-01-01T00:00:00.000Z'),
            updatedAt: new Date('2025-01-01T00:00:00.000Z'),
          }),
        ];
      }
      if (filter.ownerUserId !== USER_ID || filter.status || filter.dueBefore) return [];
      expect(filter.limit).toBe(60);
      return [
        ...filler,
        objectRow({
          id: 'recent-owned-task',
          canonicalName: 'Recent owned task',
          ownerUserId: USER_ID,
        }),
      ];
    });

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Stale overdue owned task');
    expect(html).not.toContain('Recent task 100');
    expect(fakes.listObjects).toHaveBeenCalledTimes(7);
    expect(fakes.listObjects).not.toHaveBeenCalledWith(expect.objectContaining({ offset: 5_000 }));
  });

  it('deduplicates board and object queue rows for the same entity', async () => {
    fakes.listWorkQueueItems.mockResolvedValue([
      boardQueueRow({
        id: 'board-item-1',
        entityId: 'shared-entity',
        responsibleUserId: USER_ID,
        object: objectRow({
          id: 'shared-entity',
          type: 'deal',
          canonicalName: 'Revigo pilot',
        }),
      }),
    ]);
    fakes.listObjects.mockResolvedValue([
      objectRow({
        id: 'shared-entity',
        type: 'deal',
        canonicalName: 'Revigo pilot',
        ownerUserId: USER_ID,
      }),
    ]);

    const html = renderToStaticMarkup(await WorkPage());

    expect((html.match(/Revigo pilot/g) ?? []).length).toBe(1);
    expect(html).toContain('/app/boards/board-1?item=board-item-1');
    expect(html).toContain('Queue');
  });

  it('renders empty state when no queue items exist', async () => {
    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Work queue clear');
    expect(html).toContain('Open boards');
    expect(html).toContain('Pinned and team boards');
    expect(html).not.toContain('Work surfaces');
  });

  it('renders compact boards without duplicating recent timeline changes', async () => {
    fakes.listPinnedBoards.mockResolvedValue([
      {
        id: 'board-1',
        name: 'Pilot pipeline',
        itemCount: 7,
        pinned: true,
        updatedAt: new Date('2026-06-14T00:00:00.000Z'),
      },
    ]);
    fakes.listEventsPage.mockResolvedValue({
      items: [
        {
          id: 'event-1',
          source: 'slack',
          contentText: 'Moved Revigo into scoping.',
          occurredAt: new Date('2026-06-14T12:00:00.000Z'),
        },
      ],
      nextCursor: null,
    });

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).toContain('Pilot pipeline');
    expect(html).toContain('Pinned');
    expect(html).not.toContain('Moved Revigo into scoping.');
  });

  it('does not duplicate timeline event text on the work overview', async () => {
    fakes.listEventsPage.mockResolvedValue({
      items: [
        {
          id: 'event-1',
          source: 'calendar',
          contentText: 'Meeting with Miika | 2026-07-01T00:00:00.000Z to 2026-07-02T00:00:00.000Z',
          occurredAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
    });

    const html = renderToStaticMarkup(await WorkPage());

    expect(html).not.toContain('Meeting with Miika');
    expect(html).not.toContain('2026-07-01T00:00:00.000Z');
    expect(html).not.toContain('2026-07-02T00:00:00.000Z');
  });
});
