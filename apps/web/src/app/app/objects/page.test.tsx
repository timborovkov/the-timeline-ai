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
  }: {
    pageInfo?: {
      page: number;
      previousHref: string | null;
      nextHref: string | null;
    };
  }) => (
    <div data-testid="object-cleanup-list">
      {pageInfo
        ? `${pageInfo.page}|${pageInfo.previousHref ?? 'none'}|${pageInfo.nextHref ?? 'none'}`
        : ''}
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

describe('ObjectsIndexPage', () => {
  it('fetches one paginated object window and preserves filters in page links', async () => {
    fakes.listObjects.mockResolvedValue(
      Array.from({ length: 49 }, (_, index) => ({
        id: `object-${index}`,
        type: 'task',
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
      })),
    );

    const html = renderToStaticMarkup(
      await ObjectsIndexPage({
        searchParams: Promise.resolve({ type: 'task', status: 'open', page: '2' }),
      }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      limit: 49,
      offset: 48,
      archived: false,
      type: 'task',
      status: 'open',
    });
    expect(html).toContain('2|/app/objects?type=task&amp;status=open|');
    expect(html).toContain('/app/objects?type=task&amp;status=open&amp;page=3');
  });

  it('bounds oversized page params and uses a page-specific empty state', async () => {
    const html = renderToStaticMarkup(
      await ObjectsIndexPage({
        searchParams: Promise.resolve({ type: 'task', status: 'open', page: '999999' }),
      }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      limit: 49,
      offset: 11952,
      archived: false,
      type: 'task',
      status: 'open',
    });
    expect(html).toContain('No objects on this page');
    expect(html).toContain('/app/objects?type=task&amp;status=open');
    expect(html).toContain('Open first page');
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
