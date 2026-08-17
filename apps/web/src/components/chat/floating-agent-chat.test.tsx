// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatViewProvider } from '@/components/chat/chat-view-context';

const fakes = vi.hoisted(() => ({
  pathname: vi.fn(),
  searchParams: vi.fn(),
  useChat: vi.fn(),
  loadChatSessionAction: vi.fn(),
  transports: [] as {
    options: {
      body?: () => unknown;
      fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    };
  }[],
}));
const boardItemId = '55555555-5555-4555-8555-555555555555';
const objectId = '44444444-4444-4444-8444-444444444444';

vi.mock('next/navigation', () => ({
  usePathname: fakes.pathname,
  useSearchParams: fakes.searchParams,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@ai-sdk/react', () => ({ useChat: fakes.useChat }));
vi.mock('ai', () => ({
  DefaultChatTransport: class DefaultChatTransport {
    constructor(public options: { body?: () => unknown }) {
      fakes.transports.push({ options });
    }
  },
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(),
}));
vi.mock('@/app/actions/chat', () => ({
  loadChatSessionAction: fakes.loadChatSessionAction,
  unpinChatSessionAction: vi.fn(),
}));
vi.mock('@/components/chat/tool-step', () => ({
  ToolStep: ({ name }: { name: string }) => createElement('span', null, name),
}));

const { FloatingAgentChat } = await import('./floating-agent-chat.js');

function renderChat() {
  return render(
    <ChatViewProvider>
      <FloatingAgentChat teamId="team-1" teamName="AuditAI" />
    </ChatViewProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.transports.length = 0;
  fakes.pathname.mockReturnValue(`/app/objects/${objectId}`);
  fakes.searchParams.mockReturnValue(new URLSearchParams(`tab=notes&item=${boardItemId}`));
  fakes.useChat.mockReturnValue({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready',
    error: null,
  });
  fakes.loadChatSessionAction.mockResolvedValue({ ok: true, messages: [], contextTrail: [] });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('FloatingAgentChat', () => {
  it('hides on the full chat page and home', () => {
    fakes.pathname.mockReturnValue('/app/chat');
    renderChat();
    expect(screen.queryByRole('button', { name: /Open floating agent chat/ })).toBeNull();

    cleanup();
    fakes.pathname.mockReturnValue('/app');
    renderChat();
    expect(screen.queryByRole('button', { name: /Open floating agent chat/ })).toBeNull();
  });

  it('shows a mobile-visible launcher and passes current plus earlier context', async () => {
    const user = userEvent.setup();
    renderChat();

    const trigger = screen.getByRole('button', { name: /Open floating agent chat/ });
    expect(trigger.className).not.toContain('hidden');
    expect(trigger.className).not.toContain('sm:inline-flex');
    await user.click(trigger);

    expect(await screen.findByRole('heading', { name: 'Object' })).toBeTruthy();
    expect(screen.getAllByText(/⌘J/).length).toBeGreaterThan(0);
    const body = fakes.transports.at(-1)?.options.body?.() as {
      dashboardContext?: Record<string, unknown>;
      contextTrail?: { kind: string; objectId?: string }[];
      pinnedEntityId?: string;
      startNewSession?: boolean;
    };
    expect(body.startNewSession).toBe(true);
    expect(body.pinnedEntityId).toBe(objectId);
    expect(body.dashboardContext).toMatchObject({
      pathname: `/app/objects/${objectId}`,
      objectId,
    });
    expect(body.contextTrail?.[0]).toMatchObject({ kind: 'object', objectId });
  });

  it('keeps the session when the panel closes and resets only on New', async () => {
    const user = userEvent.setup();
    const storedSession = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    window.localStorage.setItem(storageKey, storedSession);

    renderChat();
    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    await waitFor(() => {
      expect(
        (fakes.transports.at(-1)?.options.body?.() as { sessionId?: string | null }).sessionId,
      ).toBe(storedSession);
    });

    await user.click(screen.getByRole('button', { name: 'Close floating agent chat' }));
    expect(window.localStorage.getItem(storageKey)).toBe(storedSession);
    const closedPanel = document.getElementById('floating-agent-chat-panel');
    expect(closedPanel?.hasAttribute('open')).toBe(false);
    expect(closedPanel?.inert).toBe(true);

    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    await waitFor(() => {
      expect(
        (fakes.transports.at(-1)?.options.body?.() as { sessionId?: string | null }).sessionId,
      ).toBe(storedSession);
    });

    await user.click(screen.getByRole('button', { name: 'Start new conversation' }));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    await waitFor(() => {
      expect(
        fakes.transports.at(-1)?.options.body?.() as {
          sessionId?: string | null;
          startNewSession?: boolean;
        },
      ).toMatchObject({ sessionId: undefined, startNewSession: true });
    });
  });

  it('opens and closes from the keyboard shortcut', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.keyboard('{Meta>}j{/Meta}');
    expect(await screen.findByRole('heading', { name: 'Object' })).toBeTruthy();
    await user.keyboard('{Meta>}j{/Meta}');
    expect(screen.queryByRole('heading', { name: 'Object' })).toBeNull();
  });

  it('clears stale floating session id when hydration fails', async () => {
    const staleSessionId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    window.localStorage.setItem(storageKey, staleSessionId);
    fakes.loadChatSessionAction.mockResolvedValueOnce({ ok: false, error: 'Session not found' });

    renderChat();

    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBeNull();
      expect(fakes.loadChatSessionAction).toHaveBeenCalledWith({ sessionId: staleSessionId });
    });
  });

  it('reloads the floating session when team changes', async () => {
    const user = userEvent.setup();
    const team1Session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const team2Session = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    window.localStorage.setItem('timeline:floating-agent-chat:team-1:session', team1Session);
    window.localStorage.setItem('timeline:floating-agent-chat:team-2:session', team2Session);

    const { rerender } = render(
      <ChatViewProvider>
        <FloatingAgentChat teamId="team-1" teamName="AuditAI" />
      </ChatViewProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    await waitFor(() => {
      expect(fakes.loadChatSessionAction).toHaveBeenCalledWith({ sessionId: team1Session });
    });

    fakes.loadChatSessionAction.mockClear();
    rerender(
      <ChatViewProvider>
        <FloatingAgentChat teamId="team-2" teamName="AuditAI" />
      </ChatViewProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    await waitFor(() => {
      expect(fakes.loadChatSessionAction).toHaveBeenCalledWith({ sessionId: team2Session });
    });
  });

  it('ignores late session ids from requests that finish after New', async () => {
    const user = userEvent.setup();
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    const lateSession = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { headers: { 'x-tl-session-id': lateSession } }),
    );

    renderChat();
    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    const transport = fakes.transports.at(-1)?.options;

    await user.click(screen.getByRole('button', { name: 'Start new conversation' }));
    await (transport as { fetch?: (url: string, init?: RequestInit) => Promise<Response> }).fetch?.(
      '/api/chat',
      {},
    );

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('appends earlier views when the route changes', async () => {
    const user = userEvent.setup();
    const { rerender } = renderChat();
    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    expect(await screen.findByRole('heading', { name: 'Object' })).toBeTruthy();

    fakes.pathname.mockReturnValue('/app/sources');
    fakes.searchParams.mockReturnValue(new URLSearchParams());
    rerender(
      <ChatViewProvider>
        <FloatingAgentChat teamId="team-1" teamName="AuditAI" />
      </ChatViewProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeTruthy();
    expect(screen.getByText(/1 earlier/)).toBeTruthy();
    const body = fakes.transports.at(-1)?.options.body?.() as {
      contextTrail?: { kind: string; href?: string }[];
    };
    expect(body.contextTrail?.[0]).toMatchObject({ kind: 'page', href: '/app/sources' });
    expect(body.contextTrail?.some((ref) => ref.kind === 'object')).toBe(true);
  });

  it('writes the live trail when opening full Ask', async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(screen.getByRole('button', { name: /Open floating agent chat/ }));
    await user.click(screen.getByRole('link', { name: 'Open full chat' }));
    const stored = JSON.parse(
      window.sessionStorage.getItem('timeline:chat-handoff:team-1') ?? '{}',
    ) as { contextTrail?: { kind: string }[] };
    expect(stored.contextTrail?.[0]).toMatchObject({ kind: 'object' });
  });
});
