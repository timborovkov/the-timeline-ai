// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  vi.clearAllMocks();
  fakes.transports.length = 0;
  fakes.pathname.mockReturnValue('/app/objects/44444444-4444-4444-8444-444444444444');
  fakes.searchParams.mockReturnValue(new URLSearchParams(`tab=notes&item=${boardItemId}`));
  fakes.useChat.mockReturnValue({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready',
    error: null,
  });
  fakes.loadChatSessionAction.mockResolvedValue({ ok: true, messages: [] });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('FloatingAgentChat', () => {
  it('hides on the full chat page', () => {
    fakes.pathname.mockReturnValue('/app/chat');

    render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);

    expect(screen.queryByRole('button', { name: 'Open floating agent chat' })).toBeNull();
  });

  it('passes current dashboard route context through the chat transport', async () => {
    const user = userEvent.setup();
    render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);

    const trigger = screen.getByRole('button', { name: 'Open floating agent chat' });
    expect(trigger.className).toContain('hidden');
    expect(trigger.className).toContain('sm:inline-flex');
    await user.click(trigger);

    expect(await screen.findByRole('heading', { name: 'Ask AuditAI' })).toBeTruthy();
    const body = fakes.transports.at(-1)?.options.body?.() as {
      dashboardContext?: Record<string, unknown>;
      startNewSession?: boolean;
    };
    expect(body.startNewSession).toBe(true);
    expect(body.dashboardContext).toMatchObject({
      pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
      routeKind: 'objects',
      objectId: '44444444-4444-4444-8444-444444444444',
      search: { tab: 'notes', item: boardItemId },
      boardItemId,
    });
  });

  it('clears stale floating session id when hydration fails', async () => {
    const staleSessionId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    window.localStorage.setItem(storageKey, staleSessionId);
    fakes.loadChatSessionAction.mockResolvedValueOnce({ ok: false, error: 'Session not found' });

    render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);

    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBeNull();
      expect(fakes.loadChatSessionAction).toHaveBeenCalledWith({ sessionId: staleSessionId });
    });
  });

  it('reloads the floating session when team changes', async () => {
    const user = userEvent.setup();
    const team1Session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const team2Session = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const team1StorageKey = 'timeline:floating-agent-chat:team-1:session';
    const team2StorageKey = 'timeline:floating-agent-chat:team-2:session';

    window.localStorage.setItem(team1StorageKey, team1Session);
    window.localStorage.setItem(team2StorageKey, team2Session);

    const { rerender } = render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);
    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));
    await waitFor(() => {
      expect(fakes.loadChatSessionAction).toHaveBeenCalledWith({ sessionId: team1Session });
      expect(
        (fakes.transports.at(-1)?.options.body?.() as { sessionId?: string | null }).sessionId,
      ).toBe(team1Session);
    });

    fakes.loadChatSessionAction.mockClear();
    rerender(<FloatingAgentChat teamId="team-2" teamName="AuditAI" />);
    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));

    await waitFor(() => {
      expect(fakes.loadChatSessionAction).toHaveBeenCalledWith({ sessionId: team2Session });
      expect(
        (fakes.transports.at(-1)?.options.body?.() as { sessionId?: string | null }).sessionId,
      ).toBe(team2Session);
    });
  });

  it('starts a fresh floating session after the modal closes', async () => {
    const user = userEvent.setup();
    const storedSession = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    window.localStorage.setItem(storageKey, storedSession);

    render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);
    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));

    await waitFor(() => {
      expect(
        (fakes.transports.at(-1)?.options.body?.() as { sessionId?: string | null }).sessionId,
      ).toBe(storedSession);
    });

    await user.click(screen.getByRole('button', { name: 'Close floating agent chat' }));
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));

    await waitFor(() => {
      expect(fakes.transports.length).toBeGreaterThanOrEqual(2);
    });
    expect(
      fakes.transports.at(-1)?.options.body?.() as {
        sessionId?: string | null;
        startNewSession?: boolean;
      },
    ).toMatchObject({ sessionId: undefined, startNewSession: true });
  });

  it('starts a fresh floating session while the modal stays open', async () => {
    const user = userEvent.setup();
    const storedSession = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    window.localStorage.setItem(storageKey, storedSession);

    render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);
    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));

    await waitFor(() => {
      expect(
        (fakes.transports.at(-1)?.options.body?.() as { sessionId?: string | null }).sessionId,
      ).toBe(storedSession);
    });

    await user.click(screen.getByRole('button', { name: 'Start new conversation' }));

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ask AuditAI' })).toBeTruthy();
    await waitFor(() => {
      expect(fakes.transports.length).toBeGreaterThanOrEqual(2);
    });
    expect(
      fakes.transports.at(-1)?.options.body?.() as {
        sessionId?: string | null;
        startNewSession?: boolean;
      },
    ).toMatchObject({ sessionId: undefined, startNewSession: true });
  });

  it('ignores late session ids from requests that finish after close', async () => {
    const user = userEvent.setup();
    const storageKey = 'timeline:floating-agent-chat:team-1:session';
    const lateSession = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { headers: { 'x-tl-session-id': lateSession } }),
    );

    render(<FloatingAgentChat teamId="team-1" teamName="AuditAI" />);
    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));
    const transport = fakes.transports.at(-1)?.options;

    await user.click(screen.getByRole('button', { name: 'Close floating agent chat' }));
    await transport?.fetch?.('/api/chat', {});

    expect(window.localStorage.getItem(storageKey)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));

    await waitFor(() => {
      expect(fakes.transports.length).toBeGreaterThanOrEqual(2);
    });
    expect(
      fakes.transports.at(-1)?.options.body?.() as {
        sessionId?: string | null;
        startNewSession?: boolean;
      },
    ).toMatchObject({ sessionId: undefined, startNewSession: true });
  });
});
