import { CHAT_CONTEXT_TRAIL_MAX, type ChatContextRef } from '@timeline/shared/chat-context';
import type { DailyDigestPayload } from '@timeline/shared/messaging';
import { savedWorkViewHref } from '@timeline/shared/saved-work-views';
import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

// Guided Ask must identify the visible starter evidence without replacing saved chat context.
const fakes = vi.hoisted(() => ({
  getFirstRun: vi.fn(),
  getFirstRunRecord: vi.fn(),
  getChatSession: vi.fn(),
  setFirstRunPhase: vi.fn(),
  chatPane: vi.fn(),
  listDailyDigests: vi.fn(),
  visibleDigestChanges: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: () => Promise.resolve('owner'),
      timeline: { team: () => Promise.resolve({ name: 'Starter team' }) },
      objects: {
        listChatSessions: () => Promise.resolve([]),
        getChatSession: fakes.getChatSession,
      },
      onboarding: {
        getFirstRun: fakes.getFirstRun,
        getFirstRunRecord: fakes.getFirstRunRecord,
        setFirstRunPhase: fakes.setFirstRunPhase,
      },
      savedViews: { visibleDigestChanges: fakes.visibleDigestChanges },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  async () => ({
    ...(await import('@timeline/shared/messaging')),
    listDailyDigests: fakes.listDailyDigests,
  }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: () => Promise.resolve({ user: { id: 'user-1' } }) }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({
    resolveActiveTeam: () =>
      Promise.resolve({ active: { teamId: 'team-1', teamName: 'Starter team' } }),
  }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/components/chat/chat-pane'),
  () => ({ ChatPane: fakes.chatPane }),
  () => import('@/components/chat/chat-pane'),
);
await vi.mock(
  import.meta.resolve('@/components/chat/session-sidebar'),
  () => ({ SessionSidebar: () => null, MobileSessionNav: () => null }),
  () => import('@/components/chat/session-sidebar'),
);
await vi.mock(
  import.meta.resolve('@/components/chat/ask-header'),
  () => ({ AskHeader: () => null }),
  () => import('@/components/chat/ask-header'),
);
await vi.mock(
  import.meta.resolve('@/components/onboarding/guided-continue'),
  () => ({ GuidedContinue: () => null }),
  () => import('@/components/onboarding/guided-continue'),
);

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: ChatPage } = await import('@/app/app/chat/page');
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.chatPane.mockImplementation(() => null);
  fakes.listDailyDigests.mockResolvedValue([]);
  fakes.visibleDigestChanges.mockResolvedValue([]);
  fakes.getChatSession.mockResolvedValue(null);
  fakes.getFirstRun.mockResolvedValue({
    phase: 'record',
    starterPath: 'document',
    workStyle: null,
  });
  fakes.getFirstRunRecord.mockResolvedValue({
    recordTitle: 'Starter plan',
    sources: [{ kind: 'Document', title: 'Starter plan', href: `/app/documents/${DOCUMENT_ID}` }],
  });
});

async function paneProps(session?: string, update?: string) {
  renderToStaticMarkup(await ChatPage({ searchParams: Promise.resolve({ session, update }) }));
  return fakes.chatPane.mock.calls[0]?.[0] as {
    contextTrail: ChatContextRef[];
    initialPrompt: string | null;
    sessionId: string | null;
  };
}

describe('guided Ask starter context', () => {
  it('sends the visible starter document as context for a new chat', async () => {
    const props = await paneProps();
    expect(props.contextTrail).toEqual([
      {
        kind: 'document',
        documentId: DOCUMENT_ID,
        label: 'Starter plan',
        href: `/app/documents/${DOCUMENT_ID}`,
      },
    ]);
    expect(props.initialPrompt).toContain('this document');
  });

  it('sends visible email evidence as timeline context', async () => {
    fakes.getFirstRun.mockResolvedValue({ phase: 'record', starterPath: 'email', workStyle: null });
    fakes.getFirstRunRecord.mockResolvedValue({
      recordTitle: 'Kickoff thread',
      sources: [
        { kind: 'Email', title: 'Forwarded thread', href: `/app/timeline?event=${EVENT_ID}` },
      ],
    });
    const props = await paneProps();
    expect(props.contextTrail).toEqual([
      {
        kind: 'timeline-event',
        timelineEventId: EVENT_ID,
        label: 'Forwarded thread',
        href: `/app/timeline?event=${EVENT_ID}`,
      },
    ]);
    expect(props.initialPrompt).toContain('this thread');
  });

  it('keeps each visible website source in context and deduplicates repeated sources', async () => {
    fakes.getFirstRun.mockResolvedValue({
      phase: 'record',
      starterPath: 'website',
      workStyle: null,
    });
    fakes.getFirstRunRecord.mockResolvedValue({
      recordTitle: 'Starter website',
      sources: [
        { title: 'Home', href: `/app/timeline?event=${EVENT_ID}` },
        { title: 'Duplicate', href: `/app/timeline?event=${EVENT_ID}` },
        { title: 'About', href: `/app/timeline?event=${DOCUMENT_ID}` },
      ],
    });
    const props = await paneProps();
    expect(props.contextTrail.map((ref) => ref.timelineEventId)).toEqual([EVENT_ID, DOCUMENT_ID]);
  });

  it('does not use hidden capture IDs when the visible record has no sources', async () => {
    fakes.getFirstRun.mockResolvedValue({
      phase: 'record',
      starterPath: 'document',
      captureDocumentId: DOCUMENT_ID,
    });
    fakes.getFirstRunRecord.mockResolvedValue({ recordTitle: 'Uploaded document', sources: [] });
    const props = await paneProps();
    expect(props.contextTrail).toEqual([]);
    expect(props.initialPrompt).toBeNull();
  });

  it('preserves saved session context and does not prefill an unrelated onboarding question', async () => {
    const contextTrail: ChatContextRef[] = [
      { kind: 'page', href: '/app/calendar', label: 'Calendar' },
    ];
    fakes.getChatSession.mockResolvedValue({
      session: { title: 'Existing chat', pinnedEntityId: null, contextTrail },
      messages: [],
    });
    const props = await paneProps('existing-session');
    expect(props.contextTrail).toEqual(contextTrail);
    expect(props.initialPrompt).toBeNull();
    expect(fakes.setFirstRunPhase).not.toHaveBeenCalled();
  });
});

