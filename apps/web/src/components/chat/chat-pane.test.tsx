import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  useChat: vi.fn(),
}));

vi.mock('@ai-sdk/react', () => ({ useChat: fakes.useChat }));
vi.mock('ai', () => ({
  DefaultChatTransport: class DefaultChatTransport {
    constructor(public options: unknown) {}
  },
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
        teamName: 'Acme',
        sessionId: 'session-1',
        initialMessages: [],
        pinnedEntityId: 'object-1',
        pinnedEntityName: 'Proposal',
      }),
    );

    expect(html).toContain('pinned');
    expect(html).toContain('Proposal');
    expect(html).toContain('What is due?');
    expect(html).toContain('Send proposal');
    expect(html).toContain('Agent');
    expect(html).not.toContain('>Acme</span>');
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
    expect(html).toContain(`/app/timeline?event=${eventId}#ev-${eventId}`);
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
});
