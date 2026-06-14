// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: vi.fn(),
  searchParams: vi.fn(),
  useChat: vi.fn(),
  transports: [] as { options: { body?: () => unknown } }[],
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
}));
vi.mock('@/app/actions/chat', () => ({ unpinChatSessionAction: vi.fn() }));
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

    await user.click(screen.getByRole('button', { name: 'Open floating agent chat' }));

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
});
