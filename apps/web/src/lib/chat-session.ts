import { isToolUIPart, type UIMessage } from 'ai';

import type * as objects from '@timeline/shared/objects';

interface PersistedUser {
  ui_message?: UIMessage;
}

interface PersistedToolCall {
  toolCallId?: string;
  toolName?: string;
  state?: string;
  errorText?: string;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
  input?: unknown;
  output?: unknown;
  // AI SDK uses different field names across minor versions; accept either.
  args?: unknown;
  result?: unknown;
}

interface PersistedAssistant {
  ui_message?: UIMessage;
  text?: string | null;
  tool_calls?: PersistedToolCall[];
}

export function hydrateChatSessionMessages(
  session: Awaited<ReturnType<typeof objects.getChatSession>> | null,
): UIMessage[] {
  if (!session) return [];
  return session.messages
    .map<UIMessage | null>((message) => {
      if (message.role === 'user') {
        const content = message.content as PersistedUser;
        if (content.ui_message) return content.ui_message;
        return null;
      }
      if (message.role === 'assistant') {
        const content = message.content as PersistedAssistant;
        if (content.ui_message) return historicalChatMessage(content.ui_message);
        const parts: UIMessage['parts'] = [];
        if (Array.isArray(content.tool_calls)) {
          for (const tc of content.tool_calls) {
            const toolName = typeof tc.toolName === 'string' ? tc.toolName : 'unknown';
            const input = tc.input ?? tc.args;
            const output = 'output' in tc ? tc.output : tc.result;
            const state = typeof tc.state === 'string' ? tc.state : undefined;
            if (
              output === undefined &&
              state !== 'approval-requested' &&
              state !== 'output-denied' &&
              state !== 'output-error'
            ) {
              parts.push({
                type: 'data-tool-history',
                data: { name: toolName, state: 'result-unavailable', input },
              });
              continue;
            }
            parts.push({
              type: `tool-${toolName}`,
              toolCallId:
                typeof tc.toolCallId === 'string'
                  ? tc.toolCallId
                  : `${message.id}-${String(parts.length)}`,
              state:
                output !== undefined && state !== 'output-error' && state !== 'output-denied'
                  ? 'output-available'
                  : (state ?? 'output-available'),
              errorText: tc.errorText,
              input,
              output,
              approval: tc.approval,
            } as unknown as UIMessage['parts'][number]);
          }
        }
        const text = content.text ?? '';
        if (text.length > 0) parts.push({ type: 'text', text });
        if (parts.length === 0) return null;
        return { id: message.id, role: 'assistant', parts };
      }
      return null;
    })
    .filter((row): row is UIMessage => row !== null);
}

/** Historical incomplete calls are display data, never executable model tool calls. */
export function historicalChatMessage(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (
        isToolUIPart(part) &&
        ['input-streaming', 'input-available', 'approval-responded'].includes(part.state)
      ) {
        return {
          type: 'data-tool-history',
          data: {
            name: part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5),
            input: part.input,
            state: 'interrupted',
          },
        };
      }
      return part;
    }),
  };
}

export function modelChatMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter(
        (part) =>
          part.type !== 'data-tool-history' &&
          !(isToolUIPart(part) && part.state === 'approval-requested'),
      ),
    }))
    .filter((message) => message.parts.length > 0);
}

/** A fresh turn must not resend a prior failed approval as an executable decision. */
export function chatRequestMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message, index) =>
    index === messages.length - 1 && message.role === 'assistant'
      ? message
      : historicalChatMessage(message),
  );
}
