import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getBoard: vi.fn(),
  listBoardItemHistory: vi.fn(),
  listObjects: vi.fn(),
  getObject: vi.fn(),
  listMembers: vi.fn(),
  getCalendarSettings: vi.fn(),
  candidateIds: [] as string[],
  projectOptionIds: [] as string[],
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: fakes.notFound,
  redirect: fakes.redirect,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    boards: {
      getBoard: fakes.getBoard,
      listBoardItemHistory: fakes.listBoardItemHistory,
    },
    objects: {
      listObjects: fakes.listObjects,
      getObject: fakes.getObject,
    },
    timeline: {
      listMembers: fakes.listMembers,
    },
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/boards/board-detail-client', () => ({
  BoardDetailClient: ({
    selectedItemId,
    history,
    initialCandidates,
    projectOptions,
  }: {
    selectedItemId: string | null;
    history: unknown[];
    initialCandidates: { id: string }[];
    projectOptions?: { id: string }[];
  }) => {
    fakes.candidateIds = initialCandidates.map((candidate) => candidate.id);
    fakes.projectOptionIds = (projectOptions ?? []).map((project) => project.id);
    return (
      <div data-testid="board-detail-client">
        selected:{selectedItemId ?? 'none'} history:{history.length}
      </div>
    );
  },
}));

const { default: BoardDetailPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.listObjects.mockResolvedValue([]);
  fakes.getObject.mockResolvedValue({ connectedWork: [] });
  fakes.listMembers.mockResolvedValue([]);
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.listBoardItemHistory.mockResolvedValue([{ id: 'history-1' }]);
  fakes.candidateIds = [];
  fakes.projectOptionIds = [];
  fakes.getBoard.mockResolvedValue({
    id: 'board-1',
    name: 'Pilot Pipeline',
    purpose: 'Track pilots',
    pinned: false,
    itemCount: 1,
    recommendedObjectTypes: ['company'],
    lanes: [
      {
        id: 'lane-1',
        boardId: 'board-1',
        name: 'New',
        position: 0,
        archivedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    items: [
      {
        id: 'item-1',
        boardId: 'board-1',
        entityId: 'object-1',
        laneId: 'lane-1',
        position: 0,
        responsibleUserId: null,
        dueAt: null,
        priority: null,
        nextStep: null,
        notes: null,
        customFields: {},
        archivedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        object: {
          id: 'object-1',
          type: 'company',
          canonicalName: 'Visible company',
          status: 'open',
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
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    ],
  });
});

describe('BoardDetailPage', () => {
  it('drops a selected item query when server filters removed that board item', async () => {
    const html = renderToStaticMarkup(
      await BoardDetailPage({
        params: Promise.resolve({ id: 'board-1' }),
        searchParams: Promise.resolve({ item: 'filtered-out', status: 'open' }),
      }),
    );

    expect(html).toContain('selected:none history:0');
    expect(html).toContain('data-app-layout="full-bleed"');
    expect(fakes.listBoardItemHistory).not.toHaveBeenCalled();
  });

  it('keeps the selected item query when the filtered board still contains it', async () => {
    const html = renderToStaticMarkup(
      await BoardDetailPage({
        params: Promise.resolve({ id: 'board-1' }),
        searchParams: Promise.resolve({ item: 'item-1', status: 'open' }),
      }),
    );

    expect(html).toContain('selected:item-1 history:1');
    expect(fakes.listBoardItemHistory).toHaveBeenCalledWith('item-1');
  });

  it('keeps non-kanban board views inside the shared dashboard container', async () => {
    const html = renderToStaticMarkup(
      await BoardDetailPage({
        params: Promise.resolve({ id: 'board-1' }),
        searchParams: Promise.resolve({ view: 'table' }),
      }),
    );

    expect(html).not.toContain('data-app-layout="full-bleed"');
  });

  it('keeps an archived selected project in filters but not add-item candidates', async () => {
    const archivedProjectId = '11111111-1111-4111-8111-111111111111';
    fakes.listObjects.mockImplementation((filter: { id?: string | string[] }) =>
      Promise.resolve(
        filter.id
          ? [
              {
                id: archivedProjectId,
                type: 'project',
                canonicalName: 'Archived selected project',
                archivedAt: new Date('2026-01-02T00:00:00.000Z'),
              },
            ]
          : [],
      ),
    );

    renderToStaticMarkup(
      await BoardDetailPage({
        params: Promise.resolve({ id: 'board-1' }),
        searchParams: Promise.resolve({ project: archivedProjectId }),
      }),
    );

    expect(fakes.projectOptionIds).toContain(archivedProjectId);
    expect(fakes.candidateIds).not.toContain(archivedProjectId);
  });
});
