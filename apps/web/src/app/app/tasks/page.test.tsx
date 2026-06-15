import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listObjects: vi.fn(),
  listPendingSuggestions: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    objects: { listObjects: fakes.listObjects },
    suggestions: { listPendingSuggestions: fakes.listPendingSuggestions },
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
    folded?: { title: string; summary: (count: number) => string };
  }) => (
    <div data-testid="approvals">
      {folded ? `${folded.title}: ${folded.summary(1)}. ` : null}
      {suggestions.map((suggestion) => suggestion.title).join(', ')}
    </div>
  ),
}));
vi.mock('@/components/boards/kanban-board', () => ({
  KanbanBoard: ({ rows }: { rows: { canonicalName: string }[] }) => (
    <div data-testid="kanban">{rows.map((row) => row.canonicalName).join(', ')}</div>
  ),
}));

const { default: TasksPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.listObjects.mockResolvedValue([]);
  fakes.listPendingSuggestions.mockResolvedValue([]);
});

describe('TasksPage', () => {
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
});