describe('Update follow-up context', () => {
  const updateId = '66666666-6666-4666-8666-666666666666';
  const boardId = '77777777-7777-4777-8777-777777777777';
  const payload: DailyDigestPayload = {
    teamName: 'Starter team',
    userName: null,
    windowStart: '2026-11-23T00:00:00Z',
    windowEnd: '2026-11-24T00:00:00Z',
    summary: 'Saved work changed.',
    savedViewsOnly: true,
    savedViewChanges: [{ viewId: updateId, itemIds: [DOCUMENT_ID] }],
    pendingApprovals: 0,
    eventCount: 0,
    sourceDistribution: {},
    objectChangesByType: {},
    newTeamMembers: [],
    tasks: [],
    upcomingCalendar: [],
    links: [],
  };

  it('keeps all saved-view routes and filters after checking current visibility', async () => {
    const views = [
      { collection: 'tasks', targetId: null, filters: { status: 'blocked', due: 'today' } },
      { collection: 'objects', targetId: null, filters: { type: 'person', q: 'Customer' } },
      {
        collection: 'approvals',
        targetId: null,
        filters: { status: 'pending', decision: 'automatic' },
      },
      { collection: 'boards', targetId: boardId, filters: { owner: 'me', view: 'list' } },
    ] as const;
    const visible = views.map((view) => ({
      title: `Saved ${view.collection}`,
      href: savedWorkViewHref(view),
      count: 1,
    }));
    fakes.listDailyDigests.mockResolvedValue([{ payload }]);
    fakes.visibleDigestChanges.mockResolvedValue(visible);
    const props = await paneProps(undefined, updateId);
    expect(props.contextTrail).toEqual(
      visible.map(({ href, title }) => ({ kind: 'page', href, label: title })),
    );
    expect(props.initialPrompt).toContain(payload.windowStart);
    expect(fakes.listDailyDigests).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-1', userId: 'user-1', id: updateId }),
    );
    expect(fakes.visibleDigestChanges).toHaveBeenCalledWith(
      payload.savedViewChanges,
      new Date(payload.windowEnd),
      expect.any(Date),
    );
  });

  it('preserves full saved-view filters in a mixed briefing with a full set of source links', async () => {
    const links = Array.from({ length: CHAT_CONTEXT_TRAIL_MAX }, (_, index) => ({
      label: `Source ${String(index + 1)}`,
      href: `/app/timeline?event=88888888-8888-4888-8888-88888888888${String(index)}`,
    }));
    const href = savedWorkViewHref({
      collection: 'tasks',
      targetId: null,
      filters: { q: 'Helsinki '.repeat(32).trim(), status: 'blocked', due: 'today' },
    });
    fakes.listDailyDigests.mockResolvedValue([
      { payload: { ...payload, savedViewsOnly: false, links } },
    ]);
    fakes.visibleDigestChanges.mockResolvedValue([
      { title: 'Blocked launch work', href, count: 1 },
    ]);

    const { contextTrail } = await paneProps(undefined, updateId);
    expect(contextTrail).toHaveLength(CHAT_CONTEXT_TRAIL_MAX);
    expect(contextTrail[0]).toEqual({ kind: 'page', href, label: 'Blocked launch work' });
    expect(contextTrail.filter(({ kind }) => kind === 'timeline-event')).toHaveLength(
      CHAT_CONTEXT_TRAIL_MAX - 1,
    );
  });

  it('does not restore saved-view context after current access is lost', async () => {
    fakes.listDailyDigests.mockResolvedValue([{ payload }]);
    fakes.visibleDigestChanges.mockResolvedValue([]);
    expect((await paneProps(undefined, updateId)).contextTrail).toEqual([]);
  });

  it('rejects external and lookalike routes while retaining typed source context', async () => {
    fakes.listDailyDigests.mockResolvedValue([
      {
        payload: {
          ...payload,
          savedViewChanges: [],
          links: [
            { label: 'External', href: 'https://example.test/app/tasks?status=blocked' },
            { label: 'Protocol relative', href: '//example.test/app/tasks' },
            { label: 'Lookalike', href: '/app/tasks-private?status=blocked' },
            { label: 'Invalid board', href: '/app/boards/not-an-id?view=list' },
            { label: 'Object', href: `/app/objects/${DOCUMENT_ID}` },
            { label: 'Event', href: `/app/timeline?event=${EVENT_ID}` },
          ],
        },
      },
    ]);
    expect((await paneProps(undefined, updateId)).contextTrail).toEqual([
      {
        kind: 'object',
        objectId: DOCUMENT_ID,
        href: `/app/objects/${DOCUMENT_ID}`,
        label: 'Object',
      },
      {
        kind: 'timeline-event',
        timelineEventId: EVENT_ID,
        href: `/app/timeline?event=${EVENT_ID}`,
        label: 'Event',
      },
    ]);
  });
});
