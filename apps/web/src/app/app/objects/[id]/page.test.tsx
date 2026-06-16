import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OBJECT_ID = '44444444-4444-4444-8444-444444444444';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getObject: vi.fn(),
  getMergedObjectTarget: vi.fn(),
  markVisited: vi.fn(),
  listObjectBoardContext: vi.fn(),
  listPendingSuggestions: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  notFound: fakes.notFound,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: {
      getObject: fakes.getObject,
      getMergedObjectTarget: fakes.getMergedObjectTarget,
      markVisited: fakes.markVisited,
    },
    boards: { listObjectBoardContext: fakes.listObjectBoardContext },
    suggestions: { listPendingSuggestions: fakes.listPendingSuggestions },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/objects/object-board-context', () => ({
  ObjectBoardContext: () => <div data-testid="board-context" />,
}));
vi.mock('@/components/objects/object-detail-client', () => ({
  ObjectDetailClient: () => <div data-testid="object-detail" />,
}));

const { default: ObjectDetailPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_URL = 'https://timeline.example.com';
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.getObject.mockResolvedValue({
    id: OBJECT_ID,
    type: 'task',
    canonicalName: 'Send proposal',
    status: 'todo',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: false,
    archivedAt: null,
    aliases: [],
    metadata: {},
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    notes: [],
    relationships: [],
    recentChanges: [],
    sourceEvents: [],
    facts: [],
    openTasks: [],
    connectedWork: {
      openTasks: [],
      recentTasks: [],
      calendarEvents: [],
      timelineEvents: [],
      objects: [],
      boards: [],
      pendingApprovals: [],
      documents: [],
    },
    newSinceLastVisit: 0,
    lastVisitedAt: null,
  });
  fakes.getMergedObjectTarget.mockResolvedValue(null);
  fakes.listObjectBoardContext.mockResolvedValue([]);
  fakes.listPendingSuggestions.mockResolvedValue([]);
});

describe('ObjectDetailPage', () => {
  it('uses a safe same-origin returnTo path for the back link fallback', async () => {
    const html = renderToStaticMarkup(
      await ObjectDetailPage({
        params: Promise.resolve({ id: OBJECT_ID }),
        searchParams: Promise.resolve({ returnTo: '/app/tasks?task=task-1' }),
      }),
    );

    expect(html).toContain('href="/app/tasks?task=task-1"');
  });

  it('falls back to objects when returnTo is external', async () => {
    const html = renderToStaticMarkup(
      await ObjectDetailPage({
        params: Promise.resolve({ id: OBJECT_ID }),
        searchParams: Promise.resolve({ returnTo: 'https://evil.example/app/tasks' }),
      }),
    );

    expect(html).toContain('href="/app/objects"');
  });
});
