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
  });
});
