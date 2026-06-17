import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listObjects: vi.fn(),
  listPendingSuggestions: vi.fn(),
  getObjectMergePreview: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: {
      listObjects: fakes.listObjects,
      getObjectMergePreview: fakes.getObjectMergePreview,
    },
    suggestions: { listPendingSuggestions: fakes.listPendingSuggestions },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
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

const { default: ObjectsIndexPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.listObjects.mockResolvedValue([]);
  fakes.listPendingSuggestions.mockResolvedValue([]);
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
    archivedAt: null,
    aliases: [],
    metadata: {},
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  };
}

describe('ObjectsIndexPage', () => {
  it('fetches one cursor-paginated object window and preserves filters in page links', async () => {
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
      limit: 49,
      archived: false,
      type: 'task',
      status: 'open',
      cursor,
    });
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
      limit: 9,
      archived: false,
      type: 'task',
      status: 'open',
    });
    expect(fakes.listObjects).toHaveBeenCalledWith({
      limit: 9,
      archived: false,
      type: 'person',
      status: 'open',
    });
    expect(html).toContain(
      'sections:{&quot;task&quot;:&quot;/app/objects?type=task&amp;status=open&quot;}',
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
      limit: 49,
      archived: false,
      type: 'task',
      status: 'open',
      cursor,
    });
    expect(html).toContain('No objects on this page');
    expect(html).toContain('/app/objects?type=task&amp;status=open');
    expect(html).toContain('Open first page');

    await ObjectsIndexPage({
      searchParams: Promise.resolve({ type: 'task', status: 'open', cursor: 'not-a-cursor' }),
    });
    expect(fakes.listObjects).toHaveBeenLastCalledWith({
      limit: 49,
      archived: false,
      type: 'task',
      status: 'open',
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
});
