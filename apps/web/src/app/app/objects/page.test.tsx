import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listObjects: vi.fn(),
  countObjects: vi.fn(),
  getTaskCategoryFilterRefreshState: vi.fn(),
  listPendingSuggestions: vi.fn(),
  listMembers: vi.fn(),
  getObjectMergePreview: vi.fn(),
  userRows: [] as { id: string; name: string | null; email: string }[],
  categoryRefresh: null as {
    surface: string;
    filters: { category: string };
    baselineToken: string;
  } | null,
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/env', () => ({
  getEnv: () => ({ TASK_CATEGORY_UI_ENABLED: true }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: {
      listObjects: fakes.listObjects,
      countObjects: fakes.countObjects,
      getObjectMergePreview: fakes.getObjectMergePreview,
      getTaskCategoryFilterRefreshState: fakes.getTaskCategoryFilterRefreshState,
    },
    suggestions: { listPendingSuggestions: fakes.listPendingSuggestions },
    timeline: { listMembers: fakes.listMembers },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(fakes.userRows)),
      })),
    })),
  },
}));
vi.mock('@/components/objects/object-cleanup-list', () => ({
  ObjectCleanupList: ({
    pageInfo,
    sectionMoreHrefs,
  }: {
    pageInfo?: {
      shownCount: number;
      nextHref: string | null;
    };
    sectionMoreHrefs?: Record<string, string>;
  }) => (
    <div data-testid="object-cleanup-list">
      {pageInfo
        ? `${pageInfo.shownCount}|${pageInfo.nextHref ?? 'none'}`
        : `sections:${JSON.stringify(sectionMoreHrefs ?? {})}`}
    </div>
  ),
}));
vi.mock('@/components/objects/object-cleanup-suggestions', () => ({
  ObjectCleanupSuggestions: ({
    mergePreviewsByItemId,
  }: {
    mergePreviewsByItemId: Record<string, unknown>;
  }) => <div data-testid="cleanup-suggestions">{Object.keys(mergePreviewsByItemId).join(',')}</div>,
}));
vi.mock('@/components/tasks/task-category-filter-refresh', () => ({
  TaskCategoryFilterRefresh: (props: {
    surface: string;
    filters: { category: string };
    baselineToken: string;
  }) => {
    fakes.categoryRefresh = props;
    return <div data-testid="task-category-filter-refresh" />;
  },
}));
vi.mock('@/components/work-filter-bar', () => ({
  WorkFilterBar: ({
    resultCount,
    totalCount,
    hiddenParams,
    members = [],
  }: {
    resultCount: number;
    totalCount: number;
    hiddenParams?: Record<string, string>;
    members?: { id: string; label: string }[];
  }) => (
    <div data-testid="work-filter-bar">
      {resultCount}/{totalCount}|hidden:{JSON.stringify(hiddenParams ?? {})}|members:
      {members.map((member) => member.label).join(',')}
    </div>
  ),
}));

const { default: ObjectsIndexPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.listObjects.mockResolvedValue([]);
  fakes.countObjects.mockResolvedValue(0);
  fakes.getTaskCategoryFilterRefreshState.mockResolvedValue({
    token: 'design:0',
    changed: false,
    pending: true,
  });
  fakes.listPendingSuggestions.mockResolvedValue([]);
  fakes.listMembers.mockResolvedValue([]);
  fakes.userRows = [];
  fakes.categoryRefresh = null;
  fakes.getObjectMergePreview.mockResolvedValue({
    objects: [],
    survivorId: '00000000-0000-4000-8000-000000000001',
    aliasesToAdd: [],
    factSamplesByObjectId: {},
    counts: { facts: 0, notes: 0, relationships: 0, openTasks: 0 },
    countsBySurvivorId: {},
  });
});

function mergeSuggestion(index: number) {
  const survivorId = `00000000-0000-4000-8000-0000000000${index}1`;
  const duplicateId = `00000000-0000-4000-8000-0000000000${index}2`;
  return {
    id: `item-${index}`,
    status: 'pending',
    operation: 'merge',
    targetKind: 'object_merge',
    targetId: survivorId,
    resultId: null,
    title: `Merge ${index}`,
    description: null,
    proposedPayload: { objectIds: [survivorId, duplicateId], survivorId },
    failureReason: null,
  };
}

function objectRow(index: number, type = 'task') {
  const suffix = String(index + 1).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    type,
    canonicalName: `Object ${index}`,
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
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  };
}

