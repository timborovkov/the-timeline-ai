import { type UIMessage } from 'ai';

import type * as objects from '@timeline/shared/objects';

interface PersistedUser {
  ui_message?: UIMessage;
}

interface PersistedToolCall {
  toolCallId?: string;
  toolName?: string;
  state?: string;
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
        const parts: UIMessage['parts'] = [];
        if (Array.isArray(content.tool_calls)) {
          for (const tc of content.tool_calls) {
            const toolName = typeof tc.toolName === 'string' ? tc.toolName : 'unknown';
            const input = tc.input ?? tc.args;
            const output = tc.output ?? tc.result;
            const state = typeof tc.state === 'string' ? tc.state : undefined;
            parts.push({
              type: `tool-${toolName}`,
              toolCallId:
                typeof tc.toolCallId === 'string'
                  ? tc.toolCallId
                  : `${message.id}-${String(parts.length)}`,
              state: state ?? (output === undefined ? 'input-available' : 'output-available'),
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
