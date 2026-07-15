// @vitest-environment happy-dom

import { render, waitFor } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatHandoffKey } from '@/lib/chat-handoff';

const fakes = vi.hoisted(() => ({
  useChat: vi.fn(),
  transports: [] as { options: { body?: () => unknown } }[],
}));

vi.mock('@ai-sdk/react', () => ({ useChat: fakes.useChat }));
vi.mock('ai', () => ({
  DefaultChatTransport: class DefaultChatTransport {
    constructor(public options: { body?: () => unknown }) {
      fakes.transports.push({ options });
    }
  },
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(() => true),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/actions/chat', () => ({ unpinChatSessionAction: vi.fn() }));
vi.mock('@/components/chat/tool-step', () => ({
  ToolStep: ({ name }: { name: string }) => createElement('span', null, name),
}));

const { ChatPane } = await import('./chat-pane.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.transports.length = 0;
  window.sessionStorage.clear();
});

describe('ChatPane', () => {
  it('renders empty-state suggestions for a team', () => {
    fakes.useChat.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    expect(html).toContain('Ask anything about Acme');
    expect(html).toContain('What did the team work on yesterday?');
    expect(html).toContain('What&#x27;s outstanding right now?');
  });

  it('renders persisted messages and pinned object context', () => {
    fakes.useChat.mockReturnValue({
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'What is due?' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Send proposal [ev:abc]' }] },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: 'session-1',
        initialMessages: [],
        pinnedEntityId: 'object-1',
        pinnedEntityName: 'Proposal',
      }),
    );

    expect(html).toContain('Pinned');
    expect(html).toContain('Proposal');
    expect(html).toContain('What is due?');
    expect(html).toContain('Send proposal');
    expect(html).toContain('Agent');
    expect(html).not.toContain('>Acme</span>');
  });

  it('never renders a raw pinned object id as its fallback label', () => {
    fakes.useChat.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });
    const uuid = '8e5b28ae-4ba1-4a52-9d8f-7e9fb57be7a4';
    const { container } = render(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: 'session-1',
        initialMessages: [],
        pinnedEntityId: uuid,
        pinnedEntityName: null,
      }),
    );
    expect(container.textContent).toContain('Unavailable object');
    expect(container.textContent).not.toContain(uuid);
  });

  it('consumes a Home handoff and sends it exactly once', async () => {
    const sendMessage = vi.fn();
    fakes.useChat.mockReturnValue({
      messages: [],
      sendMessage,
      status: 'ready',
      error: null,
    });
    window.sessionStorage.setItem(
      chatHandoffKey('team-1'),
      JSON.stringify({ prompt: 'What changed?', createdAt: Date.now() }),
    );

    render(
      createElement(
        StrictMode,
        null,
        createElement(ChatPane, {
          teamId: 'team-1',
          teamName: 'Acme',
          sessionId: null,
          initialMessages: [],
          pinnedEntityId: null,
          pinnedEntityName: null,
        }),
      ),
    );

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage).toHaveBeenCalledWith({ text: 'What changed?' });
    expect(window.sessionStorage.getItem(chatHandoffKey('team-1'))).toBeNull();
  });

  it('applies contextual Ask handoff to the first persisted session', async () => {
    fakes.useChat.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });
    window.sessionStorage.setItem(
      chatHandoffKey('team-1'),
      JSON.stringify({
        createdAt: Date.now(),
        context: {
          pathname: '/app/objects/018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f',
          routeKind: 'object-detail',
          objectId: '018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f',
        },
        pinnedEntityId: '018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f',
        pinnedEntityName: 'Launch plan',
      }),
    );

    render(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    await waitFor(() => {
      expect(fakes.transports.at(-1)?.options.body?.()).toMatchObject({
        startNewSession: true,
        pinnedEntityId: '018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f',
        dashboardContext: {
          routeKind: 'object-detail',
          objectId: '018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f',
        },
      });
    });
    expect(window.sessionStorage.getItem(chatHandoffKey('team-1'))).toBeNull();
  });

  it('renders assistant markdown text parts with citation chips', () => {
    const eventId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    fakes.useChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `**Sales & outreach:**\n- Follow-up scheduled [ev:${eventId}].`,
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    expect(html).toContain('<strong');
    expect(html).toContain('Sales &amp; outreach:');
    expect(html).toContain('<ul');
    expect(html).toContain('list-disc');
    expect(html).toContain('<li');
    expect(html).toContain('[ev:aaaaaaaa]');
    expect(html).toContain(`Open reference [ev:aaaaaaaa]`);
    expect(html).not.toContain('**Sales');
    expect(html).not.toContain('- Follow-up');
  });

  it('preserves numeric labels and paragraph newlines in assistant text parts', () => {
    fakes.useChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: '2024. Signed pilot\n2026. Expansion pending\n\nCall notes:\n  - indented note',
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    expect(html).not.toContain('list-decimal');
    expect(html).not.toContain('start="2024"');
    expect(html).toContain('2024. Signed pilot\n2026. Expansion pending');
    expect(html).toContain('Call notes:\n  - indented note');
  });

  it('renders ordered markdown lists that start at one', () => {
    fakes.useChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: '1. First step\n2. Second step' }],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    expect(html).toContain('<ol');
    expect(html).toContain('list-decimal');
    expect(html).toContain('Second step');
  });

  it('renders markdown tables with inline formatting and citations', () => {
    const eventId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    fakes.useChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: [
                'Action Points',
                '',
                '| # | Action | Owner | When |',
                '|---|--------|-------|------|',
                `| 1 | **Register domains** [ev:${eventId}] | Otto | ASAP |`,
              ].join('\n'),
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('<strong');
    expect(html).toContain('Register domains');
    expect(html).toContain('[ev:aaaaaaaa]');
    expect(html).not.toContain('|---|--------|-------|------|');
  });

  it('renders markdown tables without optional outer pipes', () => {
    fakes.useChat.mockReturnValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: ['Action | Owner', '--- | ---', 'Register domains | Otto'].join('\n'),
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const html = renderToStaticMarkup(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    expect(html).toContain('<table');
    expect(html).toContain('Register domains');
    expect(html).not.toContain('--- | ---');
  });

  it('resets chat transport state when initialSessionId becomes null', () => {
    const transportRequests: { sessionId: string | null; startNewSession: boolean }[] = [];
    fakes.useChat.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      error: null,
    });

    const { rerender } = render(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: 'stale-session',
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );
    const firstTransportOptions = fakes.transports.at(-1)?.options;
    transportRequests.push(
      firstTransportOptions?.body?.() as { sessionId: string | null; startNewSession: boolean },
    );

    rerender(
      createElement(ChatPane, {
        teamId: 'team-1',
        teamName: 'Acme',
        sessionId: null,
        initialMessages: [],
        pinnedEntityId: null,
        pinnedEntityName: null,
      }),
    );

    const secondTransportOptions = fakes.transports.at(-1)?.options;
    transportRequests.push(
      secondTransportOptions?.body?.() as { sessionId: string | null; startNewSession: boolean },
    );

    expect(transportRequests).toHaveLength(2);
    expect(transportRequests[0]).toMatchObject({
      sessionId: 'stale-session',
      startNewSession: false,
    });
    expect(transportRequests[1]).toMatchObject({
      sessionId: undefined,
      startNewSession: true,
    });
  });
});
