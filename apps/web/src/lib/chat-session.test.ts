import { describe, expect, it } from 'bun:test';

import type { UIMessage } from 'ai';

import {
  hydrateChatSessionMessages,
  modelChatMessages,
  chatRequestMessages,
} from '@/lib/chat-session';

// Reloaded chat must never claim old unfinished calls are still executing.
function hydrate(content: unknown) {
  return hydrateChatSessionMessages({
    messages: [{ id: 'assistant-1', role: 'assistant', content }],
  } as Parameters<typeof hydrateChatSessionMessages>[0]);
}
describe('persisted chat tool states', () => {
  it('allows a fresh user turn after interrupted approval without resending the decision', () => {
    const approved: UIMessage = {
      id: 'a',
      role: 'assistant',
      parts: [
        {
          type: 'tool-execute_board_create',
          toolCallId: 'call',
          state: 'approval-responded',
          input: { name: 'CRM' },
          approval: { id: 'approval', approved: true },
        },
      ],
    };
    expect(chatRequestMessages([approved])).toEqual([approved]);
    const user: UIMessage = {
      id: 'u',
      role: 'user',
      parts: [{ type: 'text', text: 'Check whether it was created.' }],
    };
    const next = chatRequestMessages([approved, user]);
    expect(next[0]?.parts[0]).toMatchObject({
      type: 'data-tool-history',
      data: { state: 'interrupted' },
    });
    expect(next[1]).toEqual(user);
    expect(approved.parts[0]).toMatchObject({ state: 'approval-responded' });
  });

  it('preserves dynamic results/errors/denials and hides interrupted calls from model history', () => {
    const ui: UIMessage = {
      id: 'a',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'mcp_search',
          toolCallId: '1',
          state: 'output-available',
          input: {},
          output: { count: 0 },
        },
        {
          type: 'tool-search_boards',
          toolCallId: '2',
          state: 'output-error',
          input: {},
          errorText: 'Unavailable',
        },
        {
          type: 'tool-execute_board_create',
          toolCallId: '3',
          state: 'output-denied',
          input: {},
          approval: { id: 'a', approved: false },
        },
        { type: 'tool-search_boards', toolCallId: '4', state: 'input-available', input: {} },
        { type: 'text', text: 'Stopped.' },
      ],
    };
    const restored = hydrate({ version: 2, ui_message: ui });
    expect(restored[0]?.parts.slice(0, 3)).toEqual(ui.parts.slice(0, 3));
    expect(restored[0]?.parts[3]).toMatchObject({
      type: 'data-tool-history',
      data: { state: 'interrupted' },
    });
    expect(modelChatMessages(restored)[0]?.parts).toHaveLength(4);
  });

  it('renders missing legacy results as display-only history', () => {
    const [message] = hydrate({
      text: 'No boards found.',
      tool_calls: [{ toolCallId: 'call-1', toolName: 'search_boards', input: { query: 'CRM' } }],
    });
    expect(message?.parts[0]).toMatchObject({
      type: 'data-tool-history',
      data: { name: 'search_boards', state: 'result-unavailable' },
    });
  });
  it('restores the ordered server UI message and approval identity', () => {
    const ui: UIMessage = {
      id: 'stable-id',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'I can create it.' },
        {
          type: 'tool-execute_board_create',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { name: 'CRM' },
          approval: { id: 'approval-1' },
        },
      ],
    };
    expect(hydrate({ version: 2, ui_message: ui })).toEqual([ui]);
  });
  it('keeps null and false legacy outputs as completed results', () => {
    for (const output of [null, false]) {
      expect(
        hydrate({ tool_calls: [{ toolName: 'search_boards', output }] })[0]?.parts[0],
      ).toMatchObject({ state: 'output-available', output });
    }
  });
});