describe('ObjectsIndexPage', () => {
  it('watches task category changes when the object index has a category filter', async () => {
    const html = renderToStaticMarkup(
      await ObjectsIndexPage({ searchParams: Promise.resolve({ category: 'design' }) }),
    );

    expect(html).toContain('task-category-filter-refresh');
    expect(fakes.categoryRefresh?.surface).toBe('objects');
    expect(fakes.categoryRefresh?.filters.category).toBe('design');
    expect(fakes.categoryRefresh?.baselineToken).toBe('design:0');
  });

  it('fetches one cursor-paginated object window and preserves filters in page links', async () => {
    fakes.listMembers.mockResolvedValue([{ userId: 'user-1' }]);
    fakes.userRows = [{ id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.test' }];
    fakes.listObjects.mockResolvedValue(Array.from({ length: 49 }, (_, index) => objectRow(index)));
    const cursor = Buffer.from(
      JSON.stringify({ at: '2026-05-31T10:00:00.000Z', id: objectRow(50).id }),
      'utf8',
    ).toString('base64url');

    const html = renderToStaticMarkup(
      await ObjectsIndexPage({
        searchParams: Promise.resolve({ type: 'task', status: ' open ', cursor }),
      }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      archived: false,
      type: 'task',
      status: ['open'],
      limit: 49,
      cursor,
    });
    expect(html).toContain('hidden:{&quot;type&quot;:&quot;task&quot;}');
    expect(html).toContain('members:Ada Lovelace');
    expect(html).toContain('48|/app/objects?type=task&amp;status=open&amp;cursor=');
  });

  it('shows section previews on the unfiltered index and links large sections to typed pagination', async () => {
    fakes.listObjects.mockImplementation(({ type }: { type?: string }) => {
      if (type === 'task') {
        return Promise.resolve(Array.from({ length: 9 }, (_, index) => objectRow(index, type)));
      }
      if (type === 'person') {
        return Promise.resolve(Array.from({ length: 2 }, (_, index) => objectRow(index, type)));
      }
      return Promise.resolve([]);
    });

    const html = renderToStaticMarkup(
      await ObjectsIndexPage({ searchParams: Promise.resolve({ status: 'open' }) }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      archived: false,
      type: 'task',
      status: ['open'],
      limit: 9,
    });
    expect(fakes.listObjects).toHaveBeenCalledWith({
      archived: false,
      type: 'person',
      status: ['open'],
      limit: 9,
    });
    expect(html).toContain(
      'sections:{&quot;task&quot;:&quot;/app/objects?status=open&amp;type=task&quot;}',
    );
    expect(html).not.toContain('page=2');
  });

  it('ignores invalid cursors and uses a cursor-specific empty state', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ at: '2026-05-31T10:00:00.000Z', id: objectRow(50).id }),
      'utf8',
    ).toString('base64url');
    const html = renderToStaticMarkup(
      await ObjectsIndexPage({
        searchParams: Promise.resolve({ type: 'task', status: 'open', cursor }),
      }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      archived: false,
      type: 'task',
      status: ['open'],
      limit: 49,
      cursor,
    });
    expect(html).toContain('No objects on this page');
    expect(html).toContain('/app/objects?type=task&amp;status=open');
    expect(html).toContain('Open first page');

    await ObjectsIndexPage({
      searchParams: Promise.resolve({ type: 'task', status: 'open', cursor: 'not-a-cursor' }),
    });
    expect(fakes.listObjects).toHaveBeenLastCalledWith({
      archived: false,
      type: 'task',
      status: ['open'],
      limit: 49,
      cursor: undefined,
    });
  });

  it('preloads merge previews only for the cleanup panel window', async () => {
    fakes.listPendingSuggestions.mockResolvedValue([
      {
        id: 'bundle-1',
        source: 'background',
        status: 'pending',
        title: 'Object cleanup',
        summary: null,
        reason: null,
        confidence: 'medium',
        visibility: 'team',
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
        metadata: { kind: 'object_cleanup' },
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        evidence: [],
        items: [1, 2, 3, 4, 5, 6].map(mergeSuggestion),
      },
    ]);

    const html = renderToStaticMarkup(
      await ObjectsIndexPage({ searchParams: Promise.resolve({}) }),
    );

    expect(fakes.getObjectMergePreview).toHaveBeenCalledTimes(5);
    expect(html).toContain('item-1,item-2,item-3,item-4,item-5');
    expect(html).not.toContain('item-6');
  });

  it('excludes failed cleanup siblings from the embedded approvals panel', async () => {
    fakes.listPendingSuggestions.mockResolvedValue([
      {
        id: 'bundle-1',
        source: 'background',
        status: 'partially_resolved',
        title: 'Object cleanup',
        summary: null,
        reason: null,
        confidence: 'medium',
        visibility: 'team',
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
        metadata: { kind: 'object_cleanup' },
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        evidence: [],
        items: [mergeSuggestion(1), { ...mergeSuggestion(2), status: 'failed' }],
      },
    ]);

    const html = renderToStaticMarkup(
      await ObjectsIndexPage({ searchParams: Promise.resolve({}) }),
    );

    expect(fakes.getObjectMergePreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('item-1');
    expect(html).not.toContain('item-2');
  });
});
