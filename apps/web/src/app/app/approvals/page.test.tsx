// The dedicated queue must distinguish pending decisions from retryable failures so every count
// leads to the same set of reviewable approval items.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getApprovalItemCounts: vi.fn(),
  getCalendarSettings: vi.fn(),
  listSuggestions: vi.fn(),
  resolveActiveTeam: vi.fn(),
  withCalendarResolutionHints: vi.fn(),
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
    suggestions: {
      getApprovalItemCounts: fakes.getApprovalItemCounts,
      listSuggestions: fakes.listSuggestions,
      withCalendarResolutionHints: fakes.withCalendarResolutionHints,
    },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/approvals/approvals-client', () => ({
  ApprovalsClient: ({
    suggestions,
    emptyState,
  }: {
    suggestions: { items: { title: string }[] }[];
    emptyState: { title: string; body: string };
  }) => (
    <div>
      <span>{emptyState.title}</span>
      {suggestions.flatMap((bundle) => bundle.items.map((item) => item.title)).join(', ')}
    </div>
  ),
}));

const { default: ApprovalsPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'AuditAI' },
  });
  fakes.getApprovalItemCounts.mockResolvedValue({ failed: 4, pending: 0 });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.listSuggestions.mockResolvedValue([]);
  fakes.withCalendarResolutionHints.mockImplementation((suggestions) =>
    Promise.resolve(suggestions),
  );
});

function suggestionBundle() {
  return {
    id: 'bundle-1',
    source: 'background',
    status: 'pending',
    title: 'Mixed launch proposal',
    summary: null,
    reason: null,
    confidence: 'medium',
    visibility: 'team',
    visibilityOwnerUserId: null,
    visibilityUserIds: null,
    metadata: {},
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: new Date('2026-07-16T10:00:00.000Z'),
    updatedAt: new Date('2026-07-16T10:00:00.000Z'),
    evidence: [],
    items: [
      {
        id: 'pending-item',
        suggestionId: 'bundle-1',
        teamId: 'team-1',
        status: 'pending',
        operation: 'create',
        targetKind: 'task',
        targetId: null,
        resultId: null,
        title: 'Pending launch task',
        description: null,
        dedupeKey: 'pending-item',
        proposedPayload: { canonicalName: 'Pending launch task' },
        metadata: {},
        failureReason: null,
        supersededByItemId: null,
        supersededReason: null,
        resolvedByUserId: null,
        resolvedAt: null,
        createdAt: new Date('2026-07-16T10:00:00.000Z'),
        updatedAt: new Date('2026-07-16T10:00:00.000Z'),
      },
      {
        id: 'failed-item',
        suggestionId: 'bundle-1',
        teamId: 'team-1',
        status: 'failed',
        operation: 'create',
        targetKind: 'task',
        targetId: null,
        resultId: null,
        title: 'Failed launch task',
        description: null,
        dedupeKey: 'failed-item',
        proposedPayload: { canonicalName: 'Failed launch task' },
        metadata: {},
        failureReason: 'Needs retry',
        supersededByItemId: null,
        supersededReason: null,
        resolvedByUserId: null,
        resolvedAt: null,
        createdAt: new Date('2026-07-16T10:00:00.000Z'),
        updatedAt: new Date('2026-07-16T10:00:00.000Z'),
      },
    ],
  };
}

describe('ApprovalsPage', () => {
  it('shows exact Pending and Failed item counts with a pending-specific empty state', async () => {
    const html = renderToStaticMarkup(
      await ApprovalsPage({ searchParams: Promise.resolve({ status: 'pending' }) }),
    );

    expect(html).toContain('pending 0');
    expect(html).toContain('failed 4');
    expect(html).toContain('No pending approvals');
  });

  it('marks only the selected approval status filter as the current page', async () => {
    const html = renderToStaticMarkup(
      await ApprovalsPage({ searchParams: Promise.resolve({ status: 'failed' }) }),
    );
    const failedFilter = /<a[^>]*href="\/app\/approvals\?status=failed"[^>]*>failed 4<\/a>/.exec(
      html,
    )?.[0];
    const pendingFilter = /<a[^>]*href="\/app\/approvals\?status=pending"[^>]*>pending 0<\/a>/.exec(
      html,
    )?.[0];

    expect(failedFilter).toContain('aria-current="page"');
    expect(failedFilter).toContain('focus-visible:ring-2');
    expect(pendingFilter).not.toContain('aria-current');
  });

  it('keeps failed siblings out of the pending filter', async () => {
    fakes.getApprovalItemCounts.mockResolvedValue({ failed: 1, pending: 1 });
    fakes.listSuggestions.mockResolvedValue([suggestionBundle()]);

    const html = renderToStaticMarkup(
      await ApprovalsPage({ searchParams: Promise.resolve({ status: 'pending' }) }),
    );

    expect(html).toContain('Pending launch task');
    expect(html).not.toContain('Failed launch task');
  });

  it('keeps failed items exclusive to the Failed filter when All is selected', async () => {
    fakes.getApprovalItemCounts.mockResolvedValue({ failed: 1, pending: 1 });
    fakes.listSuggestions.mockResolvedValue([suggestionBundle()]);

    const html = renderToStaticMarkup(
      await ApprovalsPage({ searchParams: Promise.resolve({ status: 'all' }) }),
    );

    expect(html).toContain('Pending launch task');
    expect(html).not.toContain('Failed launch task');
  });

  it('uses a failure-specific empty state', async () => {
    fakes.getApprovalItemCounts.mockResolvedValue({ failed: 0, pending: 0 });

    const html = renderToStaticMarkup(
      await ApprovalsPage({ searchParams: Promise.resolve({ status: 'failed' }) }),
    );

    expect(html).toContain('No failed approvals');
  });
});
