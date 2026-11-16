import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type { ChatContextRef } from '@timeline/shared/chat-context';

// Guided Ask must identify the visible starter evidence without replacing saved chat context.
const fakes = vi.hoisted(() => ({
  getFirstRun: vi.fn(),
  getFirstRunRecord: vi.fn(),
  getChatSession: vi.fn(),
  setFirstRunPhase: vi.fn(),
  chatPane: vi.fn(),
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
    }),
  }),
  () => import('@timeline/shared/team-scope'),
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

async function paneProps(session?: string) {
  renderToStaticMarkup(await ChatPage({ searchParams: Promise.resolve({ session }) }));
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
