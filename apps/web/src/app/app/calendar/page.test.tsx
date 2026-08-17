import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getCalendarSettings: vi.fn(),
  listCalendarEventPage: vi.fn(),
  listLinkedObjectsForEvents: vi.fn(),
  listMembers: vi.fn(),
  listPendingSuggestions: vi.fn(),
  isPinnedMany: vi.fn(),
  requireMembership: vi.fn(),
  resolveActiveTeam: vi.fn(),
  resolveVisibilityDefault: vi.fn(),
  withCalendarResolutionHints: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    calendar: {
      getCalendarSettings: fakes.getCalendarSettings,
      listCalendarEventPage: fakes.listCalendarEventPage,
      listCalendarEvents: fakes.listCalendarEvents,
      listLinkedObjectsForEvents: fakes.listLinkedObjectsForEvents,
    },
    suggestions: {
      listPendingSuggestions: fakes.listPendingSuggestions,
      withCalendarResolutionHints: fakes.withCalendarResolutionHints,
    },
    timeline: {
      listMembers: fakes.listMembers,
      resolveVisibilityDefault: fakes.resolveVisibilityDefault,
    },
    pins: { isPinnedMany: fakes.isPinnedMany },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
  },
}));
vi.mock('@/lib/suggestions', () => ({ serializeSuggestionBundle: (bundle: unknown) => bundle }));
vi.mock('@/components/approvals/approvals-client', () => ({
  ApprovalsClient: ({ suggestions }: { suggestions: { items: { title: string }[] }[] }) => (
    <div data-testid="calendar-approvals">
      {suggestions.flatMap((bundle) => bundle.items.map((item) => item.title)).join(', ')}
    </div>
  ),
}));
vi.mock('@/components/calendar/calendar-view', () => ({
  CalendarView: ({
    events,
  }: {
    events: Array<{
      id: string;
      title: string;
      redacted: boolean;
      linkedObjects?: Array<{ title: string }>;
    }>;
  }) => (
    <div data-testid="calendar-view">
      {events.map((event) => (
        <div
          key={event.id}
          data-event-id={event.id}
          data-redacted={String(event.redacted)}
          data-linked={event.linkedObjects?.map((object) => object.title).join(',') ?? ''}
        >
          {event.title}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/calendar/calendar-subscription-panel', () => ({
  CalendarSubscriptionPanel: () => <div />,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => <h1>Calendar</h1> }));

const { default: CalendarPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.requireMembership.mockResolvedValue(undefined);
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.listCalendarEvents.mockResolvedValue([]);
  fakes.listCalendarEventPage.mockResolvedValue({ events: [], total: 0 });
  fakes.listLinkedObjectsForEvents.mockResolvedValue([]);
  fakes.listMembers.mockResolvedValue([]);
  fakes.resolveVisibilityDefault.mockResolvedValue({
    visibility: 'team',
    visibilityUserIds: null,
  });
  fakes.listPendingSuggestions.mockResolvedValue([]);
  fakes.isPinnedMany.mockResolvedValue({});
  fakes.withCalendarResolutionHints.mockImplementation((suggestions) =>
    Promise.resolve(suggestions),
  );
});

describe('CalendarPage', () => {
  it('keeps failed siblings out of the embedded calendar approvals panel', async () => {
    fakes.listPendingSuggestions.mockResolvedValue([
      {
        id: 'bundle-1',
        source: 'background',
        status: 'partially_resolved',
        title: 'Launch schedule',
        summary: null,
        reason: null,
        confidence: 'medium',
        createdAt: new Date('2026-07-16T10:00:00.000Z'),
        updatedAt: new Date('2026-07-16T10:00:00.000Z'),
        evidence: [],
        items: [
          {
            id: 'pending-calendar',
            status: 'pending',
            operation: 'create',
            targetKind: 'calendar_event',
            targetId: null,
            title: 'Book launch review',
            proposedPayload: {},
          },
          {
            id: 'failed-calendar',
            status: 'failed',
            operation: 'create',
            targetKind: 'calendar_event',
            targetId: null,
            title: 'Retry broken launch review',
            proposedPayload: {},
          },
          {
            id: 'pending-task',
            status: 'pending',
            operation: 'create',
            targetKind: 'task',
            targetId: null,
            title: 'Prepare launch deck',
            proposedPayload: {},
          },
        ],
      },
    ]);

    const html = renderToStaticMarkup(
      await CalendarPage({ searchParams: Promise.resolve({ date: '2026-07-16' }) }),
    );

    expect(html).toContain('Book launch review');
    expect(html).not.toContain('Retry broken launch review');
    expect(html).not.toContain('Prepare launch deck');
  });

  it('attaches inspectable linked objects and hides them on redacted events', async () => {
    const visibleId = '11111111-1111-4111-8111-111111111111';
    const redactedId = '22222222-2222-4222-8222-222222222222';
    fakes.listCalendarEvents.mockResolvedValue([
      {
        id: visibleId,
        title: 'Atlas kickoff',
        description: null,
        startAt: new Date('2026-07-16T09:00:00.000Z'),
        endAt: new Date('2026-07-16T10:00:00.000Z'),
        timezone: 'UTC',
        allDay: false,
        location: null,
        showAs: 'busy',
        rrule: null,
        recurringParentId: null,
        originalStartAt: null,
        isException: false,
        metadata: {},
        redacted: false,
        visibility: 'team',
        visibilityUserIds: null,
      },
      {
        id: redactedId,
        title: 'Busy',
        description: null,
        startAt: new Date('2026-07-16T11:00:00.000Z'),
        endAt: new Date('2026-07-16T12:00:00.000Z'),
        timezone: 'UTC',
        allDay: false,
        location: null,
        showAs: 'busy',
        rrule: null,
        recurringParentId: null,
        originalStartAt: null,
        isException: false,
        metadata: {},
        redacted: true,
        visibility: 'private',
        visibilityUserIds: null,
      },
    ]);
    fakes.listLinkedObjectsForEvents.mockResolvedValue([
      {
        calendarEventId: visibleId,
        id: 'a0000000-0000-4000-8000-000000000001',
        title: 'Project Atlas',
        type: 'project',
        relationshipType: 'related',
      },
      {
        calendarEventId: redactedId,
        id: 'a0000000-0000-4000-8000-000000000002',
        title: 'Secret task',
        type: 'task',
        relationshipType: 'due_date',
      },
    ]);

    const html = renderToStaticMarkup(
      await CalendarPage({ searchParams: Promise.resolve({ date: '2026-07-16' }) }),
    );

    expect(html).toContain('data-event-id="' + visibleId + '"');
    expect(html).toContain('data-linked="Project Atlas"');
    expect(html).toContain('data-event-id="' + redactedId + '"');
    expect(html).toContain('data-redacted="true"');
    expect(html).not.toContain('Secret task');
    expect(fakes.listLinkedObjectsForEvents).toHaveBeenCalledWith([visibleId, redactedId]);
  });
});
