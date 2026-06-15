'use server';

import { type UIMessage } from 'ai';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type * as objects from '@timeline/shared/objects';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

interface PersistedUser {
  ui_message?: UIMessage;
}

interface PersistedToolCall {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  args?: unknown;
  result?: unknown;
}

interface PersistedAssistant {
  text?: string | null;
  tool_calls?: PersistedToolCall[];
}

function hydrateChatSessionMessages(
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
            parts.push({
              type: `tool-${toolName}`,
              toolCallId:
                typeof tc.toolCallId === 'string'
                  ? tc.toolCallId
                  : `${message.id}-${String(parts.length)}`,
              state: output === undefined ? 'input-available' : 'output-available',
              input,
              output,
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

interface LoadChatSessionActionResult {
  ok: boolean;
  error?: string;
  messages?: UIMessage[];
}

export async function archiveChatSessionAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('archive_chat_session', async () => {
    const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.archiveChatSession(parsed.data.sessionId);
      revalidatePath('/app/chat');
      return { ok: true };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'archive_chat_session' });
      return { error: err instanceof Error ? err.message : 'Failed to archive session' };
    }
  });
}

export async function unpinChatSessionAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('unpin_chat_session', async () => {
    const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.linkChatSessionToObject(parsed.data.sessionId, null);
      revalidatePath('/app/chat');
      return { ok: true };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'unpin_chat_session' });
      return { error: err instanceof Error ? err.message : 'Failed to unpin' };
    }
  });
}

export async function loadChatSessionAction(input: unknown): Promise<LoadChatSessionActionResult> {
  return runSentryServerAction('load_chat_session_messages', async () => {
    const parsed = z.object({ sessionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { ok: false, error: r.error };
    try {
      const loaded = await r.scope.objects.getChatSession(parsed.data.sessionId);
      if (!loaded) return { ok: false, error: 'Session not found' };
      return { ok: true, messages: hydrateChatSessionMessages(loaded) };
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'load_chat_session_messages',
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to load chat session',
      };
    }
  });
}
